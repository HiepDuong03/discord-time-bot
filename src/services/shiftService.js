import db from '../database/db.js';
import { config } from '../config/env.js';

// Mốc chặn an toàn tối đa cho 1 ca cày liên tục (14 tiếng = 840 phút)
const MAX_SHIFT_MINUTES = 14 * 60;

/**
 * Chuẩn hóa tên Nick game: Xóa khoảng trắng, đổi dấu '-' thành '_', viết in hoa
 * Ví dụ: 'acc-01', 'acc 01', 'Acc_01' -> đều thành 'ACC_01'
 */
export function normalizeAccountCode(rawCode) {
  if (!rawCode) return 'DEFAULT_ACC';
  return rawCode
    .trim()
    .replace(/[\s\-]+/g, '_')
    .toUpperCase();
}

/**
 * Tính ngày làm việc (work_date) theo mốc Cut-off (mặc định 06:00 sáng).
 */
export function getWorkDate(targetDate = new Date()) {
  const d = new Date(targetDate);
  if (d.getHours() < config.cutoffHour) {
    d.setDate(d.getDate() - 1);
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Đăng ký hoặc cập nhật thông tin thành viên
 */
export async function registerOrUpdateUser(discordId, displayName, targetHours = config.dailyTargetHours) {
  await db.execute({
    sql: `INSERT INTO users (discord_id, display_name, daily_target_hours)
          VALUES (?, ?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET display_name = excluded.display_name`,
    args: [discordId, displayName, targetHours]
  });
}

/**
 * Đăng ký tài khoản game vào danh mục nếu chưa có
 */
export async function registerOrUpdateAccount(accountCode, targetHours = 8.0) {
  const cleanCode = normalizeAccountCode(accountCode);
  await db.execute({
    sql: `INSERT INTO accounts (account_code, daily_target_hours)
          VALUES (?, ?)
          ON CONFLICT(account_code) DO NOTHING`,
    args: [cleanCode, targetHours]
  });
  return cleanCode;
}

/**
 * Lấy ca làm việc đang hoạt động của user
 */
export async function getActiveShift(discordId) {
  const res = await db.execute({
    sql: `SELECT * FROM shifts
          WHERE user_id = ? AND status = 'ACTIVE'
          ORDER BY id DESC LIMIT 1`,
    args: [discordId]
  });
  return res.rows[0] || null;
}

/**
 * Kiểm tra xem 1 Nick game hiện tại có ai đang cày không (Chống tranh acc)
 */
export async function getActiveShiftByAccount(accountCode) {
  const cleanCode = normalizeAccountCode(accountCode);
  const res = await db.execute({
    sql: `SELECT s.*, u.display_name
          FROM shifts s
          JOIN users u ON s.user_id = u.discord_id
          WHERE s.account_code = ? AND s.status = 'ACTIVE'
          ORDER BY s.id DESC LIMIT 1`,
    args: [cleanCode]
  });
  return res.rows[0] || null;
}

/**
 * Bắt đầu ca làm việc có gắn Nick game (Nguyên tử - Atomic Transaction)
 */
export async function startShiftWithAccount(discordId, displayName, accountCode, note = '') {
  const cleanAccount = normalizeAccountCode(accountCode);

  await registerOrUpdateUser(discordId, displayName);
  await registerOrUpdateAccount(cleanAccount);

  // 1. Kiểm tra chính Member này đã có ca đang chạy chưa
  const userActiveShift = await getActiveShift(discordId);
  if (userActiveShift) {
    return {
      success: false,
      errorType: 'USER_HAS_ACTIVE_SHIFT',
      message: `Bạn đang có ca làm việc dở dang trên Nick [${userActiveShift.account_code}]. Vui lòng bấm "Hết Ca" trước khi nhận Nick mới!`
    };
  }

  // 2. Chống tranh Nick: Kiểm tra xem Nick này đã có ai đang cày chưa
  const accountActiveShift = await getActiveShiftByAccount(cleanAccount);
  if (accountActiveShift) {
    return {
      success: false,
      errorType: 'ACCOUNT_OCCUPIED',
      occupantName: accountActiveShift.display_name,
      message: `Nick [${cleanAccount}] hiện đang được cày bởi **${accountActiveShift.display_name}** (<@${accountActiveShift.user_id}>)! Vui lòng chọn Nick khác hoặc đợi đổi ca.`
    };
  }

  const now = new Date();
  const workDate = getWorkDate(now);
  const checkInIso = now.toISOString();

  const insertRes = await db.execute({
    sql: `INSERT INTO shifts (user_id, account_code, check_in, work_date, status, note)
          VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
    args: [discordId, cleanAccount, checkInIso, workDate, note]
  });

  return {
    success: true,
    shiftId: Number(insertRes.lastInsertRowid),
    accountCode: cleanAccount,
    checkInTime: now,
    workDate
  };
}

/**
 * Kết thúc ca làm việc (Check-out)
 */
export async function endShift(discordId) {
  const activeShift = await getActiveShift(discordId);
  if (!activeShift) {
    return {
      success: false,
      message: 'Bạn hiện không có ca làm việc nào đang hoạt động.'
    };
  }

  const checkIn = new Date(activeShift.check_in);
  const now = new Date();
  let durationMinutes = Math.round((now.getTime() - checkIn.getTime()) / (1000 * 60));
  if (durationMinutes < 1) durationMinutes = 1;

  if (durationMinutes > MAX_SHIFT_MINUTES) {
    durationMinutes = MAX_SHIFT_MINUTES;
  }

  const checkOutIso = now.toISOString();

  await db.execute({
    sql: `UPDATE shifts 
          SET check_out = ?, duration_minutes = ?, status = 'COMPLETED'
          WHERE id = ?`,
    args: [checkOutIso, durationMinutes, activeShift.id]
  });

  const memberSummary = await getDaySummaryForUser(discordId, activeShift.work_date);
  const accountSummary = await getAccountDailySummary(activeShift.account_code, activeShift.work_date);

  return {
    success: true,
    shiftId: activeShift.id,
    accountCode: activeShift.account_code,
    durationMinutes,
    memberTotalToday: memberSummary.totalMinutes,
    accountTotalToday: accountSummary.completedMinutes,
    isAccountAchieved: accountSummary.completedMinutes >= 480,
    workDate: activeShift.work_date
  };
}

/**
 * Cưỡng chế kết thúc ca của 1 Member (Dành cho Quản lý khi member ngủ quên)
 */
export async function forceEndShiftByUser(userId, leaderName, reason) {
  const activeShift = await getActiveShift(userId);
  if (!activeShift) {
    return {
      success: false,
      message: `Thành viên <@${userId}> hiện không có ca làm việc nào đang chạy.`
    };
  }

  const now = new Date();
  const checkIn = new Date(activeShift.check_in);
  const durationMs = now.getTime() - checkIn.getTime();
  let durationMinutes = Math.max(1, Math.round(durationMs / 60000));
  if (durationMinutes > MAX_SHIFT_MINUTES) durationMinutes = MAX_SHIFT_MINUTES;

  const note = `[FORCE_CHECKOUT bởi ${leaderName}]: ${reason}`;

  await db.execute({
    sql: `UPDATE shifts
          SET check_out = ?, duration_minutes = ?, status = 'COMPLETED', note = ?
          WHERE id = ?`,
    args: [now.toISOString(), durationMinutes, note, activeShift.id]
  });

  return {
    success: true,
    accountCode: activeShift.account_code,
    durationMinutes,
    workDate: activeShift.work_date
  };
}

/**
 * Cưỡng chế giải phóng 1 Nick Game đang bị kẹt
 */
export async function forceReleaseAccount(accountCode, leaderName, reason) {
  const cleanCode = normalizeAccountCode(accountCode);
  const activeShift = await getActiveShiftByAccount(cleanCode);

  if (!activeShift) {
    return {
      success: false,
      message: `Nick [${cleanCode}] hiện đang TRỐNG (không có ai cày).`
    };
  }

  return forceEndShiftByUser(activeShift.user_id, leaderName, reason);
}

/**
 * Thống kê tổng giờ làm của 1 Member trong ngày
 */
export async function getDaySummaryForUser(discordId, workDate = getWorkDate()) {
  const userRes = await db.execute({
    sql: 'SELECT daily_target_hours FROM users WHERE discord_id = ?',
    args: [discordId]
  });
  const user = userRes.rows[0];
  const targetHours = user?.daily_target_hours ? Number(user.daily_target_hours) : config.dailyTargetHours;

  const shiftRes = await db.execute({
    sql: `SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes
          FROM shifts
          WHERE user_id = ? AND work_date = ? AND status IN ('COMPLETED', 'ADJUSTED')`,
    args: [discordId, workDate]
  });
  const totalMinutes = Number(shiftRes.rows[0]?.total_minutes || 0);

  const activeShift = await getActiveShift(discordId);
  let activeMinutes = 0;
  let activeAccount = null;
  if (activeShift && activeShift.work_date === workDate) {
    const diffMs = Date.now() - new Date(activeShift.check_in).getTime();
    activeMinutes = Math.round(diffMs / 60000);
    activeAccount = activeShift.account_code;
  }

  const grandTotalMinutes = totalMinutes + activeMinutes;
  const targetMinutes = Math.round(targetHours * 60);
  const remainingMinutes = Math.max(0, targetMinutes - grandTotalMinutes);

  return {
    workDate,
    targetHours,
    completedMinutes: totalMinutes,
    activeMinutes,
    activeAccount,
    totalMinutes: grandTotalMinutes,
    remainingMinutes,
    isAchieved: grandTotalMinutes >= targetMinutes,
    hasActiveShift: !!activeShift
  };
}

/**
 * Thống kê tổng giờ cày của 1 NICK GAME trong ngày
 */
export async function getAccountDailySummary(accountCode, workDate = getWorkDate()) {
  const cleanCode = normalizeAccountCode(accountCode);
  const accRes = await db.execute({
    sql: 'SELECT daily_target_hours FROM accounts WHERE account_code = ?',
    args: [cleanCode]
  });
  const acc = accRes.rows[0];
  const targetHours = acc?.daily_target_hours ? Number(acc.daily_target_hours) : 8.0;

  const sumRes = await db.execute({
    sql: `SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes
          FROM shifts
          WHERE account_code = ? AND work_date = ? AND status IN ('COMPLETED', 'ADJUSTED')`,
    args: [cleanCode, workDate]
  });
  const completedMinutes = Number(sumRes.rows[0]?.total_minutes || 0);

  const activeShift = await getActiveShiftByAccount(cleanCode);
  let activeMinutes = 0;
  let activeFarmerName = null;
  let activeFarmerId = null;

  if (activeShift && activeShift.work_date === workDate) {
    const diffMs = Date.now() - new Date(activeShift.check_in).getTime();
    activeMinutes = Math.round(diffMs / 60000);
    activeFarmerName = activeShift.display_name;
    activeFarmerId = activeShift.user_id;
  }

  const grandTotalMinutes = completedMinutes + activeMinutes;
  const targetMinutes = Math.round(targetHours * 60);
  const remainingMinutes = Math.max(0, targetMinutes - grandTotalMinutes);

  return {
    accountCode: cleanCode,
    workDate,
    targetHours,
    completedMinutes,
    activeMinutes,
    totalMinutes: grandTotalMinutes,
    remainingMinutes,
    isAchieved: grandTotalMinutes >= targetMinutes,
    hasActiveShift: !!activeShift,
    activeFarmerName,
    activeFarmerId
  };
}

/**
 * Lấy danh sách toàn bộ các Nick Game và tiến độ ngày hôm nay
 */
export async function getAllAccountsTodaySummary(workDate = getWorkDate()) {
  const accountsRes = await db.execute({
    sql: `SELECT DISTINCT account_code FROM accounts
          UNION
          SELECT DISTINCT account_code FROM shifts WHERE work_date = ?`,
    args: [workDate]
  });

  const accounts = [];
  for (const a of accountsRes.rows) {
    if (!a.account_code) continue;
    const summary = await getAccountDailySummary(a.account_code, workDate);
    accounts.push(summary);
  }

  return accounts.sort((a, b) => {
    if (a.hasActiveShift && !b.hasActiveShift) return -1;
    if (!a.hasActiveShift && b.hasActiveShift) return 1;
    return b.totalMinutes - a.totalMinutes;
  });
}

/**
 * Lấy tổng hợp giờ làm hôm nay của toàn đội
 */
export async function getTeamTodaySummary(workDate = getWorkDate()) {
  const usersRes = await db.execute({
    sql: `SELECT discord_id, display_name FROM users
          UNION
          SELECT DISTINCT user_id as discord_id, user_id as display_name FROM shifts WHERE work_date = ?`,
    args: [workDate]
  });

  const team = [];
  for (const user of usersRes.rows) {
    const summary = await getDaySummaryForUser(user.discord_id, workDate);
    team.push({
      discordId: user.discord_id,
      displayName: user.display_name,
      ...summary
    });
  }

  return team.sort((a, b) => b.totalMinutes - a.totalMinutes);
}

/**
 * Điều chỉnh giờ làm việc
 */
export async function adjustShiftTime(userId, minutesChange, reason, adjustedBy, accountCode = 'DEFAULT_ACC') {
  const workDate = getWorkDate();
  const cleanAccount = normalizeAccountCode(accountCode);

  const insertShiftRes = await db.execute({
    sql: `INSERT INTO shifts (user_id, account_code, check_in, check_out, duration_minutes, work_date, status, note)
          VALUES (?, ?, datetime('now'), datetime('now'), ?, ?, 'ADJUSTED', ?)`,
    args: [userId, cleanAccount, minutesChange, workDate, `Điều chỉnh bởi ${adjustedBy}: ${reason}`]
  });

  const shiftId = Number(insertShiftRes.lastInsertRowid);

  await db.execute({
    sql: `INSERT INTO audit_logs (shift_id, user_id, adjusted_by, minute_change, reason)
          VALUES (?, ?, ?, ?, ?)`,
    args: [shiftId, userId, adjustedBy, minutesChange, reason]
  });

  return {
    success: true,
    minutesChange,
    workDate,
    accountCode: cleanAccount
  };
}
