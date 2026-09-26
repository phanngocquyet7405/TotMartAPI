const multer = require("multer");

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const parseLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 8, parts: 9, fieldSize: 4096 },
  fileFilter(req, file, callback) {
    if (!allowedTypes.has(file.mimetype)) {
      const error = new Error("Logo must be a JPEG, PNG, or WebP image.");
      error.statusCode = 400;
      return callback(error);
    }
    callback(null, true);
  },
}).single("logo");

module.exports = function brandLogoUpload(req, res, next) {
  parseLogo(req, res, (error) => {
    if (error) {
      error.statusCode = 400;
      return next(error);
    }
    // Multipart content types are client-supplied: also check the file signature.
    if (req.file) {
      const data = req.file.buffer;
      const jpeg = data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
      const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
      const webp = data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
      const matches = { "image/jpeg": jpeg, "image/png": png, "image/webp": webp };
      if (!matches[req.file.mimetype]) {
        const invalidImage = new Error("Logo content does not match its image type.");
        invalidImage.statusCode = 400;
        return next(invalidImage);
      }
    }
    next();
  });
};
