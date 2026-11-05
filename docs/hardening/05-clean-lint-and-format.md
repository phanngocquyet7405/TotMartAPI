# Hardening Phase 5 — Clean Lint and Format

## 1. Mục tiêu và bối cảnh

Trước Phase 5:

- ESLint tồn tại 7 lỗi nợ kỹ thuật thực tế (vốn được bỏ qua bởi cơ chế `tooling/lint-baseline.json` cũ):
  - `scripts/review-user-identity.js`: unused vars `v`, `ns` trong destructuring index options.
  - `src/controllers/categoryController.js`: unused var `valid` từ require('joi').
  - `src/middleware/validationHandler.js`: unused var `joi`.
  - `src/utils/logRedaction.js`: regex thừa escape `\[` trong character class `/[\[\]]+/`.
  - `tests/boxVersions.integration.test.js`: unused var `signToken`.
  - `tests/disposableRedis.test.js`: `no-case-declarations` (lexical declaration `const port` không nằm trong block của `case 'create':`).
- Prettier báo 121 file không tuân thủ `.prettierrc.json` (`singleQuote: true`, `printWidth: 100`, `endOfLine: lf`).

## 2. Các thay đổi đã thực hiện

1. **Sửa dứt điểm tất cả lỗi ESLint thật mà KHÔNG dùng `eslint-disable` hay nới lỏng rules**:
   - `scripts/review-user-identity.js`: Tách options bằng cách delete `key`, `v`, `ns` khỏi bản sao shallow copy thay vì bind biến thừa.
   - `src/controllers/categoryController.js`: Xóa import `const { valid } = require('joi')` không dùng.
   - `src/middleware/validationHandler.js`: Xóa import `const joi = require('joi')` không dùng.
   - `src/utils/logRedaction.js`: Đổi regex thành `/[[\]]+/` hợp lệ; kiểm chứng bằng `tests/logRedaction.test.js` pass 100%.
   - `tests/boxVersions.integration.test.js`: Xóa import `signToken` không dùng.
   - `tests/disposableRedis.test.js`: Đóng gói `case 'create': { ... }` trong block riêng biệt để phạm vi biến không bị leak.

2. **Chuẩn hóa toàn diện định dạng bằng Prettier**:
   - Chạy `npx prettier --write` trên toàn bộ các thư mục `src`, `scripts`, `tests`, `eslint.config.cjs`, `jest.config.js`.
   - Kết quả: 100% file trong repo đều tuân thủ cấu hình Prettier (`All matched files use Prettier code style!`).

3. **Tái tạo `tooling/lint-baseline.json` sạch hoàn toàn**:
   - Cập nhật baseline với 331 files và **0 issues**.
   - `npm run lint` và `npm run lint:all` đều đồng thuận báo **0 errors, 0 warnings, 0 debt**.

4. **Audited Commerce Coverage Baseline Version 5**:
   - Do Prettier định dạng lại 4 file trong diện giám sát (`boxDefinitionService.js`, `inventoryService.js`, `merchantScope.js`, `subscriptionService.js`), hash của các file này được cập nhật vào `tooling/commerce-coverage-baseline.json` theo đúng quy trình kiểm soát với bằng chứng `docs/hardening/phase5-format-review.json`.
   - Bảo toàn tuyệt đối số lượng branch và coverage requirement (0 failures trên cả 8 modules).

## 3. Kết quả kiểm chứng

- `npm run lint:all`: **PASS (0 errors, 0 warnings)**.
- `npm run lint`: **PASS (scanned: 331, debtErrors: 0, violations: [])**.
- `npm run format:check`: **PASS (checked: 341, invalid: [])**.
- `npx prettier --check "src/**/*.js" "scripts/**/*.js" "tests/**/*.js" "eslint.config.cjs" "jest.config.js"`: **PASS (All matched files use Prettier code style!)**.
- `npm run validate:api`: **PASS (11 operations, 8 examples validated)**.
- `npm run test:b01`: **PASS (89/89 test suites, 919/919 tests, 100% pass, time: 645s)**.
- `node scripts/check-commerce-coverage.js`: **PASS (policy: 5, modules: 8, failures: [])**.
