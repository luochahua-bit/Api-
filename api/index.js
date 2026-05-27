// Vercel serverless entry
process.env.VERCEL = '1';
process.env.NODE_ENV = 'production';

const path = require('path');
const fs = require('fs');

// Ensure data directory exists (Vercel has a writable /tmp)
const dataDir = path.join('/tmp', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Override config paths before loading
const configModule = require.resolve('../src/config');
const origConfig = require(configModule);
origConfig.dataDir = dataDir;
origConfig.dbPath = path.join(dataDir, 'db.json');

// Load the Express app
const app = require('../src/index');

module.exports = app;
