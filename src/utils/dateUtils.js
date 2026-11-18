import { config } from '../config/env.js';

const pad2 = n => String(n).padStart(2, '0');

/**
 * Lấy năm, tháng (1-12), ngày, giờ (0-23), phút, giây, thứ (0=CN..6=T7) theo múi giờ cấu hình (Asia/Ho_Chi_Minh)
 */
export function getDateTimePartsInTimezone(date = new Date(), timeZone = config.timezone) {
  const d = date instanceof Date ? date : new Date(date);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(d);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10) % 24,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    weekday: weekdayMap[map.weekday] ?? 0
  };
}

/**
 * Lấy năm, tháng (1-12), ngày, thứ trong tuần (0=CN..6=T7) theo múi giờ cấu hình
 */
export function getDatePartsInTimezone(date = new Date(), timeZone = config.timezone) {
  const { year, month, day, weekday } = getDateTimePartsInTimezone(date, timeZone);
  return { year, month, day, weekday };
}

/**
 * Lấy chuỗi YYYY-MM-DD của ngày hiện tại theo múi giờ cấu hình
 */
export function getTodayIso(date = new Date(), timeZone = config.timezone) {
  const { year, month, day } = getDateTimePartsInTimezone(date, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Tính ngày làm việc (work_date) theo múi giờ config.timezone và mốc cutoffHour (mặc định 06:00 sáng).
 */
export function getWorkDateIso(targetDate = new Date(), cutoffHour = config.cutoffHour, timeZone = config.timezone) {
  const { year, month, day, hour } = getDateTimePartsInTimezone(targetDate, timeZone);
  const todayIso = `${year}-${pad2(month)}-${pad2(day)}`;
  if (hour < cutoffHour) {
    return addDaysToIso(todayIso, -1);
  }
  return todayIso;
}

/**
 * Tính số giờ còn lại tới mốc chốt ngày (cutoffHour:00:00) theo múi giờ config.timezone
 */
export function getHoursUntilCutoffInTz(now = new Date(), cutoffHour = config.cutoffHour, timeZone = config.timezone) {
  const { hour, minute, second } = getDateTimePartsInTimezone(now, timeZone);
  const currentSeconds = hour * 3600 + minute * 60 + second;
  const cutoffSeconds = cutoffHour * 3600;
  const diffSeconds = currentSeconds < cutoffSeconds
    ? cutoffSeconds - currentSeconds
    : (86400 - currentSeconds) + cutoffSeconds;
  return Math.max(0, diffSeconds / 3600);
}

/**
 * Format giờ HH:mm theo múi giờ config.timezone (dùng trong Discord embed/message)
 */
export function formatTimeInTz(dateInput, timeZone = config.timezone) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return d.toLocaleTimeString('vi-VN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
}

/**
 * Format ngày giờ đầy đủ theo múi giờ config.timezone (ví dụ: '16:25:00 14/11/2026')
 */
export function formatDateTimeInTz(dateInput = new Date(), timeZone = config.timezone) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return d.toLocaleString('vi-VN', {
    timeZone,
    hour12: false
  });
}

/**
 * Chuyển timestamp về đối tượng Date có thành phần UTC trùng với giờ tường tại config.timezone
 * để ExcelJS hiển thị đúng giờ địa phương (thay vì hiển thị giờ UTC).
 */
export function toTimezoneExcelDate(dateInput, timeZone = config.timezone) {
  const { year, month, day, hour, minute, second } = getDateTimePartsInTimezone(dateInput, timeZone);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/**
 * Kiểm tra ngày dương lịch hợp lệ (chặn ngày ảo như 2026-11-31 hoặc 2026-02-29)
 */
export function isValidCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/**
 * Format Date UTC hoặc Local thành YYYY-MM-DD (giữ nguyên tương thích khi truyền Date thuần)
 */
export function formatDateIso(d) {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

/**
 * Cộng/trừ số ngày trên chuỗi YYYY-MM-DD (an toàn tuyệt đối không lệch múi giờ)
 */
export function addDaysToIso(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

/**
 * Lấy ngày đầu và cuối của 1 tháng bất kỳ { from, to } dạng YYYY-MM-DD
 */
export function getMonthRangeIso(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDay)}`
  };
}

/**
 * Phân tích thông minh chuỗi ngày do người dùng nhập tay hoặc chọn từ gợi ý:
 * - "YYYY-MM-DD" (vd: 2026-11-14)
 * - "DD/MM" hoặc "DD-MM" (vd: 14/11 -> ngày 14 tháng 11 năm hiện tại theo TZ)
 * - "DD/MM/YYYY" hoặc "DD-MM-YYYY" (vd: 14/11/2026)
 * - "DD" hoặc "D" (vd: 14 -> ngày 14 tháng hiện tại theo TZ)
 * - "YYYYMMDD" (vd: 20261114)
 * - Chuỗi dán chứa ngày YYYYMMDD / YYYY-MM-DD
 * Trả về "YYYY-MM-DD" hợp lệ hoặc null nếu không hợp lệ.
 */
export function smartParseDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;

  const { year: curYear, month: curMonth } = getDatePartsInTimezone();

  // 1. Chỉ có 1-2 chữ số -> hiểu là Ngày trong tháng hiện tại (theo TZ)
  if (/^\d{1,2}$/.test(str)) {
    const day = parseInt(str, 10);
    if (isValidCalendarDate(curYear, curMonth, day)) {
      return `${curYear}-${pad2(curMonth)}-${pad2(day)}`;
    }
    return null;
  }

  // 2. DD/MM hoặc DD-MM (năm hiện tại theo TZ)
  const dmMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (dmMatch) {
    const day = parseInt(dmMatch[1], 10);
    const month = parseInt(dmMatch[2], 10);
    if (isValidCalendarDate(curYear, month, day)) {
      return `${curYear}-${pad2(month)}-${pad2(day)}`;
    }
    return null;
  }

  // 3. DD/MM/YYYY hoặc DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    if (isValidCalendarDate(year, month, day)) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
    return null;
  }

  // 4. YYYY-MM-DD chuẩn
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    return isValidCalendarDate(year, month, day) ? str : null;
  }

  // 5. 8 chữ số liền (YYYYMMDD)
  const digits = str.replace(/\D/g, '');
  if (digits.length === 8 && (digits.startsWith('202') || digits.startsWith('203'))) {
    const year = parseInt(digits.slice(0, 4), 10);
    const month = parseInt(digits.slice(4, 6), 10);
    const day = parseInt(digits.slice(6, 8), 10);
    if (isValidCalendarDate(year, month, day)) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
    return null;
  }

  // 6. Trích ngày từ chuỗi dài (ví dụ copy từ label hoặc text)
  if (str.length > 8) {
    const yearMatch = str.match(/(20[23]\d)/);
    if (yearMatch) {
      const yearIdx = str.indexOf(yearMatch[1]);
      const cleanSub = str.slice(yearIdx).replace(/\D/g, '');
      if (cleanSub.length >= 8) {
        const year = parseInt(cleanSub.slice(0, 4), 10);
        const month = parseInt(cleanSub.slice(4, 6), 10);
        const day = parseInt(cleanSub.slice(6, 8), 10);
        if (isValidCalendarDate(year, month, day)) {
          return `${year}-${pad2(month)}-${pad2(day)}`;
        }
      }
    }
  }

  return null;
}

/**
 * Các mốc thời gian chọn nhanh dùng chung cho /report (Slash Command choices & Select Menu)
 */
export const REPORT_RANGE_PRESETS = [
  { value: 'today', label: '📌 Hôm nay / 오늘', description: 'Bảng xếp hạng chu kỳ làm việc hôm nay' },
  { value: 'yesterday', label: '⏮️ Hôm qua / 어제', description: 'Bảng xếp hạng chu kỳ ngày hôm qua' },
  { value: 'last_7_days', label: '📆 7 ngày gần nhất / 최근 7일', description: 'Tổng hợp giờ làm 7 ngày qua đến hôm nay' },
  { value: 'last_14_days', label: '📆 14 ngày gần nhất / 최근 14일', description: 'Tổng hợp giờ làm 14 ngày qua đến hôm nay' },
  { value: 'last_30_days', label: '📆 30 ngày gần nhất / 최근 30일', description: 'Tổng hợp giờ làm 30 ngày qua đến hôm nay' },
  { value: 'this_week', label: '🗓️ Tuần này (T2 → nay) / 이번 주', description: 'Tổng hợp từ Thứ 2 tuần này đến hôm nay' },
  { value: 'last_week', label: '🗓️ Tuần trước (T2 → CN) / 지난 주', description: 'Tổng hợp trọn tuần trước (Thứ 2 → Chủ Nhật)' },
  { value: 'this_month', label: '🗓️ Tháng này / 이번 달', description: 'Tổng hợp từ đầu tháng đến hôm nay' },
  { value: 'last_month', label: '🗓️ Tháng trước / 지난 달', description: 'Tổng hợp trọn tháng trước' }
];

/**
 * Quy đổi mã preset thành { from, to, isSingleDay, label } theo múi giờ & mốc cut-off
 */
export function resolveReportRangePreset(preset = 'today', now = new Date(), cutoffHour = config.cutoffHour, timeZone = config.timezone) {
  const workToday = getWorkDateIso(now, cutoffHour, timeZone);
  const [yStr, mStr] = workToday.split('-');
  const curYear = parseInt(yStr, 10);
  const curMonth = parseInt(mStr, 10);
  const weekday = new Date(`${workToday}T12:00:00Z`).getUTCDay();
  const diffToMon = weekday === 0 ? -6 : 1 - weekday;
  const startOfWeekIso = addDaysToIso(workToday, diffToMon);

  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;
  const lastMonthRange = getMonthRangeIso(prevYear, prevMonth);
  const thisMonthStart = `${curYear}-${pad2(curMonth)}-01`;

  switch (preset) {
    case 'yesterday': {
      const yest = addDaysToIso(workToday, -1);
      return { from: yest, to: yest, isSingleDay: true, label: 'Hôm qua / 어제' };
    }
    case 'last_7_days':
      return { from: addDaysToIso(workToday, -6), to: workToday, isSingleDay: false, label: '7 ngày gần nhất / 최근 7일' };
    case 'last_14_days':
      return { from: addDaysToIso(workToday, -13), to: workToday, isSingleDay: false, label: '14 ngày gần nhất / 최근 14일' };
    case 'last_30_days':
      return { from: addDaysToIso(workToday, -29), to: workToday, isSingleDay: false, label: '30 ngày gần nhất / 최근 30일' };
    case 'this_week':
      return { from: startOfWeekIso, to: workToday, isSingleDay: startOfWeekIso === workToday, label: 'Tuần này / 이번 주' };
    case 'last_week': {
      const lastWeekStart = addDaysToIso(startOfWeekIso, -7);
      const lastWeekEnd = addDaysToIso(startOfWeekIso, -1);
      return { from: lastWeekStart, to: lastWeekEnd, isSingleDay: false, label: 'Tuần trước / 지난 주' };
    }
    case 'this_month':
      return { from: thisMonthStart, to: workToday, isSingleDay: thisMonthStart === workToday, label: 'Tháng này / 이번 달' };
    case 'last_month':
      return { from: lastMonthRange.from, to: lastMonthRange.to, isSingleDay: false, label: 'Tháng trước / 지난 달' };
    case 'today':
    default:
      return { from: workToday, to: workToday, isSingleDay: true, label: 'Hôm nay / 오늘' };
  }
}

/**
 * Tạo danh sách gợi ý Autocomplete ngày cho Slash Commands (/export, /report, /check-user)
 */
export function buildDateAutocompleteChoices(focusedValue = '', { includeRangeShortcuts = false } = {}) {
  const query = String(focusedValue || '').trim().toLowerCase();
  const now = new Date();
  const { year: curYear, month: curMonth, weekday } = getDatePartsInTimezone(now);
  const todayIso = getTodayIso(now);
  const yesterdayIso = addDaysToIso(todayIso, -1);

  const choices = [];
  const seenValues = new Set();

  const pushChoice = (name, value) => {
    if (!value || seenValues.has(value)) return;
    seenValues.add(value);
    choices.push({ name: name.slice(0, 100), value });
  };

  // A. Khi user đang gõ số / ngày cụ thể -> ưu tiên gợi ý chính xác ngày user gõ trước
  const typedDigits = query.replace(/\D/g, '');
  if (query.length > 0) {
    const parsedDirect = smartParseDate(query);
    if (parsedDirect) {
      pushChoice(`📅 Chọn ngày: ${parsedDirect}`, parsedDirect);
    }

    // Nếu user gõ 1-2 chữ số -> gợi ý ngày này ở tháng hiện tại và tháng trước (chỉ nếu hợp lệ!)
    if (/^\d{1,2}$/.test(query)) {
      const dNum = parseInt(query, 10);
      if (isValidCalendarDate(curYear, curMonth, dNum)) {
        const iso = `${curYear}-${pad2(curMonth)}-${pad2(dNum)}`;
        pushChoice(`📅 Ngày ${pad2(dNum)}/${pad2(curMonth)}/${curYear} (${iso})`, iso);
      }
      const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
      const prevYear = curMonth === 1 ? curYear - 1 : curYear;
      if (isValidCalendarDate(prevYear, prevMonth, dNum)) {
        const isoPrev = `${prevYear}-${pad2(prevMonth)}-${pad2(dNum)}`;
        pushChoice(`📅 Ngày ${pad2(dNum)}/${pad2(prevMonth)}/${prevYear} (${isoPrev})`, isoPrev);
      }
    }
  }

  // B. Danh sách mốc nhanh chuẩn (theo múi giờ Asia/Ho_Chi_Minh)
  const diffToMon = weekday === 0 ? -6 : 1 - weekday;
  const startOfWeekIso = addDaysToIso(todayIso, diffToMon);
  const { from: thisMonthStart, to: thisMonthEnd } = getMonthRangeIso(curYear, curMonth);
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;
  const { from: lastMonthStart, to: lastMonthEnd } = getMonthRangeIso(prevYear, prevMonth);

  const presets = [
    { name: `📌 Hôm nay / 오늘 (${todayIso})`, value: todayIso },
    { name: `⏮️ Hôm qua / 어제 (${yesterdayIso})`, value: yesterdayIso }
  ];

  // Thêm 5 ngày gần nhất (Hôm kia..6 ngày trước) để tiện chọn 1 click cho /report & /check-user
  for (let offset = 2; offset <= 6; offset++) {
    const iso = addDaysToIso(todayIso, -offset);
    const [yy, mm, dd] = iso.split('-');
    presets.push({ name: `📅 ${dd}/${mm}/${yy} (${offset} ngày trước) [${iso}]`, value: iso });
  }

  if (includeRangeShortcuts) {
    presets.push(
      { name: `📅 Đầu tuần này - Thứ 2 (${startOfWeekIso})`, value: startOfWeekIso },
      { name: `📆 Đầu tháng ${pad2(curMonth)}/${curYear} (${thisMonthStart})`, value: thisMonthStart },
      { name: `📆 Cuối tháng ${pad2(curMonth)}/${curYear} (${thisMonthEnd})`, value: thisMonthEnd },
      { name: `⏮️ Đầu tháng trước ${pad2(prevMonth)}/${prevYear} (${lastMonthStart})`, value: lastMonthStart },
      { name: `⏮️ Cuối tháng trước ${pad2(prevMonth)}/${prevYear} (${lastMonthEnd})`, value: lastMonthEnd },
      { name: `📊 7 ngày gần nhất từ (${addDaysToIso(todayIso, -6)})`, value: addDaysToIso(todayIso, -6) },
      { name: `📊 30 ngày gần nhất từ (${addDaysToIso(todayIso, -29)})`, value: addDaysToIso(todayIso, -29) }
    );
  }

  for (const item of presets) {
    if (
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.value.includes(query) ||
      (typedDigits.length >= 2 && item.value.replace(/\D/g, '').includes(typedDigits))
    ) {
      pushChoice(item.name, item.value);
    }
  }

  // C. Nếu chưa đủ 25 gợi ý và user chưa gõ lọc -> điền tiếp các ngày gần nhất để bấm chọn 1 chạm
  if (choices.length < 25 && !query) {
    for (let offset = 7; offset <= 26 && choices.length < 25; offset++) {
      const iso = addDaysToIso(todayIso, -offset);
      const [yy, mm, dd] = iso.split('-');
      pushChoice(`📅 ${dd}/${mm}/${yy} (${offset} ngày trước) [${iso}]`, iso);
    }
  }

  return choices.slice(0, 25);
}
