// Kiểm tra cấu hình production: giá trị mẫu bị từ chối, điểm yếu khác chỉ cảnh báo.
const { validateProductionEnv, looksLikePlaceholder } = require('../src/config/environmentChecks');

const good = () => ({
  JWT_SECRET: '9f8e7d6c5b4a39281716aabbccddeeff00112233',
  JWT_REFRESH_SECRET: '1a2b3c4d5e6f70819283bbccddeeff9988776655',
  MONGODB_URI: 'mongodb+srv://app:Zx81kq@cluster0.abcde.mongodb.net/totmart',
  FRONTEND_URL: 'https://tot-mart.vercel.app',
  CORS_ORIGINS: 'https://tot-mart.vercel.app, https://admin.tot-mart.vn',
  SEPAY_API_KEY: 'k3j2h1g0f9e8d7c6b5a4',
  TRUST_PROXY: '1',
});

describe('validateProductionEnv', () => {
  test('cấu hình hợp lệ không có lỗi', () => {
    expect(validateProductionEnv(good())).toEqual({ errors: [], warnings: [] });
  });

  test('từ chối giá trị mẫu cho secret, API key và chuỗi kết nối', () => {
    const env = {
      ...good(),
      JWT_SECRET: 'your-secret-key-change-in-production',
      JWT_REFRESH_SECRET: 'your-refresh-secret-change-in-production',
      SEPAY_API_KEY: 'changeme',
      MONGODB_URI: 'mongodb+srv://username:password@cluster.mongodb.net/database-name',
    };
    const { errors } = validateProductionEnv(env);
    expect(errors.some((e) => e.startsWith('JWT_SECRET'))).toBe(true);
    expect(errors.some((e) => e.startsWith('JWT_REFRESH_SECRET'))).toBe(true);
    expect(errors.some((e) => e.startsWith('SEPAY_API_KEY'))).toBe(true);
    expect(errors.some((e) => e.startsWith('MONGODB_URI'))).toBe(true);
  });

  test("chuỗi kết nối thật có chữ 'example' trong tên database không bị báo nhầm", () => {
    const env = {
      ...good(),
      MONGODB_URI: 'mongodb+srv://app:Zx81kq@cluster0.abcde.mongodb.net/example-shop',
    };
    expect(validateProductionEnv(env).errors).toEqual([]);
  });

  test('từ chối FRONTEND_URL/CORS_ORIGINS không phải https hoặc là localhost', () => {
    for (const bad of [
      'http://tot-mart.vercel.app',
      'https://localhost:3000',
      'tot-mart.vercel.app',
    ]) {
      expect(validateProductionEnv({ ...good(), FRONTEND_URL: bad }).errors.length).toBeGreaterThan(
        0,
      );
    }
    const { errors } = validateProductionEnv({
      ...good(),
      CORS_ORIGINS: 'https://ok.vn,http://evil.vn',
    });
    expect(errors).toEqual([expect.stringContaining('CORS_ORIGINS')]);
  });

  test('secret ngắn hoặc trùng nhau chặn khởi động production', () => {
    const { errors, warnings } = validateProductionEnv({
      ...good(),
      JWT_SECRET: 'short-but-real-secret',
      JWT_REFRESH_SECRET: 'short-but-real-secret',
    });
    expect(errors.length).toBe(3);
    expect(warnings).toEqual([]);
  });

  test('looksLikePlaceholder nhận các dạng mẫu thường gặp', () => {
    for (const v of [
      'your-key',
      'CHANGE_ME',
      'replace-me',
      '<secret>',
      'example.com',
      'xxxxxxxx',
    ]) {
      expect(looksLikePlaceholder(v)).toBe(true);
    }
    expect(looksLikePlaceholder('9f8e7d6c5b4a39281716aa')).toBe(false);
  });

  test('production bắt buộc khai báo TRUST_PROXY rõ ràng', () => {
    const withoutProxy = { ...good() };
    delete withoutProxy.TRUST_PROXY;
    const { errors: errMissing } = validateProductionEnv(withoutProxy);
    expect(errMissing).toContain('TRUST_PROXY phải được khai báo rõ ràng trong production');

    const emptyProxy = { ...good(), TRUST_PROXY: '' };
    const { errors: errEmpty } = validateProductionEnv(emptyProxy);
    expect(errEmpty).toContain('TRUST_PROXY phải được khai báo rõ ràng trong production');

    const invalidProxy = { ...good(), TRUST_PROXY: 'invalid' };
    const { errors: errInvalid } = validateProductionEnv(invalidProxy);
    expect(errInvalid).toContain('TRUST_PROXY phải là 0/1 hoặc loopback/linklocal/uniquelocal');
  });

  test('TRUST_PROXY=0 xuất cảnh báo nếu thiếu TRUST_PROXY_CONFIRMED_DIRECT, và im lặng nếu đã xác nhận', () => {
    const unconfirmed = { ...good(), TRUST_PROXY: '0' };
    const res1 = validateProductionEnv(unconfirmed);
    expect(res1.errors).toEqual([]);
    expect(res1.warnings.length).toBeGreaterThan(0);
    expect(res1.warnings[0]).toMatch(/TRUST_PROXY=0/);

    const confirmed = { ...good(), TRUST_PROXY: '0', TRUST_PROXY_CONFIRMED_DIRECT: 'true' };
    const res2 = validateProductionEnv(confirmed);
    expect(res2.errors).toEqual([]);
    expect(res2.warnings).toEqual([]);

    const confirmedWithOne = { ...good(), TRUST_PROXY: '0', TRUST_PROXY_CONFIRMED_DIRECT: '1' };
    const res3 = validateProductionEnv(confirmedWithOne);
    expect(res3.errors).toEqual([]);
    expect(res3.warnings).toEqual([]);
  });
});
