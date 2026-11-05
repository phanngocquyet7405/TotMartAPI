# Báo Cáo Đo Lường Baseline (Giai Đoạn 0)

Ngày thực hiện: 05/11/2026
Môi trường thực thi:
- Node.js: `v24.14.1` (thỏa mãn `>=24 <25`)
- Docker Desktop: `4.96.0` (Docker Engine `29.9.1`, API `1.56`, `linux/amd64` - Đang chạy thực tế)
- Hệ điều hành: Windows 11
- Git branch: `chore/hardening-v1`

---

## 1. Kết Quả Đo Lường Baseline

| Lệnh / Kiểm tra | Trạng thái / Mã thoát | Kết quả đo thực tế | Ghi chú đối chiếu |
|---|---|---|---|
| `npm run lint` | Exit 0 | `{"mode":"lint-baseline","scanned":323,"changed":192,"debtErrors":10,"violations":[]}` | Không có lỗi mới phát sinh so với baseline |
| `npm run lint:all` | Exit 1 | 10 errors, 0 warnings (10 files/vị trí cụ thể) | Khớp chính xác danh sách 10 lỗi ghi trong prompt |
| `npx prettier --check "src/**/*.js"` | Exit 1 | 75 files warn (chưa format đúng chuẩn `.prettierrc.json`) | Khớp chính xác 75 files |
| `npm run format:check` | Exit 0 | `{"mode":"format-check","checked":204,"invalid":[]}` | Script quality format chạy theo danh sách lọc |
| `npm run validate:api` | Exit 0 | `{"operations":11,"examples":8}` | Khớp baseline contract OpenAPI 11 operations |
| `npm audit --omit=dev` | Exit 0 | `found 0 vulnerabilities` | 0 lỗ hổng bảo mật ở production dependencies |
| `npm run test:b01:unit` | Exit 0 | **4/4 suites pass**, **40/40 tests pass**, 0 fail, 0 skip (6.939s) | Harness unit Redis/DB lifecycle |
| `npm run test:b01:http` | Exit 0 | **1/1 suite pass**, **16/16 tests pass**, 0 fail, 0 skip (67.124s) | Khởi tạo Redis container và DB tạm thời trên Docker |
| `npm run test:b01` | Exit 0 | **85/85 suites pass**, **881/881 tests pass**, 0 fail, 0 skip (677.484s) | Chạy toàn bộ test suite repo thành công |

---

## 2. Chi Tiết Các Lỗi ESLint Toàn Repo (`npm run lint:all`)

Tổng cộng: **10 lỗi**:
1. `scripts/review-user-identity.js:82:13`: `'v' is assigned a value but never used` (`no-unused-vars`)
2. `scripts/review-user-identity.js:82:16`: `'ns' is assigned a value but never used` (`no-unused-vars`)
3. `src/controllers/categoryController.js:1:9`: `'valid' is assigned a value but never used` (`no-unused-vars`)
4. `src/controllers/userSubscriptionController.js:5:7`: `'crypto' is assigned a value but never used` (`no-unused-vars`)
5. `src/controllers/userSubscriptionController.js:46:15`: `'attempt' is assigned a value but never used` (`no-unused-vars`)
6. `src/middleware/validationHandler.js:1:7`: `'joi' is assigned a value but never used` (`no-unused-vars`)
7. `src/services/managerService.js:32:13`: `'comboId' is assigned a value but never used` (`no-unused-vars`)
8. `src/utils/logRedaction.js:18:14`: `Unnecessary escape character: \[` (`no-useless-escape`)
9. `tests/boxVersions.integration.test.js:5:21`: `'signToken' is assigned a value but never used` (`no-unused-vars`)
10. `tests/disposableRedis.test.js:8:9`: `Unexpected lexical declaration in case block` (`no-case-declarations`)

---

## 3. Độ Phủ Kiểm Thử (Coverage Baseline từ `npm run test:b01`)

- **Statements**: 76.39% (3310/4333)
- **Branches**: 70.17% (1720/2451)
- **Functions**: 75.03% (478/637)
- **Lines**: 78.30% (3053/3899)
- **Tổng số test suites**: 85/85 passed
- **Tổng số tests**: 881/881 passed (không có test nào fail hay bị skip do thiếu môi trường)
