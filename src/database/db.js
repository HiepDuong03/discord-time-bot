import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const url = config.tursoDatabaseUrl || process.env.TURSO_DATABASE_URL || 'file:data/timesheet.db';
const authToken = config.tursoAuthToken || process.env.TURSO_AUTH_TOKEN || undefined;

export const db = createClient({
  url,
  authToken
});

export async function initDatabase() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await db.executeMultiple(schemaSql);
    const mode = url.startsWith('file:') ? 'Local SQLite (File)' : 'Turso Cloud (libSQL 24/7)';
    console.log(`[DATABASE] ✅ Kết nối thành công Cơ Sở Dữ Liệu: ${mode}`);
  } catch (err) {
    console.error('[DATABASE ERROR] ❌ Lỗi khởi tạo schema:', err.message);
  }
}

export default db;
