const cloudinary = require("cloudinary").v2;
const logger = require("./logger");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

async function removeLogo(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  } catch (error) {
    // Cleanup must not turn a successful database write into an API failure.
    logger.warn({ err: error, publicId }, "Brand logo cleanup failed");
  }
}

function uploadLogo(file) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder: "brand_logos",
      resource_type: "image",
      allowed_formats: ["jpg", "png", "webp"],
      timeout: 60000,
    }, (error, result) => {
      if (error) return reject(error);
      resolve({ url: result.secure_url, publicId: result.public_id });
    });
    stream.once("error", reject);
    stream.end(file.buffer);
  });
}

module.exports = { uploadLogo, removeLogo };
