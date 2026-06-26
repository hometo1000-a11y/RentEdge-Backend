const admin = require("firebase-admin");

const key = process.env.FIREBASE_PRIVATE_KEY;

console.log(JSON.stringify(key.slice(0, 60)));

for (let i = 0; i < 40; i++) {
  console.log(i, key.charCodeAt(i), JSON.stringify(key[i]));
}