# Bàn giao BE TotMart — hợp đồng checkout attempt và đợt FE tiếp theo

## Bổ sung hợp đồng 2026-10-19 (ưu tiên nếu khác nội dung lịch sử bên dưới)

### Kết thúc khi prepare chưa trả hash

`POST /api/checkout/attempts/products/:key/terminate-with-body` và `POST /api/checkout/attempts/subscription/:key/terminate-with-body`.

- Auth như lookup/terminate hiện có; không nhận userId từ client. Key theo regex 16–128 ký tự hiện có. Không cần header `Attempt-Payload-Hash` hoặc `Idempotency-Key` vì key ở path.
- Request JSON là **nguyên body gốc đã lưu trước prepare**, qua đúng schema create của kind tương ứng: Joi conversion/defaults/stripUnknown và thứ tự thuộc tính hiện tại. Không sửa body để thử kết thúc; không tự tính hash ở FE.
- Không tra địa chỉ/template, không yêu cầu prepare thành công. Dùng được sau `ADDRESS_NOT_FOUND` (400), `ADDRESS_CHANGED` (409), lỗi nghiệp vụ trước hash và khi mất response prepare.
- HTTP 200: `{success:true,data:{key,hash,state:"invalidated",canRestart:true}}`; `hash` do BE tính sau validation. Tombstone được ghi transaction, serialize với create qua attempt revision/unique index. Request cũ đã chạy/đến trễ hoặc prepare đang tra địa chỉ không thể tạo giao dịch sau tombstone commit.
- Nếu giao dịch đã commit: HTTP 200 với `{key,hash,state:"created",result:<kết quả cũ>,canRestart:false}`. Không vô hiệu hóa giao dịch, không hủy đơn/subscription.
- Body chưa vượt validation: HTTP 400 envelope Joi hiện có, **không tính hash, không tạo attempt/tombstone, không có quyền restart**. Không nhầm lỗi validation với payload hợp lệ nhưng lỗi nghiệp vụ. Nếu body gốc không hợp lệ, FE cần hiển thị lỗi và sửa luồng thu thập/validation dữ liệu; không xem 400 là bằng chứng đã fence reference cũ. Không thay body của reference có thể đã gửi thành công.
- Hash khác reference đã tồn tại: 409 `ATTEMPT_PAYLOAD_MISMATCH`. Key sai: 400 `INVALID_ATTEMPT_REFERENCE`. Hết admission capacity: 429 `ATTEMPT_CAPACITY_REACHED`. Auth/Redis/DB lỗi không cấp quyền mở key mới.
- Chỉ mở key mới để sửa thông tin sau response `invalidated` + `canRestart:true` đúng reference hoặc lookup xác nhận tombstone đó. Nếu mất response của endpoint mới, retry nguyên body/path; response trả lại hash để lưu và lookup. Một 400/404, timeout, lookup unknown hay lỗi mạng không bao giờ là bằng chứng restart.

Prepare, create, lookup và terminate bằng hash giữ nguyên API cũ; không yêu cầu client legacy gọi endpoint mới. Legacy Checkout đã commit tiếp tục replay trước mọi ghi Attempt. Không đổi hash/canonicalization của key cũ.

### Created và lần mua mới

`created` là **giao dịch đã tồn tại**, không còn là attempt cần hủy. `canRestart:false` ngăn recovery tự tạo giao dịch khác; nó không cấm một giao dịch kinh doanh độc lập được người dùng chủ động xác nhận.

Sau khi đã xác nhận kết quả giao dịch cũ, FE cho phép hành động rõ ràng “Mua lần mới”/“Đăng ký gói mới”: giữ reference cũ trong lịch sử, tạo UUID mới, lấy giỏ/quote/thông tin mới và xác nhận lại. BE đã hỗ trợ nhiều checkout/subscription cùng user với key khác nhau; không cần endpoint reset scope. Key cũ luôn replay kết quả cũ, không tiêu thụ giỏ của lần mua mới. Không tự mở lần mua mới từ timeout/unknown hoặc khi chưa xác định giao dịch cũ. `terminate` với giao dịch created tiếp tục trả created/result, không hủy giao dịch đó.

### Giới hạn và lưu trữ

Toàn bộ `/api/checkout/attempts` có quota IP 300 request/phút và user 120 request/phút, dùng hai policy Redis riêng khi `REDIS_URL` bật. Quota bao gồm cả lookup và retry; tôn trọng `Retry-After`, backoff, không polling dồn dập. Production bắt buộc Redis và namespace chung giữa các instance, cấu hình `TRUST_PROXY` đúng proxy tin cậy. Redis không sẵn sàng trả lỗi đóng bảo mật; không fallback memory trong production.

