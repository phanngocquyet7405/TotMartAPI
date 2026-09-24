const multer = require("multer");
const path = require("path");

// Sử dụng memoryStorage để có thể tiếp tục pass buffer sang Cloudinary, S3 hoặc xử lý ảnh sau đó
const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
];
const ALLOWED_EXTENSIONS = /jpeg|jpg|png|webp/;

const fileFilter = (req, file, cb) => {
  const mimeValid = ALLOWED_MIME_TYPES.includes(file.mimetype);
  const extValid = ALLOWED_EXTENSIONS.test(
    path.extname(file.originalname).toLowerCase(),
  );

  if (mimeValid && extValid) {
    cb(null, true);
  } else {
    const error = new Error(
      "Invalid file type. Chỉ cho phép định dạng ảnh JPG, JPEG, PNG, WEBP.",
    );
    error.statusCode = 400;
    cb(error, false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 5,
  },
  fileFilter,
});

module.exports = upload;
