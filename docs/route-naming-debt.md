# Route Naming Debt and RESTful Modernization Roadmap

## 1. Bối cảnh

API của TotMart ban đầu được xây dựng theo phong cách RPC-style (đưa động từ vào URL và kết hợp danh từ số ít/nhiều không nhất quán, cùng một số lỗi chính tả lịch sử).
Companion Frontend (Next.js) hiện đang phụ thuộc trực tiếp vào các đường dẫn này. Nhằm đảm bảo tính ổn định và tôn trọng **Quy tắc bất biến (Rule 2 trong AGENTS.md: Không đổi tên hoặc xóa route hiện có, không sửa frontend)**, đợt hardening này giữ nguyên 100% các endpoint hiện tại.

Tài liệu này ghi nhận toàn diện các khoản nợ định danh route và phác thảo lộ trình chuẩn hóa an toàn cho các đợt phát hành tương lai.

---

## 2. Danh mục nợ định danh Route (Inventory of Route Naming Debt)

### A. Lỗi chính tả tiếng Anh (Spelling Errors)

| Route hiện tại                                     | Lỗi                                   | Định danh chuẩn đề xuất                |
| :------------------------------------------------- | :------------------------------------ | :------------------------------------- |
| `/api/subcribe-plans`                              | Sai chính tả `subcribe` (thiếu `s`)   | `/api/subscribe-plans`                 |
| `/api/subcribe-plans/create-subcribe-plan`         | Sai chính tả `subcribe`               | `POST /api/subscribe-plans`            |
| `/api/subcribe-plans/get-all-subcribe-plan`        | Sai chính tả `subcribe`               | `GET /api/subscribe-plans`             |
| `/api/subcribe-plans/get-subcribe-plan-by-id/:_id` | Sai chính tả `subcribe`               | `GET /api/subscribe-plans/:_id`        |
| `/api/subcribe-plans/update-subcribe-plan/:_id`    | Sai chính tả `subcribe`               | `PUT /api/subscribe-plans/:_id`        |
| `/api/subcribe-plans/delete-subcribe-plan/:_id`    | Sai chính tả `subcribe`               | `DELETE /api/subscribe-plans/:_id`     |
| `/api/subcribe-plans/user-subscribe`               | Chứa tiền tố `subcribe`               | `POST /api/subscriptions`              |
| `/api/subcribe-plans/get-user-subscriptions`       | Chứa tiền tố `subcribe`               | `GET /api/subscriptions/me`            |
| `/api/carts/add-subscribe-plan-to-cart`            | Không nhất quán với các route khác    | `POST /api/carts/subscriptions`        |
| `/api/carts/get-subscribe-cart/:_id`               | Chứa động từ và param không cần thiết | `GET /api/carts/subscriptions`         |
| `/api/carts/update-subscribe-cart`                 | Chứa động từ                          | `PUT /api/carts/subscriptions`         |
| `/api/carts/delete-from-subscribe-cart/:_id`       | Chứa động từ                          | `DELETE /api/carts/subscriptions/:_id` |

### B. Sử dụng động từ trong URL thay vì HTTP Method (Action Verbs in URL)