Admission mới giới hạn bền vững **10.000 Attempt/user**, đếm cả dữ liệu trước release và tất cả state/kind. Ghi revision trên User và count/insert trong cùng transaction serialize admission giữa instance. Tới giới hạn: không thêm key/tombstone mới, 429 `ATTEMPT_CAPACITY_REACHED`; existing lookup/replay/terminate vẫn hoạt động. Đây là giới hạn cố định cần vận hành đánh giá trước khi tăng, không phải TTL. Không xóa tombstone/Checkout để mở quota. Revision nội bộ `User.checkoutAttemptRevision` không phải business state hoặc credential.

Admin `GET /api/admin/operations/health-summary` thêm `attempts:{total,last24h,highWaterUsers,perUserLimit}`; cảnh báo từ 8.000 reference/user, outbox quá 15 phút, webhook `retry_required` quá 15 phút, refund pending quá 24 giờ. Chỉ trả số lượng, không trả key/hash/userId. Endpoint có aggregation toàn collection: probe readiness riêng; chạy summary định kỳ thưa, theo dõi latency, dung lượng/index và tốc độ tăng theo ngày. Các ngưỡng là tín hiệu cần điều tra, không tự xóa dữ liệu hoặc tự gửi thông báo.

### Migration/deploy/rollback của bổ sung này

1. Drain **tất cả** writer cũ (checkout, subscription, webhook, scheduler); không rolling với bản bỏ qua tombstone. Backup nhất quán khi dừng ghi, thử restore vào DB mới. Rà manifest/dry-run và conflict trước apply theo runbook bên dưới.
2. Giữ scripts CAS migration hiện tại: apply là transaction, interruption trước commit rollback toàn batch; manifest đã apply phải lập lại dry-run, replay manifest cũ có thể báo CAS. Rollback chỉ khi giá trị vẫn khớp after, không ghi đè sửa đổi sau migration. Migration checkout legacy là insert-only, không có rollback tự động; không xóa Checkout đã có hoạt động sau migration.
3. Tạo/kiểm tra unique Attempt `{userId,kind,key}`, Checkout `{userId,requestKey}` và index Attempt `{createdAt:1}` (additive). Không TTL trên Attempt. Startup phải fail nếu index/integrity lỗi. Không cần backfill revision User; `$inc` khởi tạo khi admission đầu tiên.
4. Deploy BE hiểu tombstone trước FE recovery mới. Smoke prepare lỗi địa chỉ → terminate-with-body → key mới; old key replay; quota dùng chung; logout stream; readiness Redis/DB; đối soát ledger/refund/outbox và collection growth.
5. Rollback: đóng nhận giao dịch/drain rồi dùng bản vẫn tôn trọng Attempt/tombstone. Không quay về writer bỏ qua tombstone, không xóa reference hay kết quả đã created. FE có thể tắt UX mới nhưng phải giữ reference.

Xem kết quả thực chạy và phần chưa kiểm chứng tại [biên bản kiểm chứng](be-handoff-verification.md); không suy ra mức sẵn sàng production từ số test pass.

Tài liệu đối chiếu với source hiện tại ngày 2026-10-18. Không thay đổi repo FE, không commit/push/deploy hoặc chạy migration lên dữ liệu thật. Các thay đổi source/test/Compose có sẵn được giữ nguyên trong đợt bàn giao này.

## 1. Phạm vi và nguyên tắc

BE bổ sung bản ghi CheckoutAttempt, đóng băng địa chỉ trước khi tạo đơn, và hàng rào transaction giữa tạo giao dịch và vô hiệu hóa attempt. Admin tạo combo dùng service chung với merchant, xác minh owner và từ chối toàn bộ cấu phần lỗi. `internalSubscription` là cờ chuẩn; `subscriptionOnly` được giữ làm mirror tương thích.

Attempt được định danh bởi **user đã xác thực + kind + key**, ràng buộc với hash payload. Hash là SHA256 UTF-8 của `JSON.stringify(req.validatedBody)` sau Joi validation/conversion/defaults/stripUnknown, không phải hash raw body. Thứ tự thuộc tính vẫn có ý nghĩa để giữ replay legacy; BE không sort key. FE lưu nguyên serialized body đã gửi và dùng `data.hash` của prepare, không tự tính request hash từ raw JSON.

Checkout cũ vẫn có unique index `{userId:1, requestKey:1}`: key đã commit không được dùng lại cho kind khác. Dùng UUID mới cho mỗi giao dịch mới, không dùng chung key giữa checkout và subscription.

