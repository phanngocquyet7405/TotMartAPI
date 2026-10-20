# Hợp đồng bàn giao FE — B08-20261020.1

Ngày 20/10/2026, Asia/Bangkok (UTC+7). Đây là bản tổng hợp hiện hành để tích hợp; source và các hợp đồng chi tiết được fingerprint cùng nhau. Không thay thế browser E2E hoặc cấp quyền triển khai. Kết luận nghiệm thu tại [B08](B08-verification.md), candidate tại [BE release candidate](BE-release-candidate.md), vấn đề cần owner tại [open issues](BE-open-issues.md).

Contract bundle: **122 file**, SHA-256 **`df911be1070f05a5fdd6ae326482a541a59068e9c4cb3a0f29290d0a59eabfd6`**. Manifest `artifacts/b08/contract-fingerprint.json` gồm toàn bộ src và bảy tài liệu/spec/example hợp đồng, hash byte từng file rồi hash JSON manifest được sắp theo path, indent2 và LF cuối. Bản tổng hợp này và báo cáo sinh sau test có hash riêng trong release seal, tránh tự tham chiếu. B08 không đổi endpoint, body, response, ownership, money, claims hay hash legacy.

## Endpoint và envelope quan trọng

- `POST /api/home/login`: email/password/rememberMe; 200 `{success:true,message,token}` và cookie; có thể thêm `passwordChangeRequired`/`passwordPolicyReason`. Sai credential401, locked403, validation400, quota429, Redis lỗi503. Không coi mọi lỗi là sai password.
- `POST /api/home/refresh`: cookie refreshToken; 200 `{success:true,token}` và cookie mới; 401 cho family hết hạn/revoke/reuse ngoài budget. `POST /api/home/logout` xác thực phiên và thu hồi đúng sid hiện tại; reset/lock thu hồi toàn user theo policy có sẵn. Các write cookie cần CSRF header bên dưới.
- `POST /api/users/register`: name3–100, email/password; role do BE quyết định;201 `{success:true,message,data:user}` qua serializer bỏ password/reset/refresh fields. Tên trùng được phép sau migration index đúng; email canonical conflict409; display-name index cũ có thể503 `IDENTITY_MIGRATION_REQUIRED`. Không tự retry liên tục hoặc coi503 là đăng ký đã thành công.
- `POST /api/checkout/quote`: items/couponCode; 200 dữ liệu giá/phí/fingerprint; quote không giữ giá hoặc kho. `POST /api/checkout/check-out`: addressId/paymentMethod, tùy chọn note/couponCode/quoteFingerprint/addressHash; 201 gồm orderId/orderCode/totalAmount/shippingPayment. Replay thành công cũng201 và kết quả cũ.
- `POST /api/subcribe-plans/user-subscribe`: templateId/shippingAddress, tùy chọn expectedTotalAmount; 201 với subscription snapshot, orderCode/totalAmount. Trả trước toàn gói; tạo subscription chưa phải kích hoạt/giao hàng. expectedTotalAmount khác giá hiện tại409. Giữ spelling `subcribe` và `check-out`.
- `GET /api/checkout/order-status/:paymentCode`: trạng thái tiền mới nhất và payable/QR khi đủ điều kiện; result của attempt là replay snapshot, không thay thế polling trạng thái tiền. Shipping `customer_to_carrier` không được cộng lại vào khoản BE thu.
- Error không hoàn toàn đồng nhất giữa endpoint: errorHandler thường `{success:false,status,message,requestId,...code/fields/errors}`; validator/attempt-reference/auth có envelope riêng được giữ. Không dựa chỉ vào text hoặc giả định mọi error đều có code. OpenAPI là **11 operations/8 examples**, chỉ là subset; đọc source và hợp đồng chi tiết cho phần còn lại.

## Auth, session, cookie và expiry

Access JWT giữ userId/role/name/email/tokenVersion/sid. `verifyToken` và các export JWT legacy vẫn còn. Role trong JWT không cấp quyền: mỗi request đọc User hiện hành, active/tokenVersion và session tương ứng. Production/staging bắt buộc sid, family chưa hết hạn/revoke; token legacy thiếu sid cần login lại. User đã xóa có thể404, locked403, invalid JWT/session401. FE không suy role/owner từ claim để vượt kiểm BE.

Cookie token/refreshToken: HttpOnly, Secure trong staging/production, SameSite=Lax, path `/`. Browser gửi credentials. Write dùng cookie mà không có Authorization cần **`X-TotMart-Request: 1`**; Origin phải thuộc CORS allowlist. Strict mode yêu cầu public HTTPS origins và Redis TLS. Cấu hình proxy thật phải được owner kiểm chứng; test loopback không chứng nhận cookie/TLS triển khai.

Actual access lifetime dùng `JWT_EXPIRES_IN`, default15m. `JWT_ACCESS_EXPIRES_IN` default30m chỉ cho helper legacy. Opaque refresh family có hạn tuyệt đối30 ngày từ login, không sliding; cookie persistent tối đa30 ngày khi rememberMe. `JWT_REFRESH_EXPIRES_IN` chỉ còn ý nghĩa helper JWT legacy (helper7d/config property30d), không điều khiển family opaque.

