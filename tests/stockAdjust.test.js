// Điều chỉnh tồn kho qua API (cần MongoDB, chạy trong CI): quyền, kiểm tra đầu vào,
// chặn âm, cạnh tranh đồng thời, và form sửa chung không còn ghi đè `stock`.
const request = require("supertest");
const app = require("../src/app");
const { connect, closeDatabase, clearDatabase } = require("./helpers/db");
const {
  createUser,
  signToken,
  createBrand,
  createProduct,
} = require("./helpers/factories");
const Product = require("../src/models/Product");
const Box = require("../src/models/Box");

beforeAll(async () => {
  await connect();
});
afterEach(async () => {
  await clearDatabase();
});
afterAll(async () => {
  await closeDatabase();
});

async function adminToken() {
  const { user } = await createUser({ role: "admin" });
  return signToken(user);
}
async function userToken() {
  const { user } = await createUser();
  return signToken(user);
}
async function makeProduct(overrides = {}) {
  const brand = await createBrand();
  return createProduct(brand, overrides);
}
async function makeBox(stock = 5) {
  return Box.create({
    name: "Hộp thử",
    stock,
    descriptions: "Mô tả",
    validFrom: new Date(Date.now() - 86400000),
    validTo: new Date(Date.now() + 86400000),
    value: 90000,
    discountPercent: 10,
    products: [],
  });
}
const patch = (url, token, body) =>
  request(app).patch(url).set("Authorization", `Bearer ${token}`).send(body);

describe("PATCH /api/products/adjust-stock/:_id", () => {
  test("yêu cầu đăng nhập và quyền admin", async () => {
    const product = await makeProduct({ stock: 5 });
    const url = `/api/products/adjust-stock/${product._id}`;
    expect((await request(app).patch(url).send({ delta: 1 })).status).toBe(401);
    expect((await patch(url, await userToken(), { delta: 1 })).status).toBe(403);
    expect((await Product.findById(product._id)).stock).toBe(5);
  });

  test("tăng và giảm theo delta, trả về tồn kho mới", async () => {
    const token = await adminToken();
    const product = await makeProduct({ stock: 5 });
    const url = `/api/products/adjust-stock/${product._id}`;
    const up = await patch(url, token, { delta: 10, reason: "Nhập hàng" });
    expect(up.status).toBe(200);
    expect(up.body.data.stock).toBe(15);
    const down = await patch(url, token, { delta: -4 });
    expect(down.body.data.stock).toBe(11);
    expect((await Product.findById(product._id)).stock).toBe(11);
  });

  test("giảm về 0 thì instock=false, tăng lại thì instock=true", async () => {
    const token = await adminToken();
    const product = await makeProduct({ stock: 3, instock: true });
    const url = `/api/products/adjust-stock/${product._id}`;
    const zero = await patch(url, token, { delta: -3 });
    expect(zero.body.data).toMatchObject({ stock: 0, instock: false });
    const back = await patch(url, token, { delta: 2 });
    expect(back.body.data).toMatchObject({ stock: 2, instock: true });
  });

  test("giảm quá tồn kho bị từ chối (409) và không đổi dữ liệu", async () => {
    const token = await adminToken();
    const product = await makeProduct({ stock: 2 });
    const res = await patch(`/api/products/adjust-stock/${product._id}`, token, {
      delta: -3,
    });
    expect(res.status).toBe(409);
    expect((await Product.findById(product._id)).stock).toBe(2);
  });

  test("đầu vào không hợp lệ bị 400: 0, số lẻ, thiếu delta, id sai", async () => {
    const token = await adminToken();
    const product = await makeProduct({ stock: 5 });
    const url = `/api/products/adjust-stock/${product._id}`;
    for (const body of [{ delta: 0 }, { delta: 1.5 }, {}, { delta: "abc" }]) {
      expect((await patch(url, token, body)).status).toBe(400);
    }
    expect((await patch("/api/products/adjust-stock/xyz", token, { delta: 1 })).status).toBe(400);
    expect((await Product.findById(product._id)).stock).toBe(5);
  });

  test("sản phẩm không tồn tại: 404", async () => {
    const token = await adminToken();
    const res = await patch(
      "/api/products/adjust-stock/507f1f77bcf86cd799439011",
      token,
      { delta: -1 },
    );
    expect(res.status).toBe(404);
  });

  test("12 yêu cầu giảm 1 đồng thời trên kho 5: đúng 5 thành công, kho = 0", async () => {
    const token = await adminToken();
    const product = await makeProduct({ stock: 5 });
    const url = `/api/products/adjust-stock/${product._id}`;
    const results = await Promise.all(
      Array.from({ length: 12 }, () => patch(url, token, { delta: -1 })),
    );
    const ok = results.filter((r) => r.status === 200).length;
    const rejected = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(5);
    expect(rejected).toBe(7);
    expect((await Product.findById(product._id)).stock).toBe(0);
  });
});

describe("form sửa chung không còn ghi đè tồn kho", () => {
  test("PUT update-product bỏ qua stock nhưng vẫn đổi các trường khác", async () => {
    const token = await adminToken();
    const product = await makeProduct({ stock: 5, instock: true });
    // Giả lập đơn hàng vừa trừ kho sau khi admin mở form (số tồn trên form là 5).
    await Product.updateOne({ _id: product._id }, { $inc: { stock: -3 } });
    const res = await request(app)
      .put(`/api/products/update-product/${product._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Tên mới", stock: 5 });
    expect(res.status).toBe(200);
    const saved = await Product.findById(product._id);
    expect(saved.name).toBe("Tên mới");
    expect(saved.stock).toBe(2);
  });

  test("PUT update-box bỏ qua stock", async () => {
    const token = await adminToken();
    const box = await makeBox(5);
    await Box.updateOne({ _id: box._id }, { $inc: { stock: -3 } });
    const res = await request(app)
      .put(`/api/boxes/update-box/${box._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Hộp đổi tên", stock: 5 });
    expect(res.status).toBe(200);
    const saved = await Box.findById(box._id);
    expect(saved.name).toBe("Hộp đổi tên");
    expect(saved.stock).toBe(2);
  });
});

describe("PATCH /api/boxes/adjust-stock/:_id", () => {
  test("yêu cầu quyền admin", async () => {
    const box = await makeBox(5);
    const url = `/api/boxes/adjust-stock/${box._id}`;
    expect((await request(app).patch(url).send({ delta: 1 })).status).toBe(401);
    expect((await patch(url, await userToken(), { delta: 1 })).status).toBe(403);
  });

  test("tăng, giảm, chặn âm và 404", async () => {
    const token = await adminToken();
    const box = await makeBox(5);
    const url = `/api/boxes/adjust-stock/${box._id}`;
    expect((await patch(url, token, { delta: 5 })).body.data.stock).toBe(10);
    expect((await patch(url, token, { delta: -10 })).body.data.stock).toBe(0);
    expect((await patch(url, token, { delta: -1 })).status).toBe(409);
    expect(
      (await patch("/api/boxes/adjust-stock/507f1f77bcf86cd799439011", token, { delta: 1 })).status,
    ).toBe(404);
    expect((await Box.findById(box._id)).stock).toBe(0);
  });
});
