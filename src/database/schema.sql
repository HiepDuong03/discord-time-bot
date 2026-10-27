-- 1. Bảng lưu danh sách thành viên
CREATE TABLE IF NOT EXISTS users (
    discord_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    daily_target_hours REAL DEFAULT 8.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng lưu danh mục tài khoản game (Accounts)
CREATE TABLE IF NOT EXISTS accounts (
    account_code TEXT PRIMARY KEY,
    daily_target_hours REAL DEFAULT 8.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bảng lưu chi tiết các ca làm việc
CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    account_code TEXT DEFAULT 'DEFAULT_ACC',
    check_in TEXT NOT NULL,
    check_out TEXT,
    duration_minutes INTEGER DEFAULT 0,
    work_date TEXT NOT NULL,
    status TEXT DEFAULT 'ACTIVE',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(discord_id)
);

-- 4. Bảng lưu lịch sử điều chỉnh giờ làm của quản lý
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER,
    user_id TEXT NOT NULL,
    adjusted_by TEXT NOT NULL,
    minute_change INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chỉ mục để tối ưu tốc độ truy vấn báo cáo
CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON shifts(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_shifts_work_date ON shifts(work_date);
CREATE INDEX IF NOT EXISTS idx_shifts_account_date ON shifts(account_code, work_date);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
