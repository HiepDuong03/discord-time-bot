import db from '../database/db.js';
import { config } from '../config/env.js';
import { getWorkDateIso, addDaysToIso } from '../utils/dateUtils.js';

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
 * Tính ngày làm việc (work_date) theo múi giờ config.timezone và mốc Cut-off (mặc định 06:00 sáng).
 */
export function getWorkDate(targetDate = new Date()) {
  return getWorkDateIso(targetDate, config.cutoffHour, config.timezone);
}

let lastSplitCheckDate = null;
let lastSplitCheckMs = 0;

/**
 * Tự động cắt các ca đang ACTIVE vắt qua mốc 06:00 sáng:
 * - Chốt ca ngày cũ tại đúng mốc 06:00 sáng (tối đa MAX_SHIFT_MINUTES).
 * - Nếu ca vẫn đang trong giới hạn hoạt động bình thường (< 14h và liền kề ngày hôm qua),
 *   tự động mở nối tiếp ca mới từ 06:00 sáng cho ngày làm việc hôm nay.
 */
export async function splitOvernightActiveShifts(now = new Date(), force = false) {
  const currentWorkDate = getWorkDate(now);
  const nowMs = Date.now();
  if (!force && now.getTime() === nowMs && lastSplitCheckDate === currentWorkDate && (nowMs - lastSplitCheckMs) < 60000) {
    return 0;
  }

  const res = await db.execute({
    sql: `SELECT * FROM shifts WHERE status = 'ACTIVE' AND work_date < ?`,
    args: [currentWorkDate]
  });

  if (res.rows.length === 0) {
    if (now.getTime() === nowMs) {
      lastSplitCheckDate = currentWorkDate;
      lastSplitCheckMs = nowMs;
    }
    return 0;
  }

  const cutoffHourPad = String(config.cutoffHour).padStart(2, '0');
  const yesterdayWorkDate = addDaysToIso(currentWorkDate, -1);
  let processed = 0;

  for (const shift of res.rows) {
    const nextDayIso = addDaysToIso(shift.work_date, 1);
    const cutoffDate = new Date(`${nextDayIso}T${cutoffHourPad}:00:00+07:00`);
    const checkInMs = new Date(shift.check_in).getTime();
    const totalElapsedMinutes = Math.round((now.getTime() - checkInMs) / 60000);
    const oldDurationMinutes = Math.min(
      MAX_SHIFT_MINUTES,
      Math.max(1, Math.round((cutoffDate.getTime() - checkInMs) / 60000))
    );
    const newNote = shift.note ? `${shift.note} • [Tự chốt 06:00]` : '[Tự chốt 06:00]';

    await db.execute({
      sql: `UPDATE shifts
            SET check_out = ?, duration_minutes = ?, status = 'COMPLETED', note = ?
            WHERE id = ? AND status = 'ACTIVE'`,
      args: [cutoffDate.toISOString(), oldDurationMinutes, newNote, shift.id]
    });

    if (shift.work_date === yesterdayWorkDate && totalElapsedMinutes <= MAX_SHIFT_MINUTES) {
      await db.execute({
        sql: `INSERT INTO shifts (user_id, account_code, check_in, work_date, status, note)
              VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
        args: [shift.user_id, shift.account_code, cutoffDate.toISOString(), currentWorkDate, '[Ca nối tiếp sau 06:00]']
      }).catch(() => {});
    }
    processed++;
  }

  return processed;
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

  await splitOvernightActiveShifts();
  const [, , userActiveShift, accountActiveShift] = await Promise.all([
    registerOrUpdateUser(discordId, displayName),
    registerOrUpdateAccount(cleanAccount),
    getActiveShift(discordId),
    getActiveShiftByAccount(cleanAccount)
  ]);

  // 1. Kiểm tra chính Member này đã có ca đang chạy chưa
  if (userActiveShift) {
    return {
      success: false,
      errorType: 'USER_HAS_ACTIVE_SHIFT',
      message: `Bạn đang có ca làm việc dở dang trên Nick [${userActiveShift.account_code}]. Vui lòng bấm "Hết Ca" trước khi nhận Nick mới!`
    };
  }

  // 2. Chống tranh Nick: Kiểm tra xem Nick này đã có ai đang cày chưa
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

  let insertRes;
  try {
    insertRes = await db.execute({
      sql: `INSERT INTO shifts (user_id, account_code, check_in, work_date, status, note)
            VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
      args: [discordId, cleanAccount, checkInIso, workDate, note]
    });
  } catch (err) {
    const raceActive = await getActiveShiftByAccount(cleanAccount);
    if (raceActive) {
      return {
        success: false,
        errorType: 'ACCOUNT_OCCUPIED',
        occupantName: raceActive.display_name,
        message: `Nick [${cleanAccount}] vừa được nhận bởi **${raceActive.display_name}** (<@${raceActive.user_id}>)!`
      };
    }
    throw err;
  }

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
  await splitOvernightActiveShifts();
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

  const [memberSummary, accountSummary] = await Promise.all([
    getDaySummaryForUser(discordId, activeShift.work_date),
    getAccountDailySummary(activeShift.account_code, activeShift.work_date)
  ]);
  const accountTargetMinutes = Math.round(accountSummary.targetHours * 60);

  return {
    success: true,
    shiftId: activeShift.id,
    accountCode: activeShift.account_code,
    durationMinutes,
    memberTotalToday: memberSummary.totalMinutes,
    memberTargetHours: memberSummary.targetHours,
    accountTotalToday: accountSummary.completedMinutes,
    accountTargetHours: accountSummary.targetHours,
    accountRemainingMinutes: Math.max(0, accountTargetMinutes - accountSummary.completedMinutes),
    isAccountAchieved: accountSummary.completedMinutes >= accountTargetMinutes,
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
    userId,
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
  await splitOvernightActiveShifts();
  const [userRes, shiftRes, activeShift] = await Promise.all([
    db.execute({
      sql: 'SELECT daily_target_hours FROM users WHERE discord_id = ?',
      args: [discordId]
    }),
    db.execute({
      sql: `SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes
            FROM shifts
            WHERE user_id = ? AND work_date = ? AND status IN ('COMPLETED', 'ADJUSTED')`,
      args: [discordId, workDate]
    }),
    getActiveShift(discordId)
  ]);
  const user = userRes.rows[0];
  const targetHours = user?.daily_target_hours ? Number(user.daily_target_hours) : config.dailyTargetHours;
  const totalMinutes = Number(shiftRes.rows[0]?.total_minutes || 0);
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
  await splitOvernightActiveShifts();
  const cleanCode = normalizeAccountCode(accountCode);
  const [accRes, sumRes, activeShift] = await Promise.all([
    db.execute({
      sql: 'SELECT daily_target_hours FROM accounts WHERE account_code = ?',
      args: [cleanCode]
    }),
    db.execute({
      sql: `SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes
            FROM shifts
            WHERE account_code = ? AND work_date = ? AND status IN ('COMPLETED', 'ADJUSTED')`,
      args: [cleanCode, workDate]
    }),
    getActiveShiftByAccount(cleanCode)
  ]);
  const acc = accRes.rows[0];
  const targetHours = acc?.daily_target_hours ? Number(acc.daily_target_hours) : 8.0;
  const completedMinutes = Number(sumRes.rows[0]?.total_minutes || 0);
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
 * Lấy danh sách toàn bộ các Nick Game và tiến độ ngày hôm nay (1 Single SQL Query siêu tốc)
 */
export async function getAllAccountsTodaySummary(workDate = getWorkDate()) {
  await splitOvernightActiveShifts();
  const sql = `
    SELECT 
      a.account_code,
      COALESCE(a.daily_target_hours, 8.0) as target_hours,
      COALESCE(cs.completed_minutes, 0) as completed_minutes,
      act.id as active_shift_id,
      act.check_in as active_check_in,
      act.user_id as active_user_id,
      act.display_name as active_farmer_name
    FROM accounts a
    LEFT JOIN (
      SELECT account_code, SUM(duration_minutes) as completed_minutes
      FROM shifts
      WHERE work_date = ? AND status IN ('COMPLETED', 'ADJUSTED')
      GROUP BY account_code
    ) cs ON a.account_code = cs.account_code
    LEFT JOIN (
      SELECT s.id, s.account_code, s.check_in, s.user_id, u.display_name
      FROM shifts s
      JOIN users u ON s.user_id = u.discord_id
      WHERE s.status = 'ACTIVE' AND s.work_date = ?
    ) act ON a.account_code = act.account_code
    WHERE a.is_active = 1
  `;

  const res = await db.execute({ sql, args: [workDate, workDate] });
  const now = Date.now();

  const accounts = res.rows.map(row => {
    const targetHours = Number(row.target_hours);
    const completedMinutes = Number(row.completed_minutes);

    let activeMinutes = 0;
    if (row.active_check_in) {
      const diffMs = now - new Date(row.active_check_in).getTime();
      activeMinutes = Math.max(1, Math.round(diffMs / 60000));
    }

    const totalMinutes = completedMinutes + activeMinutes;
    const targetMinutes = Math.round(targetHours * 60);
    const remainingMinutes = Math.max(0, targetMinutes - totalMinutes);

    return {
      accountCode: row.account_code,
      workDate,
      targetHours,
      completedMinutes,
      activeMinutes,
      totalMinutes,
      remainingMinutes,
      isAchieved: totalMinutes >= targetMinutes,
      hasActiveShift: !!row.active_shift_id,
      activeFarmerName: row.active_farmer_name,
      activeFarmerId: row.active_user_id
    };
  });

  return accounts.sort((a, b) => {
    if (a.hasActiveShift && !b.hasActiveShift) return -1;
    if (!a.hasActiveShift && b.hasActiveShift) return 1;
    return b.totalMinutes - a.totalMinutes;
  });
}

/**
 * Thêm hoặc kích hoạt lại một Nick game chính thức vào danh mục
 */
export async function addOfficialAccount(accountCode, targetHours = 8.0) {
  const cleanCode = normalizeAccountCode(accountCode);
  if (!cleanCode || cleanCode.length < 2) {
    return { success: false, message: 'Mã Nick game không hợp lệ (tối thiểu 2 ký tự).' };
  }

  await db.execute({
    sql: `INSERT INTO accounts (account_code, daily_target_hours, is_active)
          VALUES (?, ?, 1)
          ON CONFLICT(account_code) DO UPDATE SET daily_target_hours = excluded.daily_target_hours, is_active = 1`,
    args: [cleanCode, targetHours]
  });

  return { success: true, accountCode: cleanCode, targetHours };
}

/**
 * Xóa hoặc hủy kích hoạt một Nick game khỏi danh mục hoạt động
 */
export async function removeOfficialAccount(accountCode) {
  const cleanCode = normalizeAccountCode(accountCode);

  // Kiểm tra xem nick có đang có ca ACTIVE chạy không
  const activeShift = await getActiveShiftByAccount(cleanCode);
  if (activeShift) {
    return {
      success: false,
      message: `Không thể xóa Nick [${cleanCode}] vì đang có người cày (${activeShift.display_name}). Vui lòng chốt ca trước!`
    };
  }

  // Đổi is_active = 0 thay vì xóa cứng để không ảnh hưởng dữ liệu lịch sử tính lương
  const res = await db.execute({
    sql: `UPDATE accounts SET is_active = 0 WHERE account_code = ?`,
    args: [cleanCode]
  });

  if (res.rowsAffected === 0) {
    return { success: false, message: `Không tìm thấy Nick [${cleanCode}] trong hệ thống.` };
  }

  return { success: true, accountCode: cleanCode };
}

/**
 * Xóa vĩnh viễn một Nick game khỏi bảng accounts trong Database (Hard Delete)
 * @param {string} accountCode
 * @param {boolean} deleteShiftHistory - Nếu true sẽ xóa luôn các ca làm cũ của nick này
 */
export async function deleteOfficialAccount(accountCode, deleteShiftHistory = false) {
  const cleanCode = normalizeAccountCode(accountCode);

  const activeShift = await getActiveShiftByAccount(cleanCode);
  if (activeShift) {
    return {
      success: false,
      message: `Không thể xóa Nick [${cleanCode}] vì đang có người cày (${activeShift.display_name}). Vui lòng dùng /force-checkout chốt ca trước!`
    };
  }

  const existing = await db.execute({
    sql: 'SELECT account_code FROM accounts WHERE account_code = ?',
    args: [cleanCode]
  });
  if (existing.rows.length === 0) {
    return { success: false, message: `Không tìm thấy Nick [${cleanCode}] trong hệ thống.` };
  }

  const shiftCountRes = await db.execute({
    sql: 'SELECT COUNT(*) as cnt FROM shifts WHERE account_code = ?',
    args: [cleanCode]
  });
  const shiftCount = Number(shiftCountRes.rows[0]?.cnt || 0);

  if (deleteShiftHistory && shiftCount > 0) {
    await db.execute({
      sql: 'DELETE FROM shifts WHERE account_code = ?',
      args: [cleanCode]
    });
  }

  await db.execute({
    sql: 'DELETE FROM accounts WHERE account_code = ?',
    args: [cleanCode]
  });

  return {
    success: true,
    accountCode: cleanCode,
    deletedShifts: deleteShiftHistory ? shiftCount : 0,
    preservedShifts: deleteShiftHistory ? 0 : shiftCount
  };
}

/**
 * Lấy toàn bộ danh sách Nick Game (cả active và inactive) cho Admin quản lý
 */
export async function getAllOfficialAccounts() {
  const res = await db.execute({
    sql: `SELECT account_code, daily_target_hours, is_active, created_at FROM accounts ORDER BY is_active DESC, account_code ASC`
  });
  return res.rows;
}

/**
 * Lấy danh sách các ca đang cày (ACTIVE) kèm tên nhân viên để Autocomplete cho /force-checkout
 */
export async function getAllActiveShifts() {
  const res = await db.execute({
    sql: `SELECT s.id, s.user_id, COALESCE(u.display_name, s.user_id) AS display_name, s.account_code, s.check_in, s.work_date
          FROM shifts s
          LEFT JOIN users u ON s.user_id = u.discord_id
          WHERE s.status = 'ACTIVE'
          ORDER BY s.check_in ASC`
  });
  return res.rows;
}

/**
 * Thêm hoặc cập nhật nhân viên trong DB
 */
export async function upsertStaffMember(discordId, displayName, targetHours = config.dailyTargetHours) {
  await db.execute({
    sql: `INSERT INTO users (discord_id, display_name, daily_target_hours)
          VALUES (?, ?, ?)
          ON CONFLICT(discord_id) DO UPDATE SET
            display_name = excluded.display_name,
            daily_target_hours = excluded.daily_target_hours`,
    args: [discordId, displayName, targetHours]
  });
  return { discordId, displayName, targetHours };
}

/**
 * Xóa bản ghi nhân viên khỏi bảng users nếu chưa có lịch sử ca làm việc (giữ toàn vẹn khóa ngoại)
 */
export async function removeStaffRecordIfUnused(discordId) {
  const countRes = await db.execute({
    sql: 'SELECT COUNT(*) as cnt FROM shifts WHERE user_id = ?',
    args: [discordId]
  });
  const shiftCount = Number(countRes.rows[0]?.cnt || 0);
  if (shiftCount > 0) {
    return { removedFromDb: false, shiftCount };
  }
  const delRes = await db.execute({
    sql: 'DELETE FROM users WHERE discord_id = ?',
    args: [discordId]
  });
  return { removedFromDb: (delRes.rowsAffected || 0) > 0, shiftCount: 0 };
}

/**
 * Lấy danh sách toàn bộ nhân viên đã lưu trong DB kèm số ca làm việc
 */
export async function getAllStaffMembers() {
  const res = await db.execute({
    sql: `SELECT u.discord_id, u.display_name, u.daily_target_hours, u.created_at,
                 COUNT(s.id) AS total_shifts,
                 SUM(CASE WHEN s.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_shifts
          FROM users u
          LEFT JOIN shifts s ON u.discord_id = s.user_id
          GROUP BY u.discord_id
          ORDER BY active_shifts DESC, u.display_name ASC`
  });
  return res.rows;
}

/**
 * Lấy tổng hợp giờ làm hôm nay của toàn đội (loại bỏ trùng lặp discord_id)
 */
export async function getTeamTodaySummary(workDate = getWorkDate()) {
  await splitOvernightActiveShifts();
  const sql = `
    SELECT
      roster.discord_id,
      COALESCE(u.display_name, roster.discord_id) AS display_name,
      u.daily_target_hours,
      COALESCE(cs.completed_minutes, 0) AS completed_minutes,
      act.id AS active_shift_id,
      act.account_code AS active_account,
      act.check_in AS active_check_in,
      act.work_date AS active_work_date
    FROM (
      SELECT discord_id FROM users
      UNION
      SELECT DISTINCT user_id AS discord_id FROM shifts WHERE work_date = ?
    ) roster
    LEFT JOIN users u ON roster.discord_id = u.discord_id
    LEFT JOIN (
      SELECT user_id, SUM(duration_minutes) AS completed_minutes
      FROM shifts
      WHERE work_date = ? AND status IN ('COMPLETED', 'ADJUSTED')
      GROUP BY user_id
    ) cs ON roster.discord_id = cs.user_id
    LEFT JOIN (
      SELECT id, user_id, account_code, check_in, work_date
      FROM shifts
      WHERE status = 'ACTIVE'
    ) act ON roster.discord_id = act.user_id
  `;
  const res = await db.execute({ sql, args: [workDate, workDate] });
  const now = Date.now();

  const team = res.rows.map(row => {
    const targetHours = row.daily_target_hours ? Number(row.daily_target_hours) : config.dailyTargetHours;
    const completedMinutes = Number(row.completed_minutes || 0);
    let activeMinutes = 0;
    let activeAccount = null;

    if (row.active_shift_id && row.active_work_date === workDate) {
      const diffMs = now - new Date(row.active_check_in).getTime();
      activeMinutes = Math.round(diffMs / 60000);
      activeAccount = row.active_account;
    }

    const grandTotalMinutes = completedMinutes + activeMinutes;
    const targetMinutes = Math.round(targetHours * 60);
    const remainingMinutes = Math.max(0, targetMinutes - grandTotalMinutes);

    return {
      discordId: row.discord_id,
      displayName: row.display_name,
      workDate,
      targetHours,
      completedMinutes,
      activeMinutes,
      activeAccount,
      totalMinutes: grandTotalMinutes,
      remainingMinutes,
      isAchieved: grandTotalMinutes >= targetMinutes,
      hasActiveShift: !!row.active_shift_id
    };
  });

  return team.sort((a, b) => b.totalMinutes - a.totalMinutes);
}

/**
 * Điều chỉnh giờ làm việc (hỗ trợ chọn Nick cụ thể và ngày làm việc cụ thể;
 * nếu không truyền accountCode, tự động gắn vào Nick gần nhất mà nhân sự đã cày trong ngày đó)
 */
export async function adjustShiftTime(userId, minutesChange, reason, adjustedBy, accountCode = null, customWorkDate = null) {
  const workDate = customWorkDate || getWorkDate();
  let resolvedAcc = accountCode ? normalizeAccountCode(accountCode) : null;

  if (!resolvedAcc) {
    const recentRes = await db.execute({
      sql: `SELECT account_code FROM shifts
            WHERE user_id = ? AND work_date = ? AND account_code IS NOT NULL AND account_code != 'DEFAULT_ACC'
            ORDER BY id DESC LIMIT 1`,
      args: [userId, workDate]
    });
    resolvedAcc = recentRes.rows[0]?.account_code || 'DEFAULT_ACC';
  }

  const nowIso = new Date().toISOString();
  const insertShiftRes = await db.execute({
    sql: `INSERT INTO shifts (user_id, account_code, check_in, check_out, duration_minutes, work_date, status, note)
          VALUES (?, ?, ?, ?, ?, ?, 'ADJUSTED', ?)`,
    args: [userId, resolvedAcc, nowIso, nowIso, minutesChange, workDate, `Điều chỉnh bởi ${adjustedBy}: ${reason}`]
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
    accountCode: resolvedAcc
  };
}

/**
 * Bàn giao ca 1-chạm: Chốt giờ cho người cũ và mở ca mới cho người mới trên cùng 1 Nick
 */
export async function handoffShift(newUserId, newDisplayName, accountCode) {
  const cleanAccount = normalizeAccountCode(accountCode);

  const [, , userActive, activeShift] = await Promise.all([
    registerOrUpdateUser(newUserId, newDisplayName),
    registerOrUpdateAccount(cleanAccount),
    getActiveShift(newUserId),
    getActiveShiftByAccount(cleanAccount)
  ]);

  // Kiểm tra xem chính người mới có đang dở ca nào không
  if (userActive) {
    return {
      success: false,
      message: `Bạn đang có ca làm việc dở dang trên Nick [${userActive.account_code}]. Vui lòng bấm "Hết Ca" trước!`
    };
  }

  if (!activeShift) {
    // Nếu nick đã trống rồi thì vào ca bình thường
    return await startShiftWithAccount(newUserId, newDisplayName, cleanAccount);
  }

  if (activeShift.user_id === newUserId) {
    return {
      success: false,
      message: `Bạn chính là người đang cày Nick [${cleanAccount}] này rồi!`
    };
  }

  const now = new Date();
  const checkInOld = new Date(activeShift.check_in);
  let oldDurationMinutes = Math.max(1, Math.round((now.getTime() - checkInOld.getTime()) / (1000 * 60)));
  if (oldDurationMinutes > MAX_SHIFT_MINUTES) oldDurationMinutes = MAX_SHIFT_MINUTES;

  const nowIso = now.toISOString();
  const workDate = getWorkDate(now);

  // 1. Chốt ca người cũ
  await db.execute({
    sql: `UPDATE shifts
          SET check_out = ?, duration_minutes = ?, status = 'COMPLETED', note = ?
          WHERE id = ?`,
    args: [nowIso, oldDurationMinutes, `[BÀN GIAO CA cho ${newDisplayName}]`, activeShift.id]
  });

  // 2. Mở ca mới cho người mới
  const newShiftRes = await db.execute({
    sql: `INSERT INTO shifts (user_id, account_code, check_in, work_date, status, note)
          VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
    args: [newUserId, cleanAccount, nowIso, workDate, `[NHẬN BÀN GIAO từ ${activeShift.display_name}]`]
  });

  // 3. Ghi log kiểm toán
  await db.execute({
    sql: `INSERT INTO audit_logs (shift_id, user_id, adjusted_by, minute_change, reason)
          VALUES (?, ?, ?, 0, ?)`,
    args: [Number(newShiftRes.lastInsertRowid), newUserId, newDisplayName, `Nhận bàn giao ca từ ${activeShift.display_name} (<@${activeShift.user_id}>)`]
  });

  return {
    success: true,
    accountCode: cleanAccount,
    workDate,
    oldUser: {
      id: activeShift.user_id,
      displayName: activeShift.display_name,
      durationMinutes: oldDurationMinutes
    },
    newShift: {
      id: Number(newShiftRes.lastInsertRowid),
      checkInTime: now,
      displayName: newDisplayName
    }
  };
}
