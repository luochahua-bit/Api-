// Vercel serverless entry — no modifications to src/index.js needed
process.env.VERCEL = '1';
const app = require('../src/index');
module.exports = app;