Checkout result và attempt/tombstone giữ **vô thời hạn, không TTL**. `expiresAt` chỉ là hạn thanh toán, không phải hạn replay. Key invalidated không bao giờ dùng lại. Không dùng mốc 24 giờ hoặc một kết quả unknown làm bằng chứng cho phép mua lại. Vô hiệu hóa attempt không hủy đơn, không xóa khoản đã nhận, refund hoặc nghĩa vụ subscription.

## 2. Quyền và header

Các endpoint attempt nằm dưới `/api/checkout`.

- Auth nhận `Authorization: Bearer <access-token>` hoặc cookie `token`; production yêu cầu session hiện hành. Tài khoản bị khóa trả 403, token/session không hợp lệ trả 401; user bị xóa có thể trả 404 theo middleware hiện có.
- Cookie-auth POST cần `X-TotMart-Request: 1` nếu không gửi Authorization; browser dùng credentials và Origin trong CORS allowlist. Dùng cơ chế auth hiện tại của FE.
- Prepare/create có customerCheckoutMiddleware: user và admin được mua; merchant trả 403. Lookup/terminate chỉ yêu cầu auth và chỉ truy cập namespace của chính req.userId, không có admin override hoặc userId trong request.
- Prepare/create dùng `Idempotency-Key`: 16–128 ký tự, regex `^[A-Za-z0-9_-]{16,128}$`. Bắt buộc trong production; dev/test thiếu key vẫn được cấp UUID ngẫu nhiên nên không bảo đảm recovery giữa các HTTP request. FE mới luôn tự tạo và lưu key.
- Lookup/terminate dùng `Attempt-Payload-Hash`: đúng 64 ký tự hex **chữ thường**. Hash không phải credential; vẫn phải auth.

## 3. Endpoint và dữ liệu

### Prepare

`POST /attempts/products/prepare` hoặc `POST /attempts/subscription/prepare`, JSON body giống chính xác create tương ứng, trả HTTP **200**. Không trừ kho, dùng coupon hay tạo giao dịch thanh toán. Products lưu snapshot giao hàng đã được BE xác thực. Subscription dùng shippingAddress trong body/hash.

Body products:

