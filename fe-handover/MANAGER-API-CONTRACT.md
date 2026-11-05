# API tương thích frontend TotMart cleaned

Ngày: 17/10/2026. Browser tiếp tục gọi /api cùng origin, Next rewrite tới backend. Envelope giữ {success, data, pagination}; không thêm lớp data lồng nhau.

## Quyền và nguồn sở hữu

Các endpoint tồn tại trong /api/manager yêu cầu token/cookie còn hiệu lực và role merchant hiện tại trong database. Với ID hợp lệ: guest 401; user/admin 403. Route có ID validator trước guard: ID sai trên request đã xác thực trả 400 trước lỗi role; anonymous vẫn 401. Subpath không tồn tại trong mount manager: anonymous 401, đã xác thực (mọi role) 404, không phải 403. Merchant truy cập tài nguyên của merchant khác thường 404; tham chiếu nguồn/brand/product ngoại lai trong payload có thể 403. Các route admin vẫn riêng cho admin. Merchant chỉ được dùng checkout/quote để ước tính, không được tạo checkout khách hàng hoặc tự đăng ký subscription bằng tài khoản merchant. Các kết quả HTTP đã chạy và nhận xét chỉ từ đọc source được phân biệt trong [biên bản B02](B02-verification.md).

Sản phẩm mới có ownerId server gán, đồng thời brand phải thuộc merchant. Dữ liệu sản phẩm cũ chưa có ownerId chỉ được thấy khi brand thuộc merchant; dữ liệu có ownerId khác không được suy diễn lại. Combo/gift/template dùng ownerId do server đặt. Mọi cấu phần và combo nguồn phải cùng cửa hàng. Các query đọc, cập nhật và stock đều được giới hạn server-side; không tin ownerId từ client.

Catalog option chỉ trả brand thuộc merchant và danh mục còn hoạt động. Merchant mới cần brand để tạo sản phẩm: có POST /api/manager/brands {name}; hoặc admin tạo brand cho merchant bằng POST /api/admin/merchants/:merchantId/brands {name}. Source frontend hiện tại chưa có form onboarding brand mới, có thể dùng API/admin trước khi merchant nhập hàng. Không tự cấp quyền admin cho merchant để giải quyết thiếu brand.

## Sản phẩm

- GET /api/manager/catalog-options → data.brands, data.categories.
- GET /api/manager/products → page, limit (1–100), keyword, brand, category, minPrice, maxPrice; data array + pagination.total/totalPages.
- POST /api/manager/products → JSON hoặc multipart: name, description, price nguyên VND dương, stock nguyên không âm, brand, category, images tối đa 10 (JPG/PNG/WebP, 2 MB mỗi ảnh).
- PUT /api/manager/products/:id → sửa metadata/ảnh, không nhận stock/ownerId.
- PATCH /api/manager/products/:id/stock → {delta, reason?}; delta khác 0, nguyên trong ±1.000.000; không để tồn âm.
- DELETE /api/manager/products/:id → soft archive; từ chối nếu còn tham chiếu trong combo.

## Combo và gift

- GET /api/manager/combos?kind=combo|gift (mặc định combo). /api/manager/gifts là alias danh sách gift.
- POST /api/manager/combos → multipart hoặc JSON: name, descriptions, products:[{productId,quantity}], stock, discountPercent, validTo. Multipart products được parse JSON rồi validate. Giá do server tính từ cấu phần, không nhận value client.
- PUT /api/manager/combos/:id → cập nhật định nghĩa + version, không ghi đè stock. Giữ các guard lịch sử/nghĩa vụ từ boxDefinitionService.
- POST /api/manager/gifts → {name,comboId,stock,validTo,giftPolicy:{bulkTiers:[{minQuantity,percent}],amenities:[{name,fee}]}}. Gift chụp cấu phần/giá/ảnh và version combo nguồn; không tự đổi theo giá combo sau này. Không cho gift hết hạn sau combo nguồn.
- PATCH /api/manager/gifts/:id → {name?,validTo?,giftPolicy?}. Policy là một bản thay thế trọn vẹn nếu gửi. Không đổi nguồn combo bằng cập nhật metadata.
- PATCH /api/manager/combos/:id/stock → dùng cho cả combo/gift.
- DELETE /api/manager/combos/:id → archive combo/gift nếu không còn ràng buộc; template/gift nguồn và nghĩa vụ đang tồn tại có thể trả 409.

Bulk tiers tối đa 10, số lượng 2–999 không trùng; percent 0–100. Amenities tối đa 10, tên 1–100 ký tự, fee nguyên 0–100.000.000 VND. Policy hiện khớp giftEstimate của FE: **mọi amenity cấu hình đều được tính trên từng hộp**, không phải danh sách tùy chọn chọn/bỏ của người mua. Muốn amenity optional phải đổi DTO và UI có lựa chọn, không tự suy đoán.

