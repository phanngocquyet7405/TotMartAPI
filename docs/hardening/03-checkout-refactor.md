# Hardening Phase 3 — Checkout & Pricing Safe Refactoring

## 1. Mục tiêu và bối cảnh

Phase 3 tập trung vào việc giảm trùng lặp logic và rủi ro lệch pha (divergence) giữa 2 luồng tạo đơn hàng chính của hệ thống:

- Luồng 1: **COD checkout** (`src/controllers/checkOutController.js`)
- Luồng 2: **Online QR settlement** (`src/services/paymentReconciliationService.js`)

Trước Phase 3, hai luồng này tự tạo mảng `Order` từ `quote.groups` với logic tính toán phụ phí gói quà (`giftWrapFee`), chiết khấu coupon (`couponDiscount`), địa chỉ giao hàng (`shippingAddress`), paymentCode và trạng thái đơn hàng lặp lại độc lập, dễ dẫn đến sai lệch khi cập nhật schema hoặc chính sách tính giá.

Đồng thời, hàm `buildQuote` trong `src/services/pricingService.js` có độ dài hơn 250 dòng với nhiều trách nhiệm lồng nhau (lock box, nạp product, validate tồn kho, áp dụng chiết khấu combo/bulk, tính allocation cho từng item và tổng hợp fingerprint).

## 2. Các thay đổi đã thực hiện

1. **Characterization Test (`tests/orderCharacterization.integration.test.js`)**:
   - Thiết lập cart đa merchant hỗn hợp (sản phẩm đơn, combo box, gift wrap, coupon giảm giá).
   - Chạy đồng thời qua cả COD flow và Online QR settle flow.
   - Assert rằng kết quả `Order` (items, boxItems, gifts, discounts, shippingAddress, merchantId) được chuẩn hóa của cả hai luồng là hoàn toàn tương đồng 100%.

2. **Order Factory Module (`src/services/orderFactory.js`)**:
   - Trích xuất hàm thuần túy `createOrdersFromGroups({ quote, shippingAddress, paymentMethod, paymentCode, user, initialStatus })`.
   - Kết nối thống nhất vào cả COD checkout (`checkOutController.js`) và settlement reconciler (`paymentReconciliationService.js`).

3. **Chuẩn hóa Coupon Rollback**:
   - Khi hủy session cũ để tái sử dụng attempt (`reuseSession`), `checkOutController.js` ưu tiên hoàn trả coupon trực tiếp bằng `_id: quote.couponId, usedCount: { $gt: 0 }`, fallback về `couponCode`.
   - `pricingService.js` trả về trường `couponId` trong kết quả tính discount.

4. **Modular hóa `buildQuote` (`src/services/pricingService.js`)**:
   - Tách thành 8 hàm chuyên biệt (< 75 dòng mỗi hàm):
     - `normalizeAndExtract`: trích xuất danh sách productId, boxId và kiểm tra rỗng.
     - `lockAndValidateBoxes`: nạp snapshot BoxDefinition theo revision và validate version.
     - `loadAndValidateProducts`: nạp product records, kiểm tra active/deleted và tồn tại.
     - `calculateStandaloneBulkDiscounts`: tính discount bán sỉ cho sản phẩm đơn.
     - `expandLineItemsAndBoxes`: bung chi tiết dòng sản phẩm và gán giá/phí gói quà.
     - `validateAggregatedStock`: kiểm tra tổng số lượng tồn kho khả dụng của sản phẩm và box.
     - `buildBoxSummaries`: đóng gói danh mục tóm tắt box và items thành phần.
     - `calculateTotalsAndFingerprint`: phân bổ coupon discount theo tỷ lệ merchant, tính grand total và tạo fingerprint chống tráo đổi.

5. **Tách Controller cho Routes inline**:
   - Tách các handler inline trong `src/routes/adminCommerceRouter.js` vào `src/controllers/adminCommerceController.js`.
   - Tách các handler inline trong `src/routes/reconciliationRouter.js` vào `src/controllers/reconciliationController.js`.

6. **Audited Commerce Coverage Ratchet (`tooling/commerce-coverage-baseline.json`)**:
   - Cập nhật baseline lên phiên bản policy 4.
   - Ghi nhận `docs/hardening/phase3-coverage-review.json` chứng minh không có bất kỳ regression nào về covered branches (pricingService giữ nguyên 93/104 branches, paymentReconciliationService giữ nguyên 114/178 branches).

## 3. Kết quả kiểm chứng

- `npm run lint`: 0 violations.
- `npm run format:check`: 0 invalid.
- `npm run validate:api`: PASS (11 operations, 8 examples).
- `npm test -- --runTestsByPath tests/orderCharacterization.integration.test.js ...`: 7 suites passed, 49 tests passed.
- `npm run test:b01`: 88/88 test suites passed, 896/896 tests passed (100% pass, 0 fail, 0 skip).
- Commerce coverage gate: 8/8 monitored modules passed, 0 failures.
