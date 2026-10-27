import db from '../src/database/db.js';

async function migrateAndClean() {
  console.log('🔄 ĐANG NÂNG CẤP BẢNG ACCOUNTS VÀ DỌN DẸP DỮ LIỆU TEST...');

  // 1. Thêm cột is_active vào accounts nếu chưa có
  try {
    await db.execute('ALTER TABLE accounts ADD COLUMN is_active INTEGER DEFAULT 1');
    console.log('✅ Đã thêm cột is_active vào bảng accounts');
  } catch (err) {
    if (err.message.includes('duplicate column') || err.message.includes('already exists')) {
      console.log('ℹ️ Cột is_active đã tồn tại.');
    } else {
      console.warn('⚠️ Lỗi khi thêm cột is_active:', err.message);
    }
  }

  // 2. Xóa các nick test và ca test
  const testCodes = ['TEST_ACC_01', 'TURSO_TEST_01', 'ACC_HANDOFF_TEST', 'DEFAULT_ACC'];
  
  await db.execute({
    sql: `DELETE FROM shifts WHERE account_code IN (?, ?, ?, ?)`,
    args: testCodes
  });
  console.log('✅ Đã xóa toàn bộ ca làm test liên quan đến:', testCodes.join(', '));

  await db.execute({
    sql: `DELETE FROM accounts WHERE account_code IN (?, ?, ?, ?)`,
    args: testCodes
  });
  console.log('✅ Đã xóa toàn bộ nick test khỏi bảng accounts:', testCodes.join(', '));

  // Kiểm tra lại danh sách accounts hiện tại
  const remaining = await db.execute('SELECT * FROM accounts');
  console.log('📊 Danh sách accounts hiện tại:', remaining.rows);
}

migrateAndClean().catch(console.error);
