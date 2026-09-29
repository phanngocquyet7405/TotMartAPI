const request = require("supertest");
const app = require("../src/app");
const { connect, closeDatabase, clearDatabase } = require("./helpers/db");
const { createUser, signToken, createBrand, createProduct } = require("./helpers/factories");
const Order = require("../src/models/Order");
const Product = require("../src/models/Product");
const Brand = require("../src/models/Brand");

beforeAll(connect);
afterEach(clearDatabase);
afterAll(closeDatabase);

describe.each(["list", "detail"])("Admin order Brand: %s", (endpoint) => {
  test.each(["multiple brands", "changed product brand", "deleted product", "deleted brand", "missing brand"])(
    "%s preserves order lines and exposes only the stored Brand name/id",
    async (scenario) => {
      const { user } = await createUser();
      const { user: admin } = await createUser({ role: "admin" });
      const first = await createBrand({ name: "First Brand" });
      const second = await createBrand({ name: "Second Brand", ownerId: first.ownerId });
      const product = await createProduct(first);
      const other = await createProduct(second);
      const order = await Order.create({
        userId: user._id,
        merchantId: first.ownerId,
        orderId: `BRAND-${scenario}`,
        paymentCode: `PAY-${scenario}`,
        totalAmount: 300000,
        products: [
          { productId: product._id, brand: first._id, name: "First item", unitPrice: 100000, quantity: 1, totalPrice: 100000 },
          { productId: other._id, brand: second._id, name: "Second item", unitPrice: 100000, quantity: 2, totalPrice: 200000 },
        ],
      });
      if (scenario === "changed product brand") {
        await Product.updateOne({ _id: product._id }, { brand: second._id });
      }
      if (scenario === "deleted product") await Product.deleteOne({ _id: product._id });
      if (scenario === "deleted brand") await Brand.deleteOne({ _id: first._id });
      if (scenario === "missing brand") {
        await Order.updateOne({ _id: order._id }, { $unset: { "products.0.brand": 1 } });
      }
      const url = endpoint === "list" ? "/api/admin/orders" : `/api/admin/orders/${order._id}`;
      const res = await request(app).get(url).set("Authorization", `Bearer ${signToken(admin)}`);
      expect(res.status).toBe(200);
      const result = endpoint === "list" ? res.body.data[0] : res.body.data;
      expect(result.products).toHaveLength(2);
      expect(result.products[0].productId).toBe(String(product._id));
      expect(result.products[0].unitPrice).toBe(100000);
      expect(result.products[1].brand).toEqual({ _id: String(second._id), name: second.name });
      if (["deleted brand", "missing brand"].includes(scenario)) {
        expect(result.products[0].brand == null).toBe(true);
      } else {
        expect(result.products[0].brand).toEqual({ _id: String(first._id), name: first.name });
      }
    },
  );
});
