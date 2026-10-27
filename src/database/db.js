import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Đảm bảo thư mục data tồn tại
const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'timesheet.db');
const db = new Database(dbPath);

// Kích hoạt WAL mode để tăng tốc độ ghi và an toàn dữ liệu
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Kiểm tra và tự động migration cột account_code nếu chưa có
const tableInfo = db.prepare("PRAGMA table_info(shifts)").all();
if (tableInfo.length > 0) {
  const hasAccountCode = tableInfo.some(col => col.name === 'account_code');
  if (!hasAccountCode) {
    db.exec("ALTER TABLE shifts ADD COLUMN account_code TEXT DEFAULT 'DEFAULT_ACC'");
    console.log('[DATABASE] Đã tự động migration: Thêm cột account_code vào bảng shifts.');
  }
}

// Đọc và khởi tạo schema (tạo bảng accounts và indexes nếu chưa có)
const schemaPath = path.join(__dirname, 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);

console.log(`[DATABASE] Đã kết nối thành công SQLite tại: ${dbPath}`);

export default db;
