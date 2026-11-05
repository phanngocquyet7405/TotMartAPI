# Báo cáo Giai đoạn 9: Auth Hiệu năng & Kiểm tra Index

## 1. Mục tiêu & Nguyên tắc thiết kế
Mỗi request xác thực trong TotMart BE thực hiện hai truy vấn cơ sở dữ liệu:
1. `User.findById(decoded.userId)`: Lấy thông tin user hiện hành từ DB để đảm bảo `isActive` và lấy đúng `role` hiện thời (không tin tưởng claim tĩnh từ JWT token cũ).
2. `AuthSession.exists({ sessionId: decoded.sid, userId: user._id, tokenVersion: user.tokenVersion, revokedAt: null, expiresAt: { $gt: new Date() } })`: Kiểm tra tính hợp lệ của phiên đăng nhập nhằm hỗ trợ thu hồi tức thì (instant revocation) khi đăng xuất hoặc đổi mật khẩu.

Theo hợp đồng bảo mật tại `AGENTS.md`, đây là thiết kế có chủ đích cho mô hình security fail-closed, **không được thêm cache tầng ứng dụng hoặc bỏ qua kiểm tra DB**.

Nhiệm vụ của Giai đoạn 9 là:
- Dùng `explain('executionStats')` để chứng minh 100% hai truy vấn này sử dụng index, tuyệt đối không bị `COLLSCAN`.
- Đánh giá cấu trúc index hiện tại và đề xuất nếu cần.
- Đo độ trễ cục bộ (latency p50, p95) trên endpoint có auth trong môi trường 1 node.

---

## 2. Kết quả Phân tích Index qua `explain('executionStats')`

Integration test được xây dựng tại [tests/authPerformance.test.js](file:///c:/Users/84862\Desktop\totmart\TotMartAPI\tests\authPerformance.test.js).

### 2.1. Truy vấn `User.findById`
- **Bộ lọc**: `{ _id: ObjectId(...) }`
- **Winning Plan Stage**: `IDHACK` / `IXSCAN`
- **Index sử dụng**: `_id_` (Primary Index mặc định của MongoDB)
- **Số tài liệu quét (`totalDocsExamined`)**: 1
- **Số key quét (`totalKeysExamined`)**: 1
- **Đánh giá**: Tối ưu tuyệt đối (`O(1)`), không có `COLLSCAN`.

### 2.2. Truy vấn `AuthSession.findOne / exists`
- **Bộ lọc**: `{ sessionId: "...", userId: ObjectId(...), tokenVersion: 0, revokedAt: null, expiresAt: { $gt: Date(...) } }`
- **Winning Plan Stage**: `FETCH` -> `IXSCAN`
- **Index sử dụng**: `sessionId_1` (Unique Index tạo từ schema `sessionId: { type: String, required: true, unique: true }`)
- **Số tài liệu quét (`totalDocsExamined`)**: 1
- **Số key quét (`totalKeysExamined`)**: 1
- **Đánh giá**:
  - Do `sessionId` là UUIDv4 duy nhất toàn cục và đã có unique index `sessionId_1`, MongoDB query planner lập tức chọn index này và thu hẹp không gian tìm kiếm xuống đúng 1 document duy nhất trước khi kiểm tra các điều kiện phụ (`userId`, `tokenVersion`, `revokedAt`, `expiresAt`) trên document đã fetch.
  - **Khuyến nghị về Index**: Không cần tạo thêm composite index (ví dụ `{ sessionId: 1, userId: 1, tokenVersion: 1 }`). Việc thêm compound index trên trường UUID duy nhất sẽ không làm tăng tốc độ truy vấn (vốn đã chỉ quét 1 key và 1 doc) nhưng lại làm tăng chi phí ghi/ghi nhật ký index khi tạo phiên mới (`AuthSession.create`) và tốn bộ nhớ RAM của WiredTiger cache. Cấu hình index hiện tại là tối ưu và tuân thủ chặt chẽ nguyên tắc bảo toàn index trong `AGENTS.md`.

---

## 3. Kết quả Benchmark Độ trễ Cục bộ (Local Single-Node)

Đo đạc 100 requests liên tiếp đến endpoint có xác thực token đầy đủ (`GET /api/users/me`) trên cùng một tiến trình ứng dụng kết nối Replica Set cục bộ (WiredTiger):

| Chỉ số | Giá trị |
| :--- | :--- |
| **Số lượng request** | 100 requests (sau warm-up) |
| **Tỷ lệ thành công (HTTP 200)** | 100% (100/100) |
| **Độ trễ thấp nhất (Min)** | **4.76 ms** |
| **Độ trễ trung bình (Mean)** | **5.95 ms** |
| **Độ trễ trung vị (p50)** | **5.81 ms** |
| **Phân vị 95 (p95)** | **7.80 ms** |
| **Phân vị 99 (p99)** | **10.37 ms** |
| **Độ trễ cao nhất (Max)** | **10.37 ms** |
| **Tổng thời gian thực thi (100 reqs)** | **681 ms** |

> [!NOTE]
> Số liệu trên được đo cục bộ trên một node (local single-node in-memory replica set với MongoDB 7.0.14). Đây là số liệu tham chiếu hiệu năng cơ bản của middleware và query planner, **không phải là cam kết SLO** trong môi trường phân tán production có độ trễ mạng liên vùng hoặc tranh chấp I/O.