Refresh retry: tối đa2 duplicate, consumed age **<30s**, successor vẫn current, user/version/family còn hợp lệ. Ngoài điều kiện thì401 và revoke đúng family; history cap4096 không cắt evidence. Hai tab có thể vượt budget hoặc Set-Cookie về sai thứ tự; BE không giải quyết toàn bộ race browser. Coalesce/serialize refresh và kiểm subject trước replay request; không khôi phục credential cũ. Outbox/PubSub đóng SSE, DB heartbeat là dự phòng; không có hard deadline khi DB I/O bị treo. Redis hỏng đóng bảo mật, không fallback production memory.

## Prepare, recovery và lần mua độc lập

Mỗi reference là user đã xác thực + kind (`products`/`subscription`) + key16–128, regex `^[A-Za-z0-9_-]{16,128}$`, ràng buộc hash. Giữ body gốc **trước network** và giữ key qua retry/reload. Key create/prepare ở `Idempotency-Key`; production bắt buộc, staging/dev còn fallback legacy nên FE luôn phải gửi key. Không chia sẻ key giữa kind. Hash do BE tính từ `JSON.stringify(req.validatedBody)` sau Joi conversion/defaults/stripUnknown; giữ thứ tự, không tự canonicalize hoặc tính lại hash FE.

`POST /api/checkout/attempts/:kind/prepare` (hai route kind cụ thể) trả200 data key/hash/state; product processing có address/addressHash snapshot, subscription không có. Prepare trước hash có thể lỗi ADDRESS_NOT_FOUND400, ADDRESS_CHANGED409 hoặc INVALID_DELIVERY_ADDRESS422. Prepare không giữ cart/price; create vẫn kiểm quote và transaction. Prepare key đã commit trả created/result cũ.

`GET /api/checkout/attempts/:kind/:key`, header **Attempt-Payload-Hash**64 hex thường, trả200 unknown/processing/rejected/invalidated/created. Foreign user là namespace riêng, có thể200/unknown; admin không override. Lookup không tự ghi tombstone. `POST .../:key/terminate` dùng hash đó; 200 invalidated/canRestart hoặc created/result/canRestart:false. Terminate không hủy đơn hoặc hoàn tiền.

Khi chưa nhận hash: `POST .../:key/terminate-with-body` gửi **nguyên body đã lưu**, không cần hai header key/hash (key ở path). Dùng cùng Joi create nhưng không tra lại địa chỉ/template. 200 trả key/hash và invalidated+canRestart:true, hoặc created+result+canRestart:false. Body không qua validation trả400 và **không fence**, không cấp quyền restart. Nếu mất response, retry nguyên path/body. Không sửa body để thử vô hiệu hóa reference cũ.

Mismatch409 `ATTEMPT_PAYLOAD_MISMATCH`, invalidated create409 `ATTEMPT_INVALIDATED`, invalid reference400 `INVALID_ATTEMPT_REFERENCE`, admission cap429 `ATTEMPT_CAPACITY_REACHED`; lỗi create cross-kind có thể `IDEMPOTENCY_KIND_CONFLICT`. Timeout/unknown/400/404/5xx không chứng minh giao dịch chưa commit. Chỉ restart recovery sau invalidated + canRestart:true đúng reference. Rejected cần terminate; không tự tạo key thay thế. Durable attempt cap10000/user đếm mọi state; quota attempts IP300/phút/user120/phút, backoff theo Retry-After; không TTL/xóa tombstone để mở quota.

Created là một nghĩa vụ đã tồn tại. Khôi phục result cũ trước. Hành động chủ động “Mua lần mới/Đăng ký gói mới” tạo UUID độc lập, giỏ/quote/xác nhận mới và giữ reference cũ trong lịch sử; canRestart:false không cấm giao dịch độc lập do user xác nhận. Không mở mua mới tự động từ timeout, unknown, expired payment hoặc cancel. Replay key cũ không tiêu thụ giỏ mới. Giá/địa chỉ/merchant/BoxVersion đã bán không tính lại từ catalog/profile mới.

## Email/password transition

Name là display name, không dùng làm identity. Email mới = JS trim().toLowerCase(); không bỏ dấu chấm/+tag hay tự merge account. Exact legacy email ưu tiên; canonical fallback chỉ chọn khi đúng một ứng viên, ambiguity login401/forgot200 chung. Login không tự rewrite email legacy. Update profile không mở quyền đổi email/password/role. Collision/index migration cần manifest/operator quyết định, chưa chạy shared.

