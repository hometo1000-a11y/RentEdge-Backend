const admin = require('firebase-admin');

const key = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

console.log("Project:", process.env.FIREBASE_PROJECT_ID);
console.log("Client:", process.env.FIREBASE_CLIENT_EMAIL);

console.log("Contains literal \\n :", key.includes("\\n"));
console.log("Contains real newline :", key.includes("\n"));

console.log("First 40 chars:", JSON.stringify(key.substring(0, 40)));
console.log("Last 40 chars:", JSON.stringify(key.substring(key.length - 40)));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: key,
    }),
  });

  console.log("Firebase initialized successfully");
}

module.exports = admin;