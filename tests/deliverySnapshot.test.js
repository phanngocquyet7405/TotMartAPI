const { deliverySnapshot } = require('../src/services/deliverySnapshot');

const user = { name: 'Nguyen Van An' };
const valid = {
  phone: '0912345678', address: '12 Nguyen Trai', district: 'Quan 1',
  city: 'Ho Chi Minh', country: 'VN',
};
describe('deliverySnapshot', () => {
  test('returns a trimmed independent snapshot without model metadata', () => {
    const input = { ...valid, address: ' 12 Nguyen Trai ', _id: 'unused' };
    const snapshot = deliverySnapshot(user, input);
    expect(snapshot).toEqual({ fullName: user.name, ...valid });
    input.city = 'Changed';
    expect(snapshot.city).toBe(valid.city);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
  test.each(['phone', 'address', 'district', 'city', 'country'])('rejects missing %s', field => {
    const input = { ...valid };
    delete input[field];
    try {
      deliverySnapshot(user, input);
      throw new Error('Expected validation failure');
    } catch (err) {
      expect(err.status).toBe(422);
      expect(err.code).toBe('INVALID_DELIVERY_ADDRESS');
      expect(err.fields).toContain(field);
      expect(err.message).not.toContain(valid.phone);
    }
  });
  test.each(['', '   ', '123', 'abc', '09123456789'])('rejects invalid phone %j', phone => {
    expect(() => deliverySnapshot(user, { ...valid, phone })).toThrow();
  });
  test('accepts international E.164-shaped numbers', () => {
    expect(deliverySnapshot(user, { ...valid, phone: '+84912345678' }).phone).toBe('+84912345678');
  });
  test('rejects whitespace-only city and an absent address', () => {
    expect(() => deliverySnapshot(user, { ...valid, city: '   ' })).toThrow();
    expect(() => deliverySnapshot(user, null)).toThrow();
  });
});
