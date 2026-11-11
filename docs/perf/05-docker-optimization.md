# TotMartAPI — Báo cáo Tối ưu Docker Build & Image Size (Giai đoạn 5)

## 1. Mục tiêu và phạm vi thực hiện
Giai đoạn 5 tập trung tối ưu hóa quy trình đóng gói container Docker để giảm kích thước image, giảm build context, và rút ngắn tối đa thời gian build / pull image trên Render:
1. **Multi-stage build trong [`Dockerfile`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/Dockerfile)**:
   - **Stage 1 (`builder`)**: Dùng `node:24-bookworm-slim`, cài đặt `npm ci --omit=dev --ignore-scripts` và dọn dẹp `npm cache clean --force`.
   - **Stage 2 (`runner`)**: Dùng `node:24-bookworm-slim`, chỉ sao chép thư mục `node_modules` đã hoàn thiện từ stage builder và thư mục mã nguồn `src/`.
   - Loại bỏ hoàn toàn `package-lock.json`, npm cache, và thư mục `scripts/` khỏi image runtime cuối cùng.
   - Giữ nguyên base image `node:24-bookworm-slim` theo khuyến nghị để bảo đảm tính tương thích nhị phân của `bcrypt` (C++ native addon) với `glibc`, tránh rủi ro crash runtime khi sử dụng Alpine (`musl libc`).
2. **Chuẩn hóa [`.dockerignore`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/.dockerignore)**:
   - Loại trừ triệt để toàn bộ thư mục và tài liệu không phục vụ runtime: `tests/`, `docs/`, `scripts/`, `coverage/`, `artifacts/`, `.git/`, `.github/`, `tooling/`, `.env*`, `*.md`, `compose*.yml`, cấu hình linter/test.
   - Giảm build context gửi tới Docker daemon xuống mức tối thiểu.
3. **Bảo mật và tiêu chuẩn vận hành**:
   - Chạy dưới người dùng không đặc quyền `USER node` (`UID 1000`).
   - Giữ nguyên chỉ thị `HEALTHCHECK` thăm dò `/api/home/health` sau mỗi 30s.
   - Giữ nguyên `CMD ["node", "src/server.js"]` và cổng `EXPOSE 3001`.
4. **Bộ test tự động hóa regression**:
   - Thêm suite kiểm thử tự động [`tests/dockerBuildVerification.test.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/tests/dockerBuildVerification.test.js) xác minh cấu trúc multi-stage, các mẫu trong `.dockerignore`, quyền `node`, tính năng hash của `bcrypt` và sự vắng mặt của các tệp cấm trong container.

---

## 2. Bảng so sánh chỉ số đo đạc (Baseline Phase 0 vs Phase 5)

| Chỉ số đo đạc | Giai đoạn 0 (Baseline) | Giai đoạn 5 (Tối ưu) | Mức cải thiện (%) |
| :--- | :---: | :---: | :---: |
| **Build Context transferred** | ~36 MB | **364 kB** | **-99.0%** |
| **Thời gian Docker build (no cache)** | 28.78 s | **19.57 s** | **-32.0%** (Nhanh hơn 9.2s) |
| **Compressed Content Size** | 89.5 MB | **89.0 MB** | Tối ưu loại bỏ scripts/artifacts |
| **Uncompressed Disk Usage** | 422 MB | **418 MB** | Loại bỏ hoàn toàn build tooling/scripts |
| **Quyền thực thi runtime** | `node` (UID 1000) | `node` (UID 1000) | Non-root an toàn |
| **Native Bcrypt Verification** | OK | **OK (hashSync functional)** | Đảm bảo tính tương thích 100% |
| **Tệp cấm trong `/app`** | Không | **Không (`[]`)** | Sạch hoàn toàn |

---

## 3. Kết quả kiểm chứng tự động

- **Docker Verification Suite**: [`tests/dockerBuildVerification.test.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/tests/dockerBuildVerification.test.js): **3/3 PASS** (2.55s).
- **Targeted Unit / Integration Tests**: 55/55 passed (`httpKeepAliveAndCompression.test.js`, `authPerformance.test.js`, `apiContract.test.js`, `stockAdjust.test.js`, `resolveEnvironment.test.js`).
- **Auth Boundary & Security Regression**: 38/38 passed (`accountLock.test.js`, `passwordResetStreams.test.js`, `authBoundary.integration.test.js`).
- **Quality Gates**:
  - `npm run format:check`: 348 files checked, 0 invalid.
  - `npm run lint`: 338 files scanned, 0 debt errors, 0 violations.
  - `npm run validate:api`: 28 operations, 12 examples validated.
