const ImageKit = require('@imagekit/nodejs');
require('dotenv').config();

let imagekit;
try {
  imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
  });
  console.log("ImageKit config initialized successfully.");
} catch (err) {
  console.error("ImageKit initialization error:", err);
}

module.exports = imagekit;
