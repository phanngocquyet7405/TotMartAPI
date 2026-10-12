const crypto = require('crypto');
function fail(message, statusCode = 409) { throw Object.assign(new Error(message), { statusCode }); }
function money(value) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('Số tiền phải là số nguyên VND dương', 400);
  return value;
}
function sumMoney(values) {
  const sum = values.reduce((sum, value) => sum + BigInt(money(value)), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) fail('Tổng tiền vượt giới hạn an toàn', 400);
  return Number(sum);
}
function paymentCodeFrom(body) {
  const explicit = String(body.code || '').trim().toUpperCase();
  if (/^TMART[A-Z0-9]{1,100}$/.test(explicit)) return explicit;
  return String(body.content || '').match(/\bTMART[A-Z0-9]{1,100}\b/i)?.[0].toUpperCase() || '';
}
function receiptHash(receipt) {
  // Hash financial identity, not delivery timestamp/description which retries may vary.
  return crypto.createHash('sha256').update(JSON.stringify({ provider: 'sepay',
    providerEventId: String(receipt.id), referenceCode: receipt.referenceCode,
    accountNumber: receipt.accountNumber, paymentCode: paymentCodeFrom(receipt),
    amount: money(receipt.transferAmount), transferType: receipt.transferType })).digest('hex');
}
function remainingAmount(total, received) {
  money(total);
  if (!Number.isSafeInteger(received) || received < 0) fail('Số tiền đã nhận không hợp lệ');
  return Math.max(0, total - received);
}
module.exports = { fail, money, sumMoney, receiptHash, paymentCodeFrom, remainingAmount };
