const { allocate, unitPrice } = require('../src/services/pricingService');
const { prepaidPrice, addMonths, planMonths } = require('../src/services/subscriptionService');
const safeHtml = require('../src/utils/safeHtml');
test.each([3,6,12])('prepaid %i months includes all monthly deliveries', months => {
  expect(prepaidPrice(100001, months + '_month', 10)).toEqual({basePrice:100001*months,discountPrice:Math.round(100001*months*.9)});
});
test('invalid and free prepaid prices are rejected', () => {
  expect(() => prepaidPrice(0,'3_month',0)).toThrow(); expect(() => prepaidPrice(100,'3_month',100)).toThrow(); expect(() => planMonths('weekly')).toThrow();
});
test('rounding allocates every VND once, including zero-valued components', () => {
  expect(allocate(1,[1,1,1])).toEqual([1,0,0]); expect(allocate(101,[0,0])).toEqual([51,50]);
  const total = Number.MAX_SAFE_INTEGER; const parts = allocate(total,[total-1,1]); expect(parts.reduce((a,b)=>a+b,0)).toBe(total);
  expect(() => allocate(3.5,[1])).toThrow(); expect(() => allocate(1,[-1])).toThrow();
});
test('sale price is an integer and rounded consistently', () => expect(unitPrice({price:101,salePercent:10})).toBe(91));
test('monthly schedule preserves the original day after February, with UTC+7 boundary', () => {
  const start = new Date('2024-01-31T03:00:00Z');
  expect(addMonths(start,1).toISOString()).toBe('2024-02-29T03:00:00.000Z');
  expect(addMonths(start,2).toISOString()).toBe('2024-03-31T03:00:00.000Z');
  expect(addMonths(new Date('2025-01-30T18:30:00Z'),1).toISOString()).toBe('2025-02-27T18:30:00.000Z');
});
test('stored HTML removes executable content while preserving formatting', () => {
  const result = safeHtml('<p onclick="alert(1)">OK<strong>bold</strong><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a></p>');
  expect(result).toContain('<strong>bold</strong>'); expect(result).not.toMatch(/script|onclick|onerror|javascript:|<img/);
});