GET /api/boxes/get-all-box hỗ trợ kind/type=combo|gift và ẩn box nội bộ của retail subscription. GET /api/boxes/public/:id cho combo đang bán và gift mới có sourceComboId; legacy isGift chỉ dùng quà tặng subscription không tự chuyển thành gift thương mại. get-products-in-box cũng ẩn box retail nội bộ.

## Subscription

- GET /api/manager/subscriptions.
- POST /api/manager/subscriptions → {name,description?,boxId,planType,discountPercent,isActive?}; nguồn combo của merchant.
- POST /api/manager/retail-subscriptions → {name,description?,products,stock,validTo,planType,discountPercent,isActive?}; server tạo Box nội bộ để tái sử dụng pin/version/inventory/fulfillment đã có.
- PATCH /api/manager/subscriptions/:id → metadata, kỳ, giảm giá, isActive; chỉ đổi boxId với nguồn combo. Không chuyển sourceType của gói retail.
- PATCH /api/manager/retail-subscriptions/:id/stock → bổ sung tồn Box nội bộ; vẫn dùng được khi template nghỉ bán nhưng còn nghĩa vụ giao đã bán.
- DELETE /api/manager/subscriptions/:id → isActive=false và archivedAt; không hủy gói khách đã mua, không hoàn tiền hoặc xóa snapshot.

Kỳ 1/3/6/12 tháng, trả trước toàn kỳ, giá = giá nguồn × số tháng × (1 − giảm). discountPercent phải <100 và tổng dương; không giả làm auto debit hằng tháng. Giao định kỳ và snapshot tiếp tục qua lifecycle hiện có. Box retail không xuất hiện trong danh sách combo/gift và không mua trực tiếp qua giỏ hàng.

## Đơn hàng

- GET /api/manager/orders hỗ trợ page, limit, status, paymentMethod, search/keyword, from/to dạng YYYY-MM-DD theo UTC+7 và includeUnpaid=true|false.
- Mặc định ẩn online chưa paid; trả meta.hidesUnpaidOnline/hiddenUnpaidOnline để UI giải thích. Không thay dữ liệu lỗi bằng số 0.
- GET /api/manager/orders/:id chỉ trả đơn thuộc merchant.
- PATCH hoặc POST /api/manager/orders/:id/status → {status,expectedStatus?,trackingReference?,note?}. Chỉ processing/shipped/delivered, kiểm tra thứ tự và điều kiện server. Cùng trạng thái đích là retry no-op; expectedStatus giúp chặn cập nhật từ snapshot cũ khi đích chưa đạt.
- Response gồm allowedTransitions. UI dùng danh sách này; backend vẫn validate lại tại lúc ghi. Không hiển thị nút nếu server cũ chưa có capability.
- COD delivered từ merchant không đổi paymentStatus hay paidAt; codCollectionStatus=pending_review. Admin gọi POST /api/checkout/mark-cod-delivered/:id sau đối soát. Repeat action admin là no-op nếu đã paid, không thêm audit lặp.

Projection merchant không trả customerEmail, paymentCode, thông tin receipt/refund nội bộ hoặc các đơn cùng checkout của cửa hàng khác. Địa chỉ giao và dòng hàng của chính đơn vẫn có để fulfillment. Admin vẫn xem được dữ liệu qua route admin.

## Admin gift

- GET/POST /api/admin/gifts; PATCH/DELETE /api/admin/gifts/:id.
- Tạo gift theo combo nguồn đã có ownerId; server giữ chủ nguồn, không chuyển tài sản sang admin đang thao tác. Combo cũ chưa rõ chủ trả 409 để kiểm tra/gán metadata trước.
- Guard giới hạn đúng /admin/gifts và /admin/merchants, không chặn các route notification SSE dùng vé riêng.

## Giá, tồn và lịch sử

Quote/check-out giữ nguồn sự thật ở server. Gift mới được tính giảm theo tổng số cùng gift trên giỏ và cộng phí amenity theo đơn vị; snapshot tổng dòng lưu vào đơn. Inventory khấu trừ/hoàn kho qua transaction cũ. Test đã kiểm tra gift 3 × 200.000, giảm 10%, tiện ích 5.000/hộp → 555.000 (không thu phí ship trong đơn theo policy mới).

Khách trả phí ship trực tiếp cho bên giao hàng. Quote/check-out mới không thu phí ship trong tiền COD/chuyển khoản; shippingFee=0 và shippingPayment=customer_to_carrier. Đơn cũ giữ snapshot và số tiền cũ. API addresses có fullName tùy chọn; FE đã sửa tên trường và lưu địa chỉ mới bằng API. Xem COMMERCE-FE-V2.md để biết phạm vi và giới hạn nghiệm thu.

## Bổ sung B02 (20/10/2026)

Manager dùng authenticate chung rồi validate ID (nếu route có ID), requireMerchant, validation payload và controller. Role lấy từ DB mỗi request; admin không được truy cập manager và ownership không đổi. ID sai trên request đã xác thực có thể trả 400 trước lỗi role 403. Xem [B02](B02-verification.md) cho bằng chứng và giới hạn.
