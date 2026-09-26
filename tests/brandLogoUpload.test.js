jest.mock("../src/models/Brand", () => {
  const Brand = jest.fn();
  Brand.exists = jest.fn();
  Brand.findByIdAndUpdate = jest.fn();
  Brand.findByIdAndDelete = jest.fn();
  return Brand;
});
jest.mock("../src/models/User", () => ({ findById: jest.fn() }));
jest.mock("../src/utils/brandLogoStorage", () => ({ uploadLogo: jest.fn(), removeLogo: jest.fn() }));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const Brand = require("../src/models/Brand");
const User = require("../src/models/User");
const storage = require("../src/utils/brandLogoStorage");
const config = require("../src/config/environment");
const app = express();
app.use(express.json());
app.use(require("../src/routes/brandRouter"));
app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
const id = "507f1f77bcf86cd799439011";
const token = jwt.sign({ userId: id, role: "admin", tokenVersion: 0 }, config.jwt.secret);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
let save;
let select;
beforeEach(() => {
  jest.resetAllMocks();
  User.findById.mockResolvedValue({ _id: id, role: "admin", isActive: true, tokenVersion: 0 });
  save = jest.fn().mockResolvedValue(undefined);
  Brand.mockImplementation(function (data) { Object.assign(this, data); this.save = save; });
  Brand.exists.mockResolvedValue({ _id: id });
  select = jest.fn().mockResolvedValue({ logoPublicId: "brand_logos/old" });
  Brand.findByIdAndUpdate.mockReturnValue({ select });
  storage.uploadLogo.mockResolvedValue({ url: "https://res.cloudinary.com/demo/image/upload/new.png", publicId: "brand_logos/new" });
  storage.removeLogo.mockResolvedValue(undefined);
});
const authorized = (method, path) => request(app)[method](path).set("Authorization", `Bearer ${token}`);
const attach = (req) => req.attach("logo", png, { filename: "logo.png", contentType: "image/png" });

test("creates a brand from multipart fields and a logo", async () => {
  const response = await attach(authorized("post", "/create-brand").field("name", "Test Brand"));
  expect(response.status).toBe(201);
  expect(response.body.data.logo).toBe("https://res.cloudinary.com/demo/image/upload/new.png");
  expect(Brand).toHaveBeenCalledWith(expect.objectContaining({ name: "Test Brand", logoPublicId: "brand_logos/new" }));
  expect(save).toHaveBeenCalledTimes(1);
});
test("accepts a logo-only update and cleans the atomically replaced image", async () => {
  expect((await attach(authorized("put", `/update-brand/${id}`))).status).toBe(200);
  expect(Brand.findByIdAndUpdate).toHaveBeenCalledWith(id, expect.objectContaining({ logoPublicId: "brand_logos/new" }), { new: false, runValidators: true });
  expect(storage.removeLogo).toHaveBeenCalledWith("brand_logos/old");
});
test("text-only updates leave the existing logo alone", async () => {
  expect((await authorized("put", `/update-brand/${id}`).send({ name: "Renamed Brand" })).status).toBe(200);
  expect(Brand.findByIdAndUpdate.mock.calls[0][1]).toEqual({ name: "Renamed Brand" });
  expect(storage.uploadLogo).not.toHaveBeenCalled();
  expect(storage.removeLogo).not.toHaveBeenCalled();
});
test("invalid fields are rejected before Cloudinary upload", async () => {
  expect((await attach(authorized("post", "/create-brand").field("name", "x"))).status).toBe(400);
  expect(storage.uploadLogo).not.toHaveBeenCalled();
});
test("empty updates are rejected", async () => {
  expect((await authorized("put", `/update-brand/${id}`).send({})).status).toBe(400);
  expect(Brand.findByIdAndUpdate).not.toHaveBeenCalled();
});
test("URL strings are rejected; clients must upload a file", async () => {
  expect((await authorized("post", "/create-brand").send({ name: "Brand Name", logo: "https://example.com/logo.png" })).status).toBe(400);
});
test("rejects a forged image MIME type", async () => {
  expect((await authorized("post", "/create-brand").field("name", "Brand Name").attach("logo", Buffer.from("not an image"), { filename: "fake.png", contentType: "image/png" })).status).toBe(400);
  expect(storage.uploadLogo).not.toHaveBeenCalled();
});
test("rejects files over 2 MB", async () => {
  expect((await authorized("post", "/create-brand").field("name", "Brand Name").attach("logo", Buffer.alloc(2 * 1024 * 1024 + 1), { filename: "large.png", contentType: "image/png" })).status).toBe(400);
  expect(storage.uploadLogo).not.toHaveBeenCalled();
});
test("rejects an unexpected file field", async () => {
  expect((await authorized("post", "/create-brand").field("name", "Brand Name").attach("image", png, "logo.png")).status).toBe(400);
});
test("rejects non-admins before upload", async () => {
  User.findById.mockResolvedValue({ _id: id, role: "user", isActive: true, tokenVersion: 0 });
  expect((await attach(authorized("post", "/create-brand").field("name", "Brand Name"))).status).toBe(403);
  expect(storage.uploadLogo).not.toHaveBeenCalled();
});
test("cleans a newly uploaded logo when create fails", async () => {
  save.mockRejectedValue(new Error("Database write failed"));
  expect((await attach(authorized("post", "/create-brand").field("name", "Brand Name"))).status).toBe(500);
  expect(storage.removeLogo).toHaveBeenCalledWith("brand_logos/new");
});
test("keeps the previous image when update fails", async () => {
  select.mockRejectedValue(new Error("Database write failed"));
  expect((await attach(authorized("put", `/update-brand/${id}`))).status).toBe(500);
  expect(storage.removeLogo).toHaveBeenCalledTimes(1);
  expect(storage.removeLogo).toHaveBeenCalledWith("brand_logos/new");
});
test("does not upload for a nonexistent brand", async () => {
  Brand.exists.mockResolvedValue(null);
  expect((await attach(authorized("put", `/update-brand/${id}`))).status).toBe(404);
  expect(storage.uploadLogo).not.toHaveBeenCalled();
});
test("cleans new upload if the brand is deleted during upload", async () => {
  select.mockResolvedValue(null);
  expect((await attach(authorized("put", `/update-brand/${id}`))).status).toBe(404);
  expect(storage.removeLogo).toHaveBeenCalledWith("brand_logos/new");
});
