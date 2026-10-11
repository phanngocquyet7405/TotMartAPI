// Điều chỉnh tồn kho theo mức thay đổi (delta), nguyên tử trong một lệnh DB.
//
// Vì sao không cho sửa `stock` tuyệt đối trong form sửa chung: form giữ số tồn
// lúc admin mở trang; lưu lại sẽ ghi đè các đơn đã bán trong lúc đó. Trừ kho khi
// mua dùng $inc nên cũng không tăng __v, optimistic concurrency không bảo vệ được.
// Ở đây cộng/trừ delta ngay trên giá trị hiện tại trong DB, và chặn âm bằng điều
// kiện trong cùng câu lệnh (không có khoảng trống giữa kiểm tra và ghi).

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * @param {import('mongoose').Model} Model Product hoặc Box
 * @param {string} id
 * @param {number} delta số nguyên khác 0 (âm để giảm)
 * @param {{ withInstock?: boolean, notFoundMessage?: string }} [options]
 *   withInstock: đồng bộ cờ `instock` (chỉ Product có) trong cùng câu lệnh.
 * @returns {Promise<object>} bản ghi sau khi cập nhật
 */
async function adjustStock(Model, id, delta, options = {}) {
  if (!Number.isInteger(delta) || delta === 0) {
    throw httpError('Mức điều chỉnh phải là số nguyên khác 0', 400);
  }
  const next = { $add: ['$stock', delta] };
  const set = { stock: next };
  if (options.withInstock) set.instock = { $gt: [next, 0] };

  const filter = { _id: id };
  if (delta < 0) filter.stock = { $gte: -delta };

  const updated = await Model.findOneAndUpdate(filter, [{ $set: set }], { new: true });
  if (updated) return updated;

  // Không khớp: hoặc không tồn tại, hoặc giảm quá tồn kho hiện tại.
  const exists = await Model.exists({ _id: id });
  if (!exists) throw httpError(options.notFoundMessage || 'Không tìm thấy bản ghi', 404);
  throw httpError('Không thể giảm quá tồn kho hiện tại', 409);
}

module.exports = { adjustStock };
