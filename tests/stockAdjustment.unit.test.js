// Logic điều chỉnh tồn kho (không cần MongoDB): bộ lọc, pipeline và mã lỗi.
const { adjustStock } = require("../src/services/stockAdjustment");

function fakeModel({ updated = { _id: "x", stock: 7 }, exists = true } = {}) {
  const calls = { update: [], exists: [] };
  return {
    calls,
    async findOneAndUpdate(filter, update, options) {
      calls.update.push({ filter, update, options });
      return updated;
    },
    async exists(filter) {
      calls.exists.push(filter);
      return exists ? { _id: "x" } : null;
    },
  };
}

describe("adjustStock", () => {
  test("tăng kho: không có điều kiện stock, dùng pipeline nguyên tử", async () => {
    const Model = fakeModel();
    const doc = await adjustStock(Model, "id1", 5);
    expect(doc.stock).toBe(7);
    expect(Model.calls.update).toEqual([
      {
        filter: { _id: "id1" },
        update: [{ $set: { stock: { $add: ["$stock", 5] } } }],
        options: { new: true },
      },
    ]);
  });

  test("giảm kho: điều kiện stock >= số giảm nằm trong cùng câu lệnh", async () => {
    const Model = fakeModel();
    await adjustStock(Model, "id1", -3);
    expect(Model.calls.update[0].filter).toEqual({ _id: "id1", stock: { $gte: 3 } });
    expect(Model.calls.update[0].update).toEqual([
      { $set: { stock: { $add: ["$stock", -3] } } },
    ]);
  });

  test("withInstock đồng bộ cờ instock từ số tồn mới", async () => {
    const Model = fakeModel();
    await adjustStock(Model, "id1", -3, { withInstock: true });
    const next = { $add: ["$stock", -3] };
    expect(Model.calls.update[0].update).toEqual([
      { $set: { stock: next, instock: { $gt: [next, 0] } } },
    ]);
  });

  test("không khớp và bản ghi không tồn tại: 404 với thông báo tuỳ chọn", async () => {
    const Model = fakeModel({ updated: null, exists: false });
    await expect(
      adjustStock(Model, "id1", -1, { notFoundMessage: "Sản phẩm không tồn tại" }),
    ).rejects.toMatchObject({ statusCode: 404, message: "Sản phẩm không tồn tại" });
  });

  test("không khớp nhưng bản ghi còn: 409 (giảm quá tồn kho)", async () => {
    const Model = fakeModel({ updated: null, exists: true });
    await expect(adjustStock(Model, "id1", -50)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  test("từ chối delta bằng 0, không nguyên hoặc không phải số, không gọi DB", async () => {
    for (const bad of [0, 1.5, NaN, "3", null, undefined]) {
      const Model = fakeModel();
      await expect(adjustStock(Model, "id1", bad)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(Model.calls.update).toHaveLength(0);
    }
  });
});
