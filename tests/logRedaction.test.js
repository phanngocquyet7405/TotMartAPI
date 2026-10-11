// Token và vé trong query string không được đi vào log.
const { redactUrl, reqSerializer } = require("../src/utils/logRedaction");

describe("redactUrl", () => {
  test("che token đặt lại mật khẩu và vé SSE, giữ nguyên phần còn lại", () => {
    expect(redactUrl("/api/home/reset-password?token=abc123&lang=vi")).toBe(
      "/api/home/reset-password?token=[REDACTED]&lang=vi",
    );
    expect(
      redactUrl("/api/admin/notifications/stream?ticket=SECRET"),
    ).toBe("/api/admin/notifications/stream?ticket=[REDACTED]");
  });

  test("không phân biệt hoa thường, nhận cả khóa mã hóa và dạng lồng nhau", () => {
    expect(redactUrl("/p?TOKEN=1&%74oken=2&x[token]=3&code=4&q=ok")).toBe(
      "/p?TOKEN=[REDACTED]&%74oken=[REDACTED]&x[token]=[REDACTED]&code=[REDACTED]&q=ok",
    );
  });

  test("không đụng tới khóa gần giống hoặc URL không có query", () => {
    expect(redactUrl("/api/products?search=tokens&page=2")).toBe(
      "/api/products?search=tokens&page=2",
    );
    expect(redactUrl("/api/products")).toBe("/api/products");
    expect(redactUrl("/p?flag")).toBe("/p?flag");
  });

  test("giá trị không phải chuỗi được trả lại nguyên", () => {
    expect(redactUrl(undefined)).toBeUndefined();
    expect(redactUrl(null)).toBeNull();
  });
});

describe("reqSerializer (pino-http)", () => {
  test("che token trong url và trong object query", () => {
    const serialized = reqSerializer({
      id: 7,
      method: "POST",
      url: "/api/home/reset-password?token=abc123&x=1",
      query: { token: "abc123", x: "1" },
      headers: { host: "api.example" },
      socket: { remoteAddress: "::1", remotePort: 5 },
    });
    expect(serialized.url).toBe("/api/home/reset-password?token=[REDACTED]&x=1");
    expect(serialized.query).toEqual({ token: "[REDACTED]", x: "1" });
    expect(JSON.stringify(serialized)).not.toContain("abc123");
    expect(serialized.method).toBe("POST");
  });
});
