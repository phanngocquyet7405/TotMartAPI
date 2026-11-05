const request = require('supertest');
const app = require('../src/app');
const { connect, closeDatabase, clearDatabase } = require('./helpers/db');
const {
  createUser,
  signToken,
  createBrand,
  createProduct,
  createCoupon,
} = require('./helpers/factories');
const Box = require('../src/models/Box');
const Order = require('../src/models/Order');
const Cart = require('../src/models/Cart');

beforeAll(async () => {
  await connect();
});

afterEach(async () => {
  await clearDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

function normalizeOrder(order) {
  const obj = order.toObject ? order.toObject() : order;
  return {
    merchantId: String(obj.merchantId),
    totalAmount: obj.totalAmount,
    giftFee: obj.giftFee,
    bulkDiscountAmount: obj.bulkDiscountAmount,
    pricingPolicyVersion: obj.pricingPolicyVersion,
    shippingFee: obj.shippingFee,
    shippingPayment: obj.shippingPayment,
    shippingMode: obj.shippingMode,
    discountAmount: obj.discountAmount,
    couponCode: obj.couponCode,
    note: obj.note || '',
    shippingAddress: {
      address: obj.shippingAddress?.address,
      district: obj.shippingAddress?.district,
      city: obj.shippingAddress?.city,
      country: obj.shippingAddress?.country,
      phone: obj.shippingAddress?.phone,
    },
    products: (obj.products || [])
      .map((p) => ({
        productId: String(p.productId),
        name: p.name,
        price: p.price,
        quantity: p.quantity,
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId) || a.name.localeCompare(b.name)),
    boxes: (obj.boxes || [])
      .map((b) => ({
        boxId: String(b.boxId),
        name: b.name,
        quantity: b.quantity,
        price: b.price,
      }))
      .sort((a, b) => a.boxId.localeCompare(b.boxId)),
  };
}

describe('Order characterization test: COD vs Online Settle parity', () => {
  test('COD branch and Online/settle branch produce identical normalized order structures for multi-merchant carts', async () => {
    // Shared catalog across both test flows:
    const { user: m1 } = await createUser({ role: 'merchant' });
    const { user: m2 } = await createUser({ role: 'merchant' });

    const brand1 = await createBrand({ ownerId: m1._id });
    const brand2 = await createBrand({ ownerId: m2._id });

    const p1A = await createProduct(brand1, { price: 100000, stock: 100 });
    const p1B = await createProduct(brand1, { price: 50000, stock: 100 });
    const p2A = await createProduct(brand2, { price: 200000, stock: 100 });

    const box1 = await Box.create({
      ownerId: m1._id,
      name: 'Combo Box M1',
      descriptions: 'Multi-item combo',
      stock: 50,
      validFrom: new Date(Date.now() - 10000),
      validTo: new Date(Date.now() + 86400000),
      value: 150000,
      products: [
        { productId: p1A._id, quantity: 1, price: p1A.price, name: p1A.name },
        { productId: p1B._id, quantity: 1, price: p1B.price, name: p1B.name },
      ],
      giftPolicy: {
        amenities: [{ name: 'premium', fee: 15000 }],
      },
    });

    const coupon = await createCoupon({
      discountType: 'fixed',
      discount: 20000,
      minOrderValue: 100000,
    });

    const cartItems = [
      { productId: p1A._id, quantity: 2 },
      { boxId: box1._id, quantity: 1, gift: { wrap: 'premium', message: 'Happy Birthday!' } },
      { productId: p2A._id, quantity: 1 },
    ];

    const sharedAddress = {
      country: 'VN',
      city: 'Hồ Chí Minh',
      district: 'Quận 1',
      address: '123 Đường Test',
      phone: '0900000000',
    };

    // 1. COD Order flow
    const { user: userCod } = await createUser({
      email: 'customer.cod@test.com',
      addresses: [sharedAddress],
    });
    const tokenCod = signToken(userCod);

    await Cart.create({
      userId: userCod._id,
      items: cartItems,
      totalPrice: 0,
      isSubscribeCart: false,
    });

    const codRes = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${tokenCod}`)
      .send({
        addressId: String(userCod.addresses[0]._id),
        paymentMethod: 'cod',
        couponCode: coupon.code,
        note: 'Giao gio hanh chinh',
      });

    expect(codRes.status).toBe(201);
    expect(codRes.body.success).toBe(true);

    const codOrdersRaw = await Order.find({ userId: userCod._id });
    expect(codOrdersRaw.length).toBe(2);

    const codOrders = codOrdersRaw
      .map(normalizeOrder)
      .sort((a, b) => a.merchantId.localeCompare(b.merchantId));

    // 2. Online Order flow (checkout session -> webhook settle)
    const { user: userOnline } = await createUser({
      email: 'customer.online@test.com',
      addresses: [sharedAddress],
    });
    const tokenOnline = signToken(userOnline);

    await Cart.create({
      userId: userOnline._id,
      items: cartItems,
      totalPrice: 0,
      isSubscribeCart: false,
    });

    const onlineRes = await request(app)
      .post('/api/checkout/check-out')
      .set('Authorization', `Bearer ${tokenOnline}`)
      .send({
        addressId: String(userOnline.addresses[0]._id),
        paymentMethod: 'online',
        couponCode: coupon.code,
        note: 'Giao gio hanh chinh',
      });

    expect(onlineRes.status).toBe(201);
    expect(onlineRes.body.success).toBe(true);
    const paymentCode = onlineRes.body.data.orderCode;
    const totalAmount = onlineRes.body.data.totalAmount;

    // Send valid SePay webhook to settle and create orders
    const webhookRes = await request(app)
      .post('/api/checkout/sepay-webhook')
      .set('Authorization', `Apikey ${process.env.SEPAY_API_KEY}`)
      .send({
        id: 999999,
        gateway: 'TestBank',
        transactionDate: new Date().toISOString(),
        accountNumber: process.env.SEPAY_BANK_ACCOUNT,
        content: `Thanh toan don ${paymentCode}`,
        code: paymentCode,
        transferType: 'in',
        transferAmount: totalAmount,
        referenceCode: 'REF-CHAR-001',
      });

    expect(webhookRes.status).toBe(200);

    const onlineOrdersRaw = await Order.find({ userId: userOnline._id });
    expect(onlineOrdersRaw.length).toBe(2);

    const onlineOrders = onlineOrdersRaw
      .map(normalizeOrder)
      .sort((a, b) => a.merchantId.localeCompare(b.merchantId));

    // 3. Assert exact parity between COD and Online normalized orders
    expect(codOrders.length).toBe(onlineOrders.length);
    expect(codOrders).toEqual(onlineOrders);

    // Verify key business fields
    expect(codOrders[0].couponCode).toBe(coupon.code);
    expect(codOrders[0].note).toBe('Giao gio hanh chinh');
    expect(codOrders[0].totalAmount).toBe(372273);
    expect(codOrders[1].totalAmount).toBe(192727);
    expect(codOrders[0].totalAmount + codOrders[1].totalAmount).toBe(totalAmount);
  });
});
