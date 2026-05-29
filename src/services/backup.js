/**
 * Database Backup Service
 * Backs up db.json to Supabase Storage every hour
 * Auto-restores on startup if local file is missing
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const BUCKET = 'backups';
const BACKUP_FILE = 'db-latest.json';
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let backupTimer = null;

function getHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };
}

// Upload db.json to Supabase Storage
async function backup() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  if (!fs.existsSync(config.dbPath)) return;

  try {
    const data = fs.readFileSync(config.dbPath);
    const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${BACKUP_FILE}`;
    await axios.put(url, data, {
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    console.log(`[Backup] Uploaded db.json to Supabase Storage (${(data.length / 1024).toFixed(1)}KB)`);
  } catch (err) {
    console.error('[Backup] Upload failed:', err.message);
  }
}

// Download db.json from Supabase Storage
async function restore() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;

  try {
    const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${BACKUP_FILE}`;
    const resp = await axios.get(url, {
      headers: getHeaders(),
      timeout: 30000,
      responseType: 'arraybuffer',
    });

    if (resp.status === 200 && resp.data.length > 0) {
      // Write to temp file first, then rename (atomic)
      const tmpPath = config.dbPath + '.restore';
      fs.writeFileSync(tmpPath, resp.data);
      fs.renameSync(tmpPath, config.dbPath);
      console.log(`[Backup] Restored db.json from Supabase Storage (${(resp.data.length / 1024).toFixed(1)}KB)`);
      return true;
    }
  } catch (err) {
    console.error('[Backup] Restore failed:', err.message);
  }
  return false;
}

// Start periodic backup
function start() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('[Backup] Supabase not configured, backup disabled');
    return;
  }
  console.log('[Backup] Started, interval: 1 hour');
  backupTimer = setInterval(backup, BACKUP_INTERVAL_MS);
  // Initial backup after 30 seconds (let the server finish starting)
  setTimeout(backup, 30000);
}

function stop() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
}

module.exports = { backup, restore, start, stop };
