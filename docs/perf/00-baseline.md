# TotMartAPI — Báo cáo đo đạc Baseline (Giai đoạn 0)

> [!IMPORTANT]
> **Lưu ý phạm vi đo đạc**: Toàn bộ số liệu trong báo cáo này được đo trên môi trường thử nghiệm cục bộ một node (`MongoMemoryReplSet` 1 node WiredTiger, MongoDB 7.0.14, Docker disposable Redis 7.4-alpine). Đây **KHÔNG** phải số liệu trên môi trường Render hay MongoDB Atlas/Redis trên đám mây. Độ trễ mạng thực tế giữa Render (Singapore) và MongoDB Atlas/Upstash Redis sẽ làm tăng thêm độ trễ cho mỗi thao tác I/O.

---

## 1. Thông tin cấu hình môi trường

- **Node.js**: `v24.14.1` (x64)
- **Hệ điều hành**: Windows 11 (`win32`)
- **MongoDB**: `7.0.14` (WiredTiger, single-member replica set via `mongodb-memory-server`)
- **Redis**: Redis 7.4-alpine (Docker disposable container trên `127.0.0.1:55716/15`)
- **Mục tiêu triển khai thực tế theo khai báo**:
  - **Gói Render**: `Free` (512MB RAM, 0.1 vCPU, tiến trình ngủ sau ~15 phút không có traffic)
  - **Render Region**: `singapore`
  - **MongoDB Atlas Region**: `ap-southeast-1` (Singapore)
  - **Redis Provider**: Upstash Redis (Serverless, TLS `rediss://`, Region Singapore)
- **Mã nguồn script đo**: [`scripts/perf/benchmark-baseline.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/scripts/perf/benchmark-baseline.js)
- **Dữ liệu thô JSON**: [`docs/perf/00-baseline.json`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/docs/perf/00-baseline.json)

---

## 2. Thời gian khởi động (Startup Phases & Cold Start)

Được trích xuất từ các sự kiện log cấu trúc `startup_phase` (với `phase` và `ms`) trong [`src/server.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/src/server.js):

| Giai đoạn khởi động | Sự kiện (`phase`) | Thời gian đo được (`ms`) | Ghi chú |
| :--- | :--- | :--- | :--- |
| Kết nối cơ sở dữ liệu | `connectDB` | **24 ms** | Mở kết nối ban đầu tới MongoDB replica set |
| Kiểm tra sổ cái thanh toán | `assertPaymentLedgerReady` | **62 ms** | Chạy các query `exists` kiểm tra phiên bản ledger |
| Khởi tạo Mongoose Models | `model.init` | **203 ms** | `Promise.all` init 24 models |
| Tạo Index tuần tự | `createIndexes` | **45 ms** | Vòng lặp `for` tuần tự trên tất cả models |
| Kiểm tra Topology Replica Set | `checkTopology` | **1 ms** | Lệnh `hello: 1` xác minh replica set / transactions |
| Khởi động Redis | `startRedis` | **34 ms** | Kết nối client/subscriber Redis |
| **Thời điểm port mở** | `portOpen` | **373 ms** | HTTP server bắt đầu lắng nghe |
| **Liveness 200 OK** | `GET /api/home/live` | **2,219 ms** | Tính từ lúc spawn tiến trình tới khi liveness probe thành công |
| **Readiness 200 OK** | `GET /api/home/health` | **2,224 ms** | Đạt trạng thái sẵn sàng phục vụ (DB ping + Redis ready) |

> [!NOTE]
> Trên môi trường local với MongoDB in-memory, `createIndexes` chỉ mất ~45ms. Tuy nhiên, trên Render kết nối sang Atlas khác host/region, 24 model gọi tuần tự qua mạng sẽ nhân với số round-trip time (RTT), dẫn tới thời gian mở port bị kéo dài hàng giây.

---

## 3. Độ trễ các Endpoint (HTTP Benchmarks)

Mỗi endpoint được khởi động với 10 request warm-up trước khi ghi nhận dữ liệu chính thức:

| Endpoint | Mục đích | Số req | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Min (ms) | Max (ms) | Throughput (req/s) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `GET /api/home/live` | Liveness probe (không ping DB) | 100 | **0.63** | 1.21 | **1.44** | 1.82 | 0.53 | 1.82 | 1,336.8 |
| `GET /api/home/health` | Readiness probe (ping DB + Redis) | 100 | **1.00** | 1.74 | **2.08** | 2.70 | 0.84 | 2.70 | 884.1 |
| `GET /api/products/get-all-products/` | Catalog công khai | 100 | **4.01** | 5.68 | **6.03** | 8.20 | 2.98 | 8.20 | 233.1 |
| `POST /api/home/login` | Xác thực đăng nhập (bcrypt cost 10) | 50 | **225.52** | 231.66 | **235.94** | 251.26 | 220.09 | 251.26 | 4.4 |
| `GET /api/carts/get-cart/:id` | Giỏ hàng có Bearer token | 100 | **5.89** | 7.21 | **7.36** | 11.52 | 4.74 | 11.52 | 163.1 |
| `GET /api/users/get-user-by-id/:id` | Hồ sơ người dùng có Bearer token | 100 | **3.80** | 4.81 | **5.52** | 6.31 | 2.87 | 6.31 | 255.2 |

---

## 4. Đo đạc Docker Build và Image

- **Lệnh thực hiện**: `docker build -t totmart-api:baseline .`
- **Thời gian build**: **28.78 giây** (`28,778 ms`)
- **Kích thước image**: **422 MB**
- **Quan sát layer cache**:
  - Base image: `node:24-bookworm-slim`
  - Bước `npm ci --omit=dev --ignore-scripts` tốn 9.0 giây.
  - Hiện tại image sao chép cả `scripts/` vào container.

---

## 5. Nguyên nhân kỹ thuật của lỗi treo ban đầu (Đã xác minh bằng log)

Trong lần chạy thử nghiệm đầu tiên, script bị kẹt vô thời hạn sau khi in dòng log `MongoDB URI: ...`. Sau khi kiểm tra luồng thực thi và log chi tiết:
1. Tiến trình con khởi chạy `src/server.js` mà không preload `tests/helpers/noDotenv.js`.
2. Do đó, dòng `require('dotenv').config()` trong [`src/server.js`](file:///c:/Users/84862/Desktop/totmart/TotMartAPI/src/server.js) đã tự động nạp file `.env` của môi trường làm việc, chứa biến `REDIS_URL` trỏ tới Upstash Redis trên đám mây (`rediss://default:...@huge-duckling-228694.upstash.io:6379`).
3. Khi không có kết nối internet tương thích hoặc bị chặn socket, bước kết nối Redis trong tiến trình con rơi vào trạng thái chờ hoặc thất bại, khiến endpoint readiness `/api/home/health` trả về HTTP 503 (`not_ready`).
4. Script chạy thử nghiệm ban đầu nuốt stdout/stderr của tiến trình con và lặp vô tận chờ HTTP 200 từ endpoint `/api/home/health` mà không có timeout cứng.
5. **Giải pháp đã khắc phục hoàn toàn**:
   - Thêm timeout cứng toàn cục 120 giây và 30 giây cho từng bước.
   - Forward toàn bộ stdout/stderr của tiến trình con ra màn hình console.
   - Preload `tests/helpers/noDotenv.js` khi fork tiến trình kiểm thử, kết hợp cấp phát Docker disposable Redis riêng biệt và cô lập hoàn toàn môi trường.