```json
{
  "addressId": "507f1f77bcf86cd799439011",
  "paymentMethod": "online",
  "note": "Giao giờ hành chính",
  "couponCode": "SALE10",
  "quoteFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Chỉ addressId và paymentMethod (`cod` hoặc `online`) bắt buộc. note tối đa 500 ký tự, có thể rỗng; couponCode được trim/uppercase, dài 3–30; quoteFingerprint và addressHash tùy chọn, mỗi trường 64 hex. Nên gửi quoteFingerprint lấy từ quote mới nhất để phát hiện giá/giỏ hàng thay đổi. Products create đọc giỏ hàng hiện tại trong transaction; prepare không giữ snapshot giỏ hoặc giá.

Body subscription:

```json
{
  "templateId": "507f1f77bcf86cd799439012",
  "expectedTotalAmount": 300000,
  "shippingAddress": {
    "address": "123 Main street",
    "district": "District 1",
    "city": "HCM",
    "country": "VN",
    "zipCode": "",
    "phone": "0900000000"
  }
}
```

TemplateId và shippingAddress bắt buộc; expectedTotalAmount tùy chọn nhưng FE nên gửi số nguyên dương để kiểm tra giá. shippingAddress hiện chỉ nhận các trường trên, zipCode mặc định chuỗi rỗng; không có fullName/addressId/addressHash cho subscription. Joi stripUnknown nên không dựa vào trường ngoài schema để ràng buộc giao dịch.

Ví dụ response products prepare lần đầu (hash dưới đây chỉ minh họa hình dạng, không phải digest của body mẫu):

```json
{
  "success": true,
  "data": {
    "key": "checkout-client-random-123",
    "hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "state": "processing",
    "address": {
      "fullName": "Nguyen Van A",
      "phone": "0900000000",
      "address": "123 Main street",
      "district": "District 1",
      "city": "HCM",
      "country": "VN"
    },
    "addressHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }
}
```

Subscription prepare không có address/addressHash. Optional fields undefined bị bỏ khỏi JSON, không nhất thiết trả null. Prepare key đã commit trả `state: created` và `result` cũ; vì đọc Checkout trước nên response này không có address/addressHash ngay cả với checkout products mới. Prepare key rejected/invalidated trả lỗi, không trả response 200 chứa trạng thái đó.

### Lookup (chỉ đọc)

`GET /attempts/:kind/:key` với header Attempt-Payload-Hash; không có body; trả HTTP **200**. kind là products hoặc subscription. Không ghi attempt/tạo tombstone. Key của user khác được nhìn như unknown trong namespace user hiện tại.

```json
{"success":true,"data":{"state":"unknown","canRestart":false}}
```

```json
{"success":true,"data":{"state":"processing","canRestart":false}}
```

```json
{"success":true,"data":{"state":"rejected","error":{"code":"ATTEMPT_REJECTED","statusCode":409,"message":"Giá đã thay đổi"},"canRestart":false}}
```

```json
{"success":true,"data":{"state":"created","result":{"orderId":"507f1f77bcf86cd799439013","orderCode":"TMART_EXAMPLE","totalAmount":300000,"shippingPayment":"customer_to_carrier"},"canRestart":false}}
```

Lookup không trả địa chỉ/hash; FE giữ dữ liệu prepare riêng. result là bản replay, không phải trạng thái thanh toán mới nhất.

### Invalidate attempt — tên endpoint thực tế là terminate

`POST /attempts/:kind/:key/terminate`, header Attempt-Payload-Hash, không cần body; trả HTTP **200**. Không có endpoint `/invalidate` trong implementation hiện tại. Tên thao tác FE có thể là “Kết thúc lần thử”.

```json
{"success":true,"data":{"state":"invalidated","canRestart":true}}
```

Nếu attempt rejected đã có error thì error cũ có thể còn trong response invalidated. Nếu đã commit, response là created/result/canRestart:false, không hủy giao dịch. Nếu chưa có attempt, endpoint tạo tombstone invalidated: request cũ đến sau bị chặn. Nếu request tạo đang giữ khóa, thao tác serialize với transaction đó: giao dịch commit trước thì không được restart; tombstone commit trước thì create không thể commit.

Chỉ cho phép bắt đầu lại khi nhận response thành công `success:true`, `data.state:"invalidated"`, `data.canRestart:true` cho đúng user/kind/key/hash. Lookup cũng có thể xác nhận tombstone này sau khi mất response terminate. Sau đó tạo **key mới**, prepare lại và xác nhận lại dữ liệu. Timeout/abort HTTP ở FE không tự hủy xử lý BE; lặp terminate hoặc lookup cùng reference cho đến kết quả xác định. Không coi 200 đơn thuần hay 409 là quyền restart.

### Create và trạng thái giao dịch

- Products: `POST /api/checkout/check-out`, body và Idempotency-Key giống prepare. HTTP **201**, `{success:true,data:result}`; result gồm orderId (ID đơn đầu tiên khi tách merchant), orderCode, totalAmount, shippingPayment.
- Subscription: `POST /api/subcribe-plans/user-subscribe` (giữ nguyên spelling hiện hữu), cùng body/key; HTTP **201**. result gồm snapshot UserSubscription và orderCode/totalAmount. message có thể có ở lần tạo đầu, không có ở replay; FE dùng data, không so sánh toàn bộ envelope.
- Sau created: `GET /api/checkout/order-status/:paymentCode`, dùng `result.orderCode` làm paymentCode. API này có quyền owner/admin riêng. Dùng payable, remainingAmount, paymentStatus và qrUrl hiện tại từ response; không dùng replay result để suy ra đã trả tiền hoặc tự tính lại QR.
- Hủy đơn/refund/subscription vẫn dùng các action chuyên biệt sẵn có; terminate không thay thế chúng. Chưa có điều kiện canRestart cho checkout đã created trong hợp đồng attempt, kể cả khi đơn bị hủy/hết hạn sau đó. Mua mới sau hủy phải theo luồng kinh doanh riêng, có hành động xác nhận rõ ràng, không tự động từ recovery.

## 4. Trạng thái, lỗi và retry

- `unknown`: không tìm được Checkout/Attempt của user với reference này. Không kết luận chưa có đơn; giữ reference, lookup/retry hoặc terminate.
- `processing`: attempt đã được tiếp nhận; có thể đang chạy hoặc dừng sau lỗi tạm. Retry body/key không đổi; không có TTL/lease cho FE tự lấy quyền restart.
- `created`: tạo giao dịch đã commit. Replay, rồi theo dõi payment/order; không tạo key mới tự động.
- `rejected`: BE đã lưu từ chối nghiệp vụ cuối; retry cùng key lặp lỗi đã ghi. Terminate để có thể đổi nội dung/key.
- `invalidated`: tombstone bền vững, create với key đó luôn bị từ chối; chỉ dùng key mới sau xác nhận canRestart.

Lỗi theo source:

- 400 `INVALID_ATTEMPT_REFERENCE`: kind/key/hash không đúng trên lookup/terminate. Response riêng `{success:false,code:"INVALID_ATTEMPT_REFERENCE"}`, không có status/message/requestId bắt buộc.
- 400 Joi validation: `{success:false,message:"Validation failed",errors:[{field,message}]}`, có thể không có code; xảy ra trước khi lưu attempt.
- 400 thiếu/sai Idempotency-Key theo production policy: message hiện hữu, không có machine code riêng.
- 400 `ADDRESS_NOT_FOUND`: không tìm được địa chỉ của user khi tiếp nhận products lần đầu.
- 422 `INVALID_DELIVERY_ADDRESS`: snapshot không hợp lệ; có fields, không chứa giá trị địa chỉ trong lỗi. fullName lấy từ address.fullName hoặc user.name; phone và các trường giao hàng được trim/validate ở BE.
- 409 `ADDRESS_CHANGED`: addressHash gửi lúc tiếp nhận đầu không khớp snapshot hiện tại.
- 409 `ATTEMPT_PAYLOAD_MISMATCH`: cùng reference nhưng hash khác.
- 409 `ATTEMPT_INVALIDATED`: prepare/create dùng key bị vô hiệu hóa.
- 409 `ATTEMPT_MISSING`: không còn attempt tại bước lock, thường cần điều tra integrity; không có quyền restart tự động.
- Rejected replay trả statusCode/message/code đã lưu; nếu business error không có code thì lưu fallback `ATTEMPT_REJECTED`.
- Checkout legacy/create/prepare đã commit với hash khác: 409 message tiếng Việt cũ, **không có code ổn định**. Khác kind: message `IDEMPOTENCY_KIND_CONFLICT`, cũng **không có field code** do đi qua pricingService.fail. Lookup/terminate khi Checkout kind/hash khác trả code ATTEMPT_PAYLOAD_MISMATCH.
- Duplicate first insert trong race có thể trả 409 message duplicate; giữ reference và lookup/lặp thao tác cũ.
- 401/403, 429, 5xx và lỗi mạng không cho phép tạo key mới. Với lỗi auth, phục hồi đúng tài khoản rồi lookup. Không chuyển attempt sang tài khoản khác.

Error handler chung thường trả `{success:false,status,message,code?,requestId?}`; FE không giả định mọi lỗi có code hoặc cùng envelope. Việc ghi rejected sau transaction abort là best effort: nếu DB lỗi ở lần ghi này, attempt có thể vẫn processing dù HTTP trả lỗi nghiệp vụ. Các lỗi trước khi lưu attempt cũng có thể để lookup unknown. Vì vậy luôn đọc trạng thái từ BE, không suy trạng thái bền vững chỉ từ HTTP 4xx. Lỗi 5xx/network có thể xảy ra sau commit; lookup có thể trả created.

## 5. addressHash và tương thích legacy

Products đóng băng BE-validated address ở lần prepare/create đầu tiên nhận thành công. Retry không lấy nội dung mới từ cùng addressId, kể cả địa chỉ sau đó bị xóa. Subscription ràng buộc shippingAddress qua hash payload.

`addressHash` và `data.hash` là hai digest khác nhau:

- `data.hash`: toàn bộ validated request; dùng cho header lookup/terminate.
- `data.addressHash`: riêng snapshot `JSON.stringify({fullName,phone,address,district,city,country})` theo đúng thứ tự trên, sau trim/validation/fallback tên. Hex chữ thường. Optional request addressHash được kiểm tra **chỉ khi tạo attempt products lần đầu**, không kiểm tra lại địa chỉ sống khi retry.

Luồng FE đề nghị ngay: prepare không addressHash → hiển thị snapshot BE trả về để user xác nhận → create với nguyên body/key ban đầu. **Không thêm addressHash trả về vào body create** vì sẽ đổi request hash. Nếu user muốn đổi địa chỉ sau prepare, terminate attempt cũ, chờ canRestart, rồi key mới/prepare mới. Nếu FE đã tính được digest snapshot được hiển thị trước đó, có thể gửi addressHash ngay từ prepare và giữ nguyên ở create; hiện không có endpoint address-revision/digest riêng để bootstrap digest đó. Hash không phải chữ ký hoặc bằng chứng nội dung đã hiển thị cho user.

Legacy addressId-only được hưởng snapshot ổn định từ lần tiếp nhận đầu của BE mới. Không thể chứng minh nội dung user đã thấy trước lần đó, hoặc phục hồi snapshot cho thất bại pre-upgrade. Giữ nguyên key/body cũ khi replay: thêm field, đổi thứ tự thuộc tính, đổi null/empty/default/number có thể gây 409.

Legacy local attempt chưa lưu data.hash: nếu còn body, thử prepare với nguyên body/key để lấy hash khi processing/created. Prepare rejected/invalidated không trả hash; nếu không tái tạo được validated hash cũ một cách xác minh được, **không đoán hash rồi xóa local attempt hoặc tự mua lại**. Cần luồng hỗ trợ/reconciliation hoặc BE recovery bootstrap được thiết kế riêng ở đợt sau. Mất body/key/hash khỏi local storage cũng không được bộ API hiện tại khôi phục bằng danh sách attempt.

## 6. Danh sách công việc FE cụ thể

Đây là điểm tích hợp cần sửa ở repo FE, không phải tên file đã kiểm tra (đợt này không đọc/sửa repo FE).

1. API client: thêm prepare theo kind, lookup và terminate; gửi đúng hai header khác nhau, auth/cookie-CSRF; phân biệt envelope lỗi và không tự retry create với key mới.
2. Persistent attempt store cho checkout và subscription: lưu userId, kind, key, serialized body trước khi gửi; sau prepare lưu hash/snapshot/addressHash/result. Bỏ khóa cứng/xóa key sau 24 giờ. Cô lập tài khoản khi logout/login; lưu PII theo chính sách FE, không log body/token/hash reference tùy tiện.
3. Checkout/cart confirmation: đồng bộ cart → gọi quote → lấy quoteFingerprint → tạo key/lưu body → prepare products → lưu response và hiển thị snapshot/giá → user xác nhận → create body/key nguyên bản. Không cho tab khác sửa cart của cùng attempt trước create nếu muốn giữ dự định mua; prepare không khóa cart. Nếu giá/giỏ đổi và nghiệp vụ từ chối, terminate trước khi chuẩn bị request mới.
4. Subscription purchase: hiển thị tổng trả trước → body có expectedTotalAmount và shippingAddress đúng schema → key/lưu body → prepare subscription → xác nhận → create ở /api/subcribe-plans/user-subscribe. Không dùng cùng key với products; không dùng result replay làm trạng thái activation mới nhất.
5. Recovery khi reload/mất phản hồi: nếu chưa có hash, lặp prepare nguyên body/key; nếu có hash, lookup. Processing cho phép retry cùng payload/key; created chuyển sang màn giao dịch hiện hữu; rejected hiển thị lỗi và nút kết thúc; unknown vẫn giữ trạng thái chưa xác định. Nút “Bắt đầu lại” phải gọi terminate và chỉ mở sau invalidated/canRestart:true. Terminate mất phản hồi thì lookup/lặp terminate, không tự timeout mở khóa.
6. Address editor/selector: sau prepare dùng snapshot để xác nhận, không dựng lại body từ addressId sống; thay địa chỉ là kết thúc attempt cũ rồi key mới. Không trộn request addressHash với response request hash.
7. Payment/QR/order/subscription screens: từ created lấy orderCode gọi order-status; chỉ hiển thị QR khi payable và qrUrl hiện có. Phân biệt chờ thanh toán, hết hạn, bị hủy, hoàn tiền và activation/fulfillment. Không terminate để xóa nghĩa vụ đã tạo.
8. Admin combo form: ownerId merchant là bắt buộc; chọn sản phẩm theo merchant, ID duy nhất và quantity nguyên dương; không gửi product price/value như nguồn tin cậy. POST /api/boxes/create-box nhận JSON hoặc multipart theo router hiện có, trả 201 `{success:true,data:box}`. Thiếu owner/schema lỗi trả 400; owner không hoạt động trả 400; cấu phần thiếu/archived/khác chủ thường 403; edit ownership legacy có thể 409. Thay owner phải xóa lựa chọn cấu phần cũ; không tự gán owner cho admin.
9. Catalog/merchant UI: coi internalSubscription là chuẩn, đọc subscriptionOnly như tương thích bảo thủ khi cần; không dùng form thường để sửa ownership/cờ nguồn. Hiển thị conflict legacy cần đối chiếu, không tự hợp thức hóa combo bằng bỏ cấu phần lỗi.
10. FE acceptance cần thêm: reload/mất response prepare/create/terminate, hai tab dùng cùng key, user switch, session hết hạn, unknown không mở khóa, 24h không tự reset, sửa/xóa địa chỉ sau prepare, stale quote, lỗi không có code, created expired/cancelled không tự mua lần hai. Backend unit/integration không thay thế browser E2E này.

## 7. Migration, kiểm tra trước/sau và rollback

Script bàn giao: `scripts/migrate-commerce-integrity.js`. Không tự load .env; dùng MIGRATION_MONGODB_URI tường minh. Không chạy script lên dữ liệu thật trong đợt này. Ownership lấy từ dry-run của migrate-merchant-ownership: active merchant trên brand và owner product không mâu thuẫn; Box cần cấu phần đồng chủ đã xác minh; template theo Box nguồn. Không suy từ email/tên/admin đã sửa. Không mặc định admin; unresolved giữ nguyên.

Flag audit dùng raw lean data: hai boolean trái nhau là conflict, không nằm trong thay đổi flag tự động. Flag thiếu/null được đề xuất mirror từ giá trị còn lại, hoặc false nếu không có true. Chú ý model Box pre-validate dùng OR và đồng bộ hai cờ khi save thông thường, kể cả dữ liệu trái nhau; đây là xử lý bảo thủ để tránh lộ Box nội bộ, không phải bằng chứng đã đối chiếu conflict. Migration không sửa lịch sử BoxVersion, order hoặc snapshot subscription.

Thứ tự vận hành do người triển khai thực hiện sau:

1. Backup DB và indexes, kiểm tra khôi phục trên clone; lưu manifest ở nơi riêng ngoài Git. Ghi baseline: số bản ghi/owner thiếu/conflict/cờ trái nhau; stock/coupon.usedCount, tổng Checkout/Order/Subscription, payment events/refund obligations/outbox và checksum snapshot lịch sử. Xác minh replica set/transactions, primary/write concern phù hợp, dung lượng và index. Chuẩn bị cửa sổ dừng các catalog/checkout/subscription writers cũ trước cutover; không chỉ dừng HTTP nếu còn worker hoặc instance cũ.
2. Trên staging clone với URI chọn rõ, chạy `node scripts/migrate-commerce-integrity.js --dry-run <manifest-path>`. Khi truyền file, script dùng flag wx nên không ghi đè manifest tồn tại. Rà từng changes/conflicts với merchant/brand/product/Box/template nguồn. Lưu backup, thời điểm, DB name, bản code và quyết định đối chiếu. Conflict có thể còn ở record khác ngay cả khi một thay đổi độc lập trên cùng record được đề xuất; không hiểu manifest apply là tự giải quyết mọi conflict.
3. Đối chiếu dữ liệu unresolved bằng quy trình riêng đã duyệt, không chỉnh conflict tùy tiện trong manifest. Tạo lại dry-run sát thời điểm apply và so với nguồn; tạm dừng writers trong khoảng review/apply. Script CAS chỉ kiểm tra các field before trong manifest, không kiểm tra lại mọi quan hệ nguồn, tuổi manifest hoặc tự chặn tất cả conflicts.
4. Chỉ sau duyệt, set MIGRATION_CONFIRM_DATABASE đúng tên DB và chạy `node scripts/migrate-commerce-integrity.js --apply <manifest-path>`. Apply chỉ dùng các changes đã liệt kê, collection allowlist products/boxes/subscriptiontemplates, transaction, CAS before và postcheck after. CAS không khớp thì transaction abort; không bỏ qua lỗi rồi tiếp tục. Script in fresh verification plan sau commit; lỗi ở bước in plan không có nghĩa transaction apply đã rollback, phải kiểm tra DB trước khi chạy lại.
5. Cutover BE mới với toàn bộ writer cũ đã drain. Tạo/xác minh unique indexes: CheckoutAttempt `{userId:1,kind:1,key:1}`, Checkout `{userId:1,requestKey:1}` và paymentCode hiện hữu. Không drop index Checkout cũ, không rely vào autoIndex production, không thêm TTL attempt. Không cho endpoint terminate phục vụ traffic trong khi còn code cũ có thể tạo đơn mà bỏ qua tombstone. Metadata migration có thể chuẩn bị trước trên staging; production cần cùng cửa sổ kiểm soát writer/cutover.
6. Sau migration: chạy dry-run mới; changes đã apply không còn được đề xuất, unresolved phải khớp danh sách được chấp nhận. Đối chiếu raw owner/cờ với manifest và quan hệ nguồn; checksum/count các trường ngoài ownership/cờ phải giữ nguyên. Kiểm tra tồn kho, coupon, tổng tiền, webhook dedupe/payment/refund và snapshot/fulfillment không đổi. CAS/postcheck script không thay thế kiểm tra nghiệp vụ này.
7. Chạy smoke trên môi trường test/staging: tạo admin combo owner đúng; từ chối cấu phần sai; prepare/create/replay; unknown→terminate→late-create bị chặn; created→terminate không cho restart; address edit vẫn snapshot cũ; webhook/partial payment/refund/subscription. Xác nhận indexes và log không có PII/credentials. Sau đó mới phát hành FE prepare/recovery; giữ tính tương thích client cũ với giới hạn ở mục 5.

Rollback metadata: dừng catalog writers; giữ manifest gốc, set cùng URI và MIGRATION_CONFIRM_DATABASE rồi chạy `node scripts/migrate-commerce-integrity.js --rollback <manifest-path>`. Script đảo thứ tự changes, CAS against after và trả before trong transaction, kiểm tra lại kết quả. Missing field được trả thành **null**, tương đương unassigned về nghiệp vụ nhưng không phục hồi raw BSON missing; nếu cần khôi phục chính xác phải dùng backup đã kiểm chứng. Không chạy rollback hai lần hoặc sau apply chưa xác định kết quả mà không kiểm tra. CAS từ chối khi dữ liệu đã thay đổi; dừng đối chiếu/khôi phục có kiểm soát, không force overwrite.

Rollback app: dừng create/terminate traffic và drain writers trước; ưu tiên bản rollback vẫn hiểu CheckoutAttempt. Không rollback về code bỏ qua tombstone rồi mở checkout lại. Giữ nguyên Checkout/Attempt/key/result, ledger, payment event/refund/outbox, không xóa đơn đã commit để “khôi phục attempt”. FE có thể tắt UX recovery nhưng vẫn phải bảo toàn reference. Hoàn tiền và nghĩa vụ giao đã phát sinh xử lý theo workflow riêng.

## 8. Kiểm chứng và giới hạn

Kết quả và cấu hình xác minh cuối được ghi trong `docs/be-handoff-verification.md`. Redis suite thật chỉ chứng minh rate-limit primitives qua hai client/store, GETDEL một lần và Pub/Sub subscriber; không đồng nghĩa toàn bộ HTTP auth/checkout đã được chạy với Redis production configuration.

Chưa được bộ test hiện tại chứng minh đầy đủ:

- Replica-set nhiều node, primary failover, network partition, kill process hoặc unknown commit-result thật; bài mất response hiện bỏ qua response thành công rồi retry, không cắt socket lúc commit.
- Nhiều process BE/rolling deploy với writer cũ; test concurrency dùng transaction thật trong một process và một replica-set member.
- Browser E2E, multi-tab persistent store, auth cookie/CORS qua reverse proxy, reload/timeout khi prepare/terminate, migration local storage legacy mất hash/body. Các nhánh HTTP prepare/lookup/terminate không có test ma trận đầy đủ; nhiều test gọi trực tiếp service.
- Redis cluster/Sentinel, reconnect/failover/outage, eviction/restart/persistence, multi-process HTTP rate-limit/pubsub propagation. Ordinary tests vẫn tắt REDIS_URL; suite Redis thật bơm client thật vào service bằng spy.
- Cloudinary thật và cleanup khi provider không trả public_id hoặc destroy lỗi; upload/destroy trong test là mock, cleanup hiện best effort, chưa có outbox bền vững cho ảnh orphan.
- Thanh toán ngân hàng thật, chữ ký/provider delivery thực tế, thông báo/email dịch vụ ngoài thật. Webhook test dùng payload giả lập, không chuyển tiền.
- Migration quy mô lớn trên dữ liệu production, giới hạn transaction/time/memory, crash ở bước báo cáo sau commit, mọi tổ hợp CAS/conflict/rollback và khôi phục backup. Test có dry-run/flag conflict/apply/rollback trên dữ liệu nhỏ; rollback không khôi phục missing field byte-for-byte.
- Giỏ hàng/giá không được prepare đóng băng; quoteFingerprint/expectedTotalAmount vẫn optional cho legacy. Cần FE gửi các trường này và xử lý stale data có chủ đích.
- Bootstrap hash recovery cho legacy rejected/invalidated, danh sách attempt khi mất local reference, dọn dữ liệu/PII với retention vô hạn, rate-limit riêng cho prepare/lookup/terminate và chính sách thu hồi key dài hạn chưa được bổ sung trong đợt này.

BE cải thiện ngay tính replay, fencing và snapshot từ lần tiếp nhận đầu; FE phải cập nhật persistence/confirmation/recovery theo mục 6 để có trải nghiệm retry đầy đủ. Không diễn giải số test pass thành bảo đảm cho các môi trường và tình huống chưa diễn tập ở trên.
