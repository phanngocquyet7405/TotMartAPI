# Hardening Phase 6 — Dead Code and Dependencies Cleanup

## 1. Mục tiêu và bối cảnh

Rà soát và tinh gọn các dependency và mã nguồn không còn được sử dụng:

1. `bcryptjs`: Không còn bất kỳ caller nào trong `src/` (toàn bộ mã xác thực auth đã chuyển sang native `bcrypt`). Chỉ còn 2 script fixture test (`tests/helpers/roundA/build-candidate.js` và `tests/helpers/roundB/build-candidate.js`) đọc file gzip vendor để tính hash đối chiếu.
2. `src/utils/jwt.js`: Rà soát các hàm `generateAccessToken`, `generateRefreshToken`, `generateToken`, `decodeToken`.
3. Phân tích dependency tổng thể bằng `depcheck`.

## 2. Kết quả phân tích và thực hiện

1. **Chuyển `bcryptjs` sang `devDependencies`**:
   - `bcryptjs` được di chuyển từ `dependencies` sang `devDependencies` trong `package.json` và `package-lock.json`.
   - Kết quả: Khi build production với `npm ci --omit=dev`, bundle giảm kích thước và loại bỏ thư viện không dùng ở runtime production; các test fixture vẫn tiếp tục hoạt động đầy đủ.
   - `npm audit --omit=dev --audit-level=high` báo cáo **0 vulnerabilities**.

2. **Đánh giá `src/utils/jwt.js` và tính tương thích ngược**:
   - Grep toàn bộ codebase cho thấy `sessionService.js` là nơi tạo token thật có `sid` (session ID).
   - Theo các hợp đồng tài liệu trong `docs/B08-verification.md` và `docs/FE-BE-contract-handoff.md` ("Compatibility authMiddleware/adminMiddleware/verifyToken và JWT exports còn nguyên"), các export hàm legacy (`generateAccessToken`, `generateRefreshToken`, `generateToken`, `verifyToken`, `decodeToken`) được chủ động giữ lại để đảm bảo không làm gãy các module hoặc integration clients kế thừa.

3. **Phân tích dependency với `depcheck`**:
   - `depcheck` xác nhận `bcryptjs` không có runtime caller trong `src/`.
   - `randomstring` được giữ lại theo quy định bảo toàn tại `docs/B05-inventory.md`.

## 3. Kết quả kiểm chứng

- `npm run lint`: **PASS (debtErrors: 0, violations: [])**.
- `npm run lint:all`: **PASS (0 errors, 0 warnings)**.
- `npm run format:check`: **PASS (checked: 341, invalid: [])**.
- `npm run validate:api`: **PASS**.
- `npm audit --omit=dev --audit-level=high`: **PASS (0 vulnerabilities)**.
