const { money, sumMoney, receiptHash, paymentCodeFrom, remainingAmount } = require('../src/services/paymentPolicy');
test.each([0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100'])('rejects invalid VND %j', value => {
  expect(() => money(value)).toThrow();
});
test('sums partial payments exactly; rejects unsafe sum', () => {
  expect(sumMoney([60000, 40000])).toBe(100000);
  expect(() => sumMoney([Number.MAX_SAFE_INTEGER, 1])).toThrow();
});
test('remaining amount never subtracts a discount twice or goes negative', () => {
  expect(remainingAmount(100000, 60000)).toBe(40000);
  expect(remainingAmount(100000, 110000)).toBe(0);
  expect(() => remainingAmount(100000, -1)).toThrow();
});
test('parses standalone payment code; ignores invalid explicit code', () => {
  expect(paymentCodeFrom({ code: null, content: 'Pay tmarta123 now' })).toBe('TMARTA123');
  expect(paymentCodeFrom({ code: 'invalid', content: 'Pay TMARTA123' })).toBe('TMARTA123');
  expect(paymentCodeFrom({ content: 'NOTMARTA123' })).toBe('');
});
test('receipt hash pins amount/account/provider ID, not retry timestamp', () => {
  const receipt = { id: 1, referenceCode: 'REF1', accountNumber: '0123', code: 'TMART1', transferAmount: 100, transferType: 'in' };
  expect(receiptHash(receipt)).toBe(receiptHash({ ...receipt, transactionDate: 'different' }));
  for (const patch of [{ id: 2 }, { transferAmount: 200 }, { accountNumber: '9999' }])
    expect(receiptHash(receipt)).not.toBe(receiptHash({ ...receipt, ...patch }));
});