| Router           | Route hiện tại                                  | HTTP Method | Định danh chuẩn đề xuất             |
| :--------------- | :---------------------------------------------- | :---------- | :---------------------------------- |
| `categoryRouter` | `/api/categories/create-category`               | POST        | `POST /api/categories`              |
|                  | `/api/categories/get-all-categories`            | GET         | `GET /api/categories`               |
|                  | `/api/categories/get-root-categories`           | GET         | `GET /api/categories?root=true`     |
|                  | `/api/categories/get-category-by-id/:_id`       | GET         | `GET /api/categories/:_id`          |
|                  | `/api/categories/get-products-by-category/:_id` | GET         | `GET /api/categories/:_id/products` |
|                  | `/api/categories/update-category/:_id`          | PUT         | `PUT /api/categories/:_id`          |
|                  | `/api/categories/delete-category/:_id`          | DELETE      | `DELETE /api/categories/:_id`       |
| `boxRouter`      | `/api/boxes/get-all-box`                        | GET         | `GET /api/boxes`                    |
|                  | `/api/boxes/get-box-by-id/:_id`                 | GET         | `GET /api/boxes/:_id`               |
|                  | `/api/boxes/create-box`                         | POST        | `POST /api/boxes`                   |
|                  | `/api/boxes/update-box/:_id`                    | PUT         | `PUT /api/boxes/:_id`               |
|                  | `/api/boxes/delete-box/:_id`                    | DELETE      | `DELETE /api/boxes/:_id`            |
| `couponRouter`   | `/api/coupons/create-coupon`                    | POST        | `POST /api/coupons`                 |
|                  | `/api/coupons/get-all-coupons`                  | GET         | `GET /api/coupons`                  |
|                  | `/api/coupons/get-coupon-by-id/:_id`            | GET         | `GET /api/coupons/:_id`             |
|                  | `/api/coupons/update-coupon/:_id`               | PUT         | `PUT /api/coupons/:_id`             |
|                  | `/api/coupons/delete-coupon/:_id`               | DELETE      | `DELETE /api/coupons/:_id`          |
| `userRouter`     | `/api/users/get-all-users`                      | GET         | `GET /api/users`                    |
|                  | `/api/users/get-user-by-id/:_id`                | GET         | `GET /api/users/:_id`               |
|                  | `/api/users/update-user/:_id`                   | PUT         | `PUT /api/users/:_id`               |
|                  | `/api/users/delete-user/:_id`                   | DELETE      | `DELETE /api/users/:_id`            |
| `cartRouter`     | `/api/carts/get-cart/:_id`                      | GET         | `GET /api/carts/me`                 |
|                  | `/api/carts/get-all-cart`                       | GET         | `GET /api/carts` (Admin)            |
|                  | `/api/carts/add-to-cart`                        | POST        | `POST /api/carts/items`             |
|                  | `/api/carts/update-cart/:_id`                   | PUT         | `PUT /api/carts/items/:_id`         |
|                  | `/api/carts/delete-from-cart/:_id`              | DELETE      | `DELETE /api/carts/items/:_id`      |

---

## 3. Lộ trình Alias + Deprecation (Migration Roadmap)

Để hiện đại hóa API mà không làm gián đoạn frontend, quá trình chuyển đổi sẽ được chia làm 4 giai đoạn:

```
[Giai đoạn 1: Giữ nguyên] (Hiện tại)
           │
           ▼
[Giai đoạn 2: Tạo Dual-Routing / Aliases]
   ├── Đăng ký song song các route REST chuẩn
   └── Trả response header Deprecation: true trên route cũ
           │
           ▼
[Giai đoạn 3: Đồng bộ Frontend]
   ├── Frontend chuyển sang gọi các route chuẩn mới
   └── Giám sát traffic trên legacy routes về 0
           │
           ▼
[Giai đoạn 4: Thu hồi và dọn dẹp (Retirement)]
   └── Loại bỏ route cũ sau thời hạn Sunset
```

### Bước triển khai kỹ thuật cụ thể:

1. **Giai đoạn 2 (Dual-Routing)**:
   - Sử dụng chung controller handler cho cả URL cũ và URL mới.
   - Thêm middleware `deprecationNotice` cho legacy routes:
     ```javascript
     function deprecate(newPath) {
       return (req, res, next) => {
         res.setHeader('Deprecation', '@1793856000'); // Timestamp RFC 8594
         res.setHeader('Link', `<${newPath}>; rel="successor-version"`);
         next();
       };
     }
     ```
2. **Giai đoạn 3 (Frontend cutover)**:
   - Phát hành bản cập nhật cho repository frontend Next.js, chuyển đổi toàn bộ service API calls sang endpoint mới.
3. **Giai đoạn 4 (Sunset)**:
   - Đóng hoàn toàn legacy routes sau thời gian grace period (ví dụ: 6 tháng sau khi frontend cutover hoàn tất).
