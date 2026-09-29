jest.mock("../src/models/Order", () => ({
  create: jest.fn(),
  find: jest.fn(),
  exists: jest.fn(),
}));
jest.mock("../src/models/Cart", () => ({
  findOne: jest.fn(),
  deleteOne: jest.fn(),
}));
jest.mock("../src/models/User", () => ({ findById: jest.fn() }));
jest.mock("../src/models/Product", () => ({
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));
jest.mock("../src/utils/notify", () => ({
  notifyMerchant: jest.fn().mockResolvedValue(undefined),
}));
const mongoose = require("mongoose");
const Order = require("../src/models/Order");
const Cart = require("../src/models/Cart");
const User = require("../src/models/User");
const Product = require("../src/models/Product");
const controller = require("../src/controllers/checkOutController");
const customer = require("../src/controllers/customerOrderController");
const query = (value) => ({
  session: async () => value,
  sort() {
    return this;
  },
});
const response = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});
let session;
beforeEach(() => {
  jest.clearAllMocks();
  session = { withTransaction: async (fn) => fn(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
});
afterEach(() => jest.restoreAllMocks());
test("checkout returns HTTP 201 with exactly the three payment fields after create", async () => {
  const product = {
    _id: "product",
    name: "Item",
    price: 100000,
    stock: 3,
    brand: { _id: "brand", ownerId: "merchant" },
  };
  Product.findById.mockReturnValue({ populate: () => query(product) });
  User.findById.mockReturnValue(
    query({
      name: "Customer",
      addresses: { id: () => ({ phone: "0123", address: "Street" }) },
    }),
  );
  Cart.findOne.mockReturnValue(
    query({ _id: "cart", items: [{ productId: "product", quantity: 1 }] }),
  );
  Order.create.mockImplementation(async ([data]) => [
    { ...data, _id: "mongo-order-id" },
  ]);
  const res = response();
  const next = jest.fn();
  await controller.checkOut(
    {
      userId: "user",
      validatedBody: { addressId: "address", paymentMethod: "online" },
    },
    res,
    next,
  );
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json.mock.calls[0][0]).toEqual({
    success: true,
    data: {
      orderId: "mongo-order-id",
      orderCode: expect.stringMatching(/^TMART/),
      totalAmount: 130000,
    },
  });
  expect(Order.create).toHaveBeenCalled();
  expect(session.endSession).toHaveBeenCalled();
});
function order(id, overrides = {}) {
  return {
    _id: id,
    orderId: id,
    status: "pending",
    paymentMethod: "online",
    paymentStatus: "pending",
    totalAmount: 100,
    products: [{ productId: "p", name: "Item", quantity: 1 }],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
function webhook() {
  return {
    validatedBody: {
      code: "TMART123",
      content: "",
      referenceCode: "REF",
      transferType: "in",
      transferAmount: 200,
      accountNumber: process.env.SEPAY_BANK_ACCOUNT,
    },
  };
}
test("multi-merchant payment stores unique reference once and marks both children paid", async () => {
  const orders = [order("a"), order("b")];
  Order.exists.mockReturnValue(query(null));
  Order.find.mockReturnValue(query(orders));
  Product.findOneAndUpdate.mockResolvedValue({ stock: 2 });
  const res = response();
  await controller.sepayWebhook(webhook(), res);
  expect(res.json).toHaveBeenCalledWith({ success: true });
  expect(orders.map((o) => o.paymentStatus)).toEqual(["paid", "paid"]);
  expect(orders.filter((o) => o.paidReferenceCode === "REF")).toHaveLength(1);
  expect(orders.every((o) => o.paidAt instanceof Date)).toBe(true);
});
test("replayed reference does not deduct inventory", async () => {
  Order.exists.mockReturnValue(query({ _id: "a" }));
  const res = response();
  await controller.sepayWebhook(webhook(), res);
  expect(Product.findOneAndUpdate).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    message: "Payment already processed",
  });
});
test.each(["cancelled", "cod"])(
  "%s cannot be paid/reserved through online webhook",
  async (kind) => {
    Order.exists.mockReturnValue(query(null));
    Order.find.mockReturnValue(
      query([
        order(
          "a",
          kind === "cod" ? { paymentMethod: "cod" } : { status: "cancelled" },
        ),
      ]),
    );
    const res = response();
    await controller.sepayWebhook(webhook(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(Product.findOneAndUpdate).not.toHaveBeenCalled();
  },
);
test("partial reservation is restored before a paid order is put on hold", async () => {
  const item = order("a", {
    products: [
      { productId: "first", name: "A", quantity: 1 },
      { productId: "second", name: "B", quantity: 1 },
    ],
  });
  Order.exists.mockReturnValue(query(null));
  Order.find.mockReturnValue(query([item]));
  Product.findOneAndUpdate
    .mockResolvedValueOnce({ stock: 2 })
    .mockResolvedValueOnce(null);
  const res = response();
  await controller.sepayWebhook(webhook(), res);
  expect(Product.findByIdAndUpdate).toHaveBeenCalledWith(
    "first",
    { $inc: { stock: 1 }, instock: true },
    { session },
  );
  expect(item.status).toBe("on_hold");
  expect(item.stockDeducted).toBe(false);
  expect(item.paymentStatus).toBe("paid");
});
test("customer detail preserves shipping status and reports aggregate paid status", async () => {
  Order.findOne = jest.fn().mockReturnValue({
    select: () => ({
      lean: async () => ({
        _id: "id",
        paymentCode: "TMART123",
        status: "processing",
      }),
    }),
  });
  Order.find.mockReturnValue({
    select: () => ({
      lean: async () => [
        { totalAmount: 100, paymentStatus: "paid", status: "processing" },
        { totalAmount: 200, paymentStatus: "paid", status: "processing" },
      ],
    }),
  });
  const res = response();
  await customer.detail(
    { params: { _id: "id" }, userId: "owner" },
    res,
    jest.fn(),
  );
  expect(Order.findOne).toHaveBeenCalledWith({ _id: "id", userId: "owner" });
  expect(res.json.mock.calls[0][0]).toMatchObject({
    success: true,
    status: "paid",
    data: {
      status: "processing",
      checkout: { orderId: "id", orderCode: "TMART123", totalAmount: 300 },
    },
  });
});
test("underpayment never marks an order paid or deducts stock", async () => {
  const pending = order("a", { totalAmount: 300 });
  Order.exists.mockReturnValue(query(null));
  Order.find.mockReturnValue(query([pending]));
  const res = response();
  await controller.sepayWebhook(webhook(), res);
  expect(res.status).toHaveBeenCalledWith(422);
  expect(pending.paymentStatus).toBe("pending");
  expect(Product.findOneAndUpdate).not.toHaveBeenCalled();
});
test("unexpected receiving account is rejected before touching orders", async () => {
  const req = webhook();
  req.validatedBody.accountNumber = "wrong-account";
  const res = response();
  await controller.sepayWebhook(req, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(Order.find).not.toHaveBeenCalled();
});