Password mới/reset: tối thiểu8 ký tự, well-formed Unicode, **tối đa72 UTF-8 byte**, không trim/normalize/truncate/prehash. Login giữ legacy input; input dài vẫn có thể verify bcrypt legacy, trả `passwordChangeRequired:true`, reason `LEGACY_BCRYPT_BYTE_LIMIT`, không âm thầm rehash phần suffix đã bị legacy bcrypt bỏ qua. Cần luồng reset chủ động. Bcrypt default12, env10–15, không hạ cost đã lưu. Reset token single-use10 phút, body token và query alias legacy còn hỗ trợ; reset thu hồi phiên/outbox. Forgot trả cùng200 khi thiếu account, ambiguity hoặc provider failure; chưa chứng nhận constant-time toàn request/provider latency.

## Tiền, subscription và quyền vận hành

Webhook `/api/checkout/sepay-webhook` dùng SePay auth, không dùng JWT admin/customer; kiểm account, positive safe-integer VND, dedup provider identity/reference và payload. HTTP200 retry_required là receipt đã được lưu để worker xử lý, không chứng minh checkout paid. Partial/overpaid/late/unmatched có trạng thái riêng; không tự cấp hàng từ một notification FE. Paid nhưng thiếu kho có thể on_hold. Principal và tiền thừa hoàn riêng, không cộng surplus lần nữa.

Refund admin: `/api/admin/reconciliation/allocate`, `/refund-receipt`, `/refunds/:_id/complete`; Idempotency-Key16–128 bắt buộc, body giữ qua response mơ hồ. Complete cần amount khớp pending refund, reference3–150 và evidence/reason10–500;200/replay không tạo audit/transfer thứ hai,409 nếu amount/key/payload/state không khớp. Chỉ pending chưa phải đã chuyển tiền. Bank reference unique; actual chuyển tiền cần bằng chứng vận hành. Route legacy `/api/checkout/complete-refund/:_id` còn hỗ trợ qua policy hiện có, không cho merchant xác nhận tiền.

Customer order/subscription scope theo user; foreign subscription404, foreign existing product cancel403. Manager chỉ merchant hiện hành và merchantId/ownerId đã lưu, admin không override manager; merchant không phân bổ receipt/refund/COD settlement. COD delivered + payment pending/pending_review là hợp lệ cho tới admin đối soát. Subscription fulfillment vẫn qua admin/scheduler, không suy ra quyền từ merchant product order. BoxVersion/address/price/owner snapshots giữ nguyên; cancel khi đang dispatched bị từ chối. Product box checkout có group hold/cancel bảo vệ toàn nhóm khi có box; không đổi policy này để chia lại nghĩa vụ đã bán.

## Đối chiếu FE chỉ đọc và cổng tích hợp

FE HEAD `6ecc0fe60cee74407d6d76e53bba8f03c704fbc8`; source fingerprint421 file `2e58715d9be531400d05b7fd53922946e4087f1325e931e562fb26720fab833b`, kèm working-tree status tại `artifacts/b08/fe-readonly-status.txt`. Đây không phải khẳng định FE sạch; nội dung working tree mới là đối tượng đã đọc. Không sửa FE hoặc chạy browser/build/test FE.

Source đã có: axios credentials/CSRF và coalesced refresh/subject checks; attemptLifecycle giữ serialized body, terminate-before-hash, unknown không tự restart; purchaseAttempt dùng browser lock, durable created history và startNewPurchase; Checkoutpageservice/subscribePlanService giữ route legacy; reconciliationService lưu key/signature trước request. Đây là source inspection, không phải browser E2E hay provider proof.

Phần FE bắt buộc review trong đợt FE tiếp theo: register/reset cần diễn đạt/validate72 UTF-8 byte và Unicode theo BE; login hiện chỉ lưu token/điều hướng, chưa thấy xử lý passwordChangeRequired/reason trong src. PasswordRecovery.jsx hiện gộp mọi reset400 thành link hết hạn, trong khi password validation400 có thể giữ token còn hợp lệ; FE cần phân biệt/hiển thị lỗi phù hợp thay vì kết luận token hỏng. Đây là đối chiếu source với HTTP contract, chưa tái hiện browser. Owner cần chốt UX reset cho account legacy và kiểm thông báo400/503/409. Không có yêu cầu đổi DTO/route vì sửa verifier/backup/CI nội bộ BE. Bản export checkoutApi không gửi key chưa thấy caller trực tiếp trong src đã tìm; không suy ra có thể xóa export.

Trước GO nghiệm thu FE: browser reload/mất response prepare/create/terminate, hai tab/refresh budget/Set-Cookie, user switch, sid expiry/revoke/SSE, địa chỉ đổi/xóa, quote drift, created replay và explicit new purchase, form byte-limit/legacy reset; chạy qua cookie/TLS/proxy đích được duyệt. API/Mongo/Redis local pass không thay các ca đó. Đề xuất bàn giao contract **conditional**, owner approval pending; chưa đạt rubric85 và chưa có production authorization.

Tài liệu chi tiết: [attempt](checkout-attempt-contract.md), [commerce](UNIFIED-COMMERCE-CONTRACT.md), [manager](MANAGER-API-CONTRACT.md), [merchant](MERCHANT-OPERATING-MODEL.md), [refresh family](refresh-family-policy.md), [OpenAPI subset](api.openapi.json).
