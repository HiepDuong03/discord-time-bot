import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../database/db.js';
import { toTimezoneExcelDate, formatDateTimeInTz } from '../utils/dateUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const exportsDir = path.resolve(__dirname, '../../exports');
if (!fs.existsSync(exportsDir)) {
  fs.mkdirSync(exportsDir, { recursive: true });
}

// ── Bảng màu chuẩn báo cáo: 1 màu chủ đạo + xám trung tính ─────────────
const NAVY = 'FF1F2A44';
const INK = 'FF1F2937';
const MUTED = 'FF6B7280';
const BAND = 'FFF3F4F6';
const LINE = 'FFD1D5DB';
const TOTAL = 'FFE5E7EB';
const FONT = 'Arial';

const S_OV = 'Tổng quan 요약';
const S_DAY = 'Theo ngày 일별';
const S_DET = 'Chi tiết ca 상세';

const Q_OV = `'${S_OV}'`;
const Q_DAY = `'${S_DAY}'`;
const Q_DET = `'${S_DET}'`;

const thinBorder = {
  bottom: { style: 'thin', color: { argb: LINE } }
};
const totalBorder = {
  top: { style: 'medium', color: { argb: NAVY } }
};

function f(bold = false, size = 10, color = INK) {
  return { name: FONT, bold, size, color: { argb: color } };
}

function headerRow(ws, rowNum, labels, firstCol = 1) {
  const row = ws.getRow(rowNum);
  labels.forEach((text, i) => {
    const cell = row.getCell(firstCol + i);
    cell.value = text;
    cell.font = f(true, 10, 'FFFFFFFF');
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  row.height = 32;
}

function bodyRow(ws, rowNum, ncols, isBand, numFormats = {}, firstCol = 1) {
  const row = ws.getRow(rowNum);
  for (let i = 0; i < ncols; i++) {
    const col = firstCol + i;
    const cell = row.getCell(col);
    if (!cell.font) cell.font = f();
    cell.border = thinBorder;
    if (isBand) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    }
    if (numFormats[col]) {
      cell.numFmt = numFormats[col];
    }
  }
  row.height = 20;
}

function totalRow(ws, rowNum, ncols) {
  const row = ws.getRow(rowNum);
  for (let col = 1; col <= ncols; col++) {
    const cell = row.getCell(col);
    cell.font = f(true);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL } };
    cell.border = totalBorder;
  }
  row.height = 22;
}

function setColumnWidths(ws, widths) {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

const MAX_SHIFT_HOURS = 14;

/**
 * Tính số giờ của 1 bản ghi ca làm (dùng thống nhất cho summarizeShifts, cached formula result & Excel)
 */
function resolveShiftHours(shift) {
  if (shift.status === 'ADJUSTED') {
    return Number((Number(shift.durationMinutes || 0) / 60).toFixed(2));
  }
  if (!shift.checkOutDate) return null;
  const rawHours = (shift.checkOutDate.getTime() - shift.checkInDate.getTime()) / (1000 * 3600);
  return Number(Math.min(MAX_SHIFT_HOURS, rawHours).toFixed(2));
}

/**
 * Tính nhanh các chỉ số cho embed (cùng logic với công thức trong Excel: tách bạch KPI Nhân sự và SLA Nick)
 */
export function summarizeShifts(shifts, slaHours = 8) {
  const staffDays = {};
  const nickDays = {};
  let totalHours = 0;
  const staffSet = new Set();
  const nickSet = new Set();

  shifts.forEach(s => {
    staffSet.add(s.staff);
    nickSet.add(s.nick);
    const h = typeof s.hours === 'number' ? s.hours : resolveShiftHours(s);
    if (h === null) return;
    totalHours += h;

    const sk = `${s.work_date}|${s.staff}`;
    if (!staffDays[sk]) {
      staffDays[sk] = {
        date: s.work_date,
        staff: s.staff,
        hours: 0,
        targetHours: Number(s.staffTargetHours ?? slaHours),
        nicks: new Set()
      };
    }
    staffDays[sk].hours += h;
    staffDays[sk].nicks.add(s.nick);

    const nk = `${s.work_date}|${s.nick}`;
    if (!nickDays[nk]) {
      nickDays[nk] = {
        date: s.work_date,
        nick: s.nick,
        hours: 0,
        targetHours: Number(s.nickTargetHours ?? slaHours),
        staffs: new Set()
      };
    }
    nickDays[nk].hours += h;
    nickDays[nk].staffs.add(s.staff);
  });

  const staffDayList = Object.values(staffDays);
  let staffPassedCount = 0;
  const staffDeficits = [];
  staffDayList.forEach(item => {
    const roundedH = Number(item.hours.toFixed(2));
    if (roundedH >= item.targetHours) {
      staffPassedCount++;
    } else {
      staffDeficits.push({
        date: item.date,
        staff: item.staff,
        nick: Array.from(item.nicks).join(', '),
        hours: roundedH,
        targetHours: item.targetHours
      });
    }
  });

  const nickDayList = Object.values(nickDays);
  let passedCount = 0;
  const deficits = [];
  nickDayList.forEach(item => {
    const roundedH = Number(item.hours.toFixed(2));
    if (roundedH >= item.targetHours) {
      passedCount++;
    } else {
      deficits.push({
        date: item.date,
        nick: item.nick,
        staff: Array.from(item.staffs).join(', '),
        hours: roundedH,
        targetHours: item.targetHours
      });
    }
  });

  const totalDaySlots = nickDayList.length;
  const totalStaffDaySlots = staffDayList.length;

  return {
    totalHours: Number(totalHours.toFixed(2)),
    staffCount: staffSet.size,
    nickCount: nickSet.size,
    daysCount: totalDaySlots,
    passedCount,
    slaRate: totalDaySlots > 0 ? (passedCount / totalDaySlots) : 0,
    deficits: deficits.sort((a, b) => a.date.localeCompare(b.date)),
    staffDaysCount: totalStaffDaySlots,
    staffPassedCount,
    staffSlaRate: totalStaffDaySlots > 0 ? (staffPassedCount / totalStaffDaySlots) : 0,
    staffDeficits: staffDeficits.sort((a, b) => a.date.localeCompare(b.date))
  };
}

/**
 * Xuất file Excel 3 Sheet chuẩn kiểm toán (hỗ trợ KPI cá nhân 4h/6h/8h và SLA từng Nick)
 */
export async function exportTimesheetToExcel(fromDate, toDate, slaHours = 8) {
  const rawShiftsRes = await db.execute({
    sql: `SELECT s.id, 
           COALESCE(u.display_name, s.user_id) as display_name, 
           s.user_id as discord_id, 
           COALESCE(u.daily_target_hours, ?) as staff_target_hours,
           COALESCE(s.account_code, 'DEFAULT_ACC') as account_code, 
           COALESCE(a.daily_target_hours, ?) as nick_target_hours,
           s.work_date, 
           s.check_in, 
           s.check_out, 
           s.duration_minutes, 
           s.status, 
           s.note
    FROM shifts s
    LEFT JOIN users u ON s.user_id = u.discord_id
    LEFT JOIN accounts a ON COALESCE(s.account_code, 'DEFAULT_ACC') = a.account_code
    WHERE s.work_date >= ? AND s.work_date <= ?
    ORDER BY s.check_in ASC`,
    args: [slaHours, slaHours, fromDate, toDate]
  });
  const rawShifts = rawShiftsRes.rows;

  // Phân biệt tên nếu 2 discord_id khác nhau vô tình đặt trùng display_name
  const nameToIds = new Map();
  for (const r of rawShifts) {
    const baseName = r.display_name || r.discord_id;
    if (!nameToIds.has(baseName)) nameToIds.set(baseName, new Set());
    nameToIds.get(baseName).add(String(r.discord_id));
  }

  const shifts = rawShifts.map(s => {
    const baseName = s.display_name || s.discord_id;
    const isDupName = (nameToIds.get(baseName)?.size || 0) > 1;
    const staffLabel = isDupName ? `${baseName} (${String(s.discord_id).slice(-4)})` : baseName;
    const mapped = {
      id: 'S' + String(s.id).padStart(4, '0'),
      staff: staffLabel,
      discord_id: s.discord_id,
      staffTargetHours: Number(s.staff_target_hours || slaHours),
      nick: s.account_code,
      nickTargetHours: Number(s.nick_target_hours || slaHours),
      work_date: s.work_date,
      status: s.status || 'COMPLETED',
      durationMinutes: Number(s.duration_minutes || 0),
      checkInRawDate: new Date(s.check_in),
      checkInDate: toTimezoneExcelDate(s.check_in),
      checkOutDate: s.check_out ? toTimezoneExcelDate(s.check_out) : null,
      workDateObj: new Date(s.work_date + 'T00:00:00.000Z'),
      note: s.note || ''
    };
    mapped.hours = resolveShiftHours(mapped);
    return mapped;
  }).sort((a, b) => a.checkInRawDate - b.checkInRawDate);

  const summary = summarizeShifts(shifts, slaHours);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AURA Time Tracker';
  workbook.created = new Date();

  const ov = workbook.addWorksheet(S_OV, { views: [{ showGridLines: false }] });
  const day = workbook.addWorksheet(S_DAY, { views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }] });
  const det = workbook.addWorksheet(S_DET, { views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }] });

  // Danh sách Nhân sự & Nick để định vị dòng trên Sheet 1 trước
  const staffMap = new Map();
  const nickMap = new Map();
  shifts.forEach(s => {
    if (!staffMap.has(s.staff)) {
      staffMap.set(s.staff, { name: s.staff, did: s.discord_id, targetHours: s.staffTargetHours });
    }
    if (!nickMap.has(s.nick)) {
      nickMap.set(s.nick, { code: s.nick, targetHours: s.nickTargetHours });
    }
  });
  const staffList = Array.from(staffMap.values());
  const nickList = Array.from(nickMap.values());

  const r_staff_hdr = 9;
  const r_staff0 = r_staff_hdr + 1;
  const r_staff_tot = r_staff0 + Math.max(staffList.length, 1);
  const r_nick_hdr = r_staff_tot + 3;
  const r_nick0 = r_nick_hdr + 1;
  const r_nick_tot = r_nick0 + Math.max(nickList.length, 1);

  const staffRowMap = new Map();
  staffList.forEach((st, i) => staffRowMap.set(st.name, r_staff0 + i));
  const nickRowMap = new Map();
  nickList.forEach((nk, i) => nickRowMap.set(nk.code, r_nick0 + i));

  // ───────── Sheet 3: Chi tiết ca (dữ liệu gốc) ─────────
  headerRow(det, 1, [
    "Mã ca\n근무 ID", "Ngày\n일자", "Nhân sự\n근무자", "Nick\n계정",
    "Giờ vào\n출근", "Giờ ra\n퇴근", "Thời lượng (h)\n근무 시간",
    "Trạng thái\n상태", "Ghi chú\n비고"
  ]);

  shifts.forEach((s, i) => {
    const r = i + 2;
    const row = det.getRow(r);
    row.getCell(1).value = s.id;
    row.getCell(2).value = s.workDateObj;
    row.getCell(3).value = s.staff;
    row.getCell(4).value = s.nick;
    row.getCell(5).value = s.checkInDate;
    if (s.checkOutDate) {
      row.getCell(6).value = s.checkOutDate;
    }

    if (s.status === 'ADJUSTED') {
      row.getCell(7).value = s.hours;
      row.getCell(8).value = 'Điều chỉnh 조정';
    } else {
      const durationHours = s.hours;
      const statusStr = s.checkOutDate ? 'Hoàn tất 완료' : 'Đang chạy 진행 중';
      row.getCell(7).value = durationHours !== null
        ? { formula: `IF(F${r}="","",MIN(${MAX_SHIFT_HOURS},ROUND((F${r}-E${r})*24,2)))`, result: durationHours }
        : '';
      row.getCell(8).value = {
        formula: `IF(F${r}="","Đang chạy 진행 중","Hoàn tất 완료")`,
        result: statusStr
      };
    }
    row.getCell(9).value = s.note;

    bodyRow(det, r, 9, i % 2 === 1, {
      2: 'yyyy-mm-dd',
      5: 'hh:mm',
      6: 'hh:mm',
      7: '0.00'
    });

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'center' };
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(7).alignment = { horizontal: 'right' };
    row.getCell(8).alignment = { horizontal: 'center' };
  });

  const n_det = shifts.length + 1;
  const lastDetRow = Math.max(n_det, 2);
  setColumnWidths(det, [11, 12, 22, 22, 10, 10, 16, 18, 30]);
  det.autoFilter = `A1:I${lastDetRow}`;

  // ───────── Sheet 2: Theo ngày (Bảng trái A..G = Nhân sự theo ngày, Bảng phải I..O = Nick theo ngày) ─────────
  const closedShifts = shifts.filter(s => typeof s.hours === 'number');

  const staffDayMap = new Map();
  const nickDayMap = new Map();
  closedShifts.forEach(s => {
    const sk = `${s.work_date}|${s.staff}`;
    if (!staffDayMap.has(sk)) {
      staffDayMap.set(sk, {
        dateStr: s.work_date,
        dateObj: s.workDateObj,
        staff: s.staff,
        targetHours: s.staffTargetHours,
        nicks: new Set(),
        countShifts: 0,
        totalHours: 0
      });
    }
    const sEntry = staffDayMap.get(sk);
    sEntry.nicks.add(s.nick);
    sEntry.countShifts++;
    sEntry.totalHours = Number((sEntry.totalHours + s.hours).toFixed(2));

    const nk = `${s.work_date}|${s.nick}`;
    if (!nickDayMap.has(nk)) {
      nickDayMap.set(nk, {
        dateStr: s.work_date,
        dateObj: s.workDateObj,
        nick: s.nick,
        targetHours: s.nickTargetHours,
        staffs: new Set(),
        countShifts: 0,
        totalHours: 0
      });
    }
    const nEntry = nickDayMap.get(nk);
    nEntry.staffs.add(s.staff);
    nEntry.countShifts++;
    nEntry.totalHours = Number((nEntry.totalHours + s.hours).toFixed(2));
  });

  const staffDayRows = Array.from(staffDayMap.values());
  const nickDayRows = Array.from(nickDayMap.values());

  day.getCell('A1').value = '1. CÔNG NHÂN SỰ THEO NGÀY  ·  일별 근무자 실적';
  day.getCell('A1').font = f(true, 11, NAVY);
  day.getCell('I1').value = '2. SLA NICK GAME THEO NGÀY  ·  일별 계정 SLA';
  day.getCell('I1').font = f(true, 11, NAVY);
  day.getRow(1).height = 24;

  headerRow(day, 2, [
    "Ngày\n일자", "Nhân sự\n근무자", "Nick đã cày\n작업 계정", "Số ca\n근무 횟수",
    "Tổng giờ\n총 근무(h)", "KPI/ngày (h)\n개인 목표", "Kết quả\n결과"
  ], 1);

  headerRow(day, 2, [
    "Ngày\n일자", "Mã nick\n계정 코드", "Người cày\n담당자", "Số ca\n근무 횟수",
    "Tổng giờ\n총 작업(h)", "SLA/ngày (h)\n계정 기준", "Kết quả\n결과"
  ], 9);

  staffDayRows.forEach((k, i) => {
    const r = i + 3;
    const row = day.getRow(r);
    const isDayAchieved = k.totalHours >= k.targetHours;
    const dayResultStr = isDayAchieved ? "Đạt 달성" : "Thiếu 미달";
    const staffOvRow = staffRowMap.get(k.staff) || r_staff0;

    row.getCell(1).value = k.dateObj;
    row.getCell(2).value = k.staff;
    row.getCell(3).value = Array.from(k.nicks).join(', ');
    row.getCell(4).value = {
      formula: `COUNTIFS(${Q_DET}!$B$2:$B$${lastDetRow},A${r},${Q_DET}!$C$2:$C$${lastDetRow},B${r})`,
      result: k.countShifts
    };
    row.getCell(5).value = {
      formula: `SUMIFS(${Q_DET}!$G$2:$G$${lastDetRow},${Q_DET}!$B$2:$B$${lastDetRow},A${r},${Q_DET}!$C$2:$C$${lastDetRow},B${r})`,
      result: k.totalHours
    };
    row.getCell(6).value = {
      formula: `${Q_OV}!$C$${staffOvRow}`,
      result: k.targetHours
    };
    row.getCell(7).value = {
      formula: `IF(E${r}>=F${r},"Đạt 달성","Thiếu 미달")`,
      result: dayResultStr
    };

    bodyRow(day, r, 7, i % 2 === 1, {
      1: 'yyyy-mm-dd',
      5: '0.00',
      6: '0.0'
    }, 1);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'right' };
    row.getCell(6).alignment = { horizontal: 'right' };
    row.getCell(7).alignment = { horizontal: 'center' };
  });

  nickDayRows.forEach((k, i) => {
    const r = i + 3;
    const row = day.getRow(r);
    const isDayAchieved = k.totalHours >= k.targetHours;
    const dayResultStr = isDayAchieved ? "Đạt 달성" : "Thiếu 미달";
    const nickOvRow = nickRowMap.get(k.nick) || r_nick0;

    row.getCell(9).value = k.dateObj;
    row.getCell(10).value = k.nick;
    row.getCell(11).value = Array.from(k.staffs).join(', ');
    row.getCell(12).value = {
      formula: `COUNTIFS(${Q_DET}!$B$2:$B$${lastDetRow},I${r},${Q_DET}!$D$2:$D$${lastDetRow},J${r})`,
      result: k.countShifts
    };
    row.getCell(13).value = {
      formula: `SUMIFS(${Q_DET}!$G$2:$G$${lastDetRow},${Q_DET}!$B$2:$B$${lastDetRow},I${r},${Q_DET}!$D$2:$D$${lastDetRow},J${r})`,
      result: k.totalHours
    };
    row.getCell(14).value = {
      formula: `${Q_OV}!$C$${nickOvRow}`,
      result: k.targetHours
    };
    row.getCell(15).value = {
      formula: `IF(M${r}>=N${r},"Đạt 달성","Thiếu 미달")`,
      result: dayResultStr
    };

    bodyRow(day, r, 7, i % 2 === 1, {
      9: 'yyyy-mm-dd',
      13: '0.00',
      14: '0.0'
    }, 9);

    row.getCell(9).alignment = { horizontal: 'center' };
    row.getCell(12).alignment = { horizontal: 'center' };
    row.getCell(13).alignment = { horizontal: 'right' };
    row.getCell(14).alignment = { horizontal: 'right' };
    row.getCell(15).alignment = { horizontal: 'center' };
  });

  const lastStaffDayRow = Math.max(staffDayRows.length + 2, 3);
  const lastNickDayRow = Math.max(nickDayRows.length + 2, 3);
  setColumnWidths(day, [12, 20, 22, 10, 14, 14, 14, 4, 12, 22, 22, 10, 14, 14, 14]);

  // ───────── Sheet 1: Tổng quan ─────────
  setColumnWidths(ov, [6, 24, 16, 15, 15, 15, 15, 16]);

  ov.getCell('A1').value = 'BÁO CÁO GIỜ LÀM & SLA  ·  근무 시간 및 SLA 보고서';
  ov.getCell('A1').font = f(true, 16, NAVY);
  ov.getRow(1).height = 28;

  ov.getCell('A2').value = 'Kỳ báo cáo 기간';
  ov.getCell('A2').font = f(false, 9, MUTED);
  ov.getCell('C2').value = `${fromDate}  →  ${toDate}`;
  ov.getCell('C2').font = f(true, 10);
  const exportedAtStr = formatDateTimeInTz(new Date());
  ov.getCell('D2').value = `Xuất lúc 생성: ${exportedAtStr}`;
  ov.getCell('D2').font = f(false, 9, MUTED);

  ov.getCell('A3').value = 'Chuẩn SLA mặc định 기준 (h)';
  ov.getCell('A3').font = f(false, 9, MUTED);
  ov.getCell('C3').value = slaHours;
  ov.getCell('C3').font = { name: FONT, bold: true, size: 10, color: { argb: 'FF0000FF' } };
  ov.getCell('C3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
  ov.getCell('C3').alignment = { horizontal: 'left' };
  ov.getCell('D3').value = '← có thể chỉnh trực tiếp cột KPI/ngày của từng người hoặc từng nick bên dưới';
  ov.getCell('D3').font = f(false, 9, MUTED);

  // KPI Cards (hàng 5-6)
  ov.getRow(5).height = 30;
  ov.getRow(6).height = 34;

  const kpis = [
    { col: 'B', label: 'Tổng giờ làm\n총 근무 시간', formula: `SUM(${Q_DET}!$G$2:$G$${lastDetRow})`, result: summary.totalHours, fmt: '0.0" h"' },
    { col: 'C', label: 'Nhân sự / Nick\n근무자 / 계정', formula: `COUNTA(B${r_staff0}:B${r_staff_tot - 1})`, result: staffList.length, fmt: '0" người"' },
    { col: 'D', label: 'Đạt KPI Nhân sự\n근무자 목표 달성률', formula: `IF(E${r_staff_tot}=0,0,F${r_staff_tot}/E${r_staff_tot})`, result: summary.staffSlaRate, fmt: '0.0%' },
    { col: 'E', label: 'Đạt SLA Nick Game\n계정 SLA 달성률', formula: `IF(E${r_nick_tot}=0,0,F${r_nick_tot}/E${r_nick_tot})`, result: summary.slaRate, fmt: '0.0%' }
  ];

  kpis.forEach(({ col, label, formula, result, fmt }) => {
    const lblCell = ov.getCell(`${col}5`);
    const valCell = ov.getCell(`${col}6`);
    lblCell.value = label;
    valCell.value = { formula, result };
    lblCell.font = f(false, 9, MUTED);
    valCell.font = f(true, 18, NAVY);
    lblCell.alignment = { horizontal: 'left', vertical: 'bottom', wrapText: true };
    valCell.alignment = { horizontal: 'left', vertical: 'center' };
    valCell.numFmt = fmt;
    lblCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
  });

  function sectionTitle(rowNum, text) {
    const cell = ov.getCell(`A${rowNum}`);
    cell.value = text;
    cell.font = f(true, 11, NAVY);
    ov.getRow(rowNum).height = 22;
  }

  // 1. Bảng nhân sự (bỏ cột Discord ID gây rối, thay bằng cột KPI/ngày cá nhân)
  sectionTitle(r_staff_hdr - 1, '1. NHÂN SỰ  근무자 (Tính theo KPI cá nhân 4h / 6h / 8h)');
  headerRow(ov, r_staff_hdr, [
    "#", "Nhân sự\n근무자", "KPI/ngày (h)\n일일 목표", "Tổng giờ\n총 근무(h)",
    "Số ngày làm\n출근 일수", "Ngày đạt\n달성", "Ngày thiếu\n미달", "Tỉ lệ đạt\n달성률"
  ]);

  let sumStaffHours = 0;
  let sumStaffDays = 0;
  let sumStaffPassed = 0;
  let sumStaffDeficits = 0;

  if (staffList.length === 0) {
    const row = ov.getRow(r_staff0);
    row.getCell(2).value = 'Chưa có dữ liệu';
    bodyRow(ov, r_staff0, 8, false);
  } else {
    staffList.forEach((st, i) => {
      const r = r_staff0 + i;
      const row = ov.getRow(r);

      const stDaysList = staffDayRows.filter(k => k.staff === st.name);
      let stHours = 0;
      let stPassed = 0;
      stDaysList.forEach(k => {
        stHours += k.totalHours;
        if (k.totalHours >= st.targetHours) stPassed++;
      });
      stHours = Number(stHours.toFixed(2));
      const stDays = stDaysList.length;
      const stDeficit = stDays - stPassed;
      const stRate = stDays > 0 ? (stPassed / stDays) : 0;

      sumStaffHours += stHours;
      sumStaffDays += stDays;
      sumStaffPassed += stPassed;
      sumStaffDeficits += stDeficit;

      row.getCell(1).value = i + 1;
      row.getCell(2).value = st.name;
      row.getCell(3).value = st.targetHours;
      row.getCell(4).value = {
        formula: `SUMIFS(${Q_DET}!$G$2:$G$${lastDetRow},${Q_DET}!$C$2:$C$${lastDetRow},B${r})`,
        result: stHours
      };
      row.getCell(5).value = {
        formula: `COUNTIFS(${Q_DAY}!$B$3:$B$${lastStaffDayRow},B${r})`,
        result: stDays
      };
      row.getCell(6).value = {
        formula: `COUNTIFS(${Q_DAY}!$B$3:$B$${lastStaffDayRow},B${r},${Q_DAY}!$G$3:$G$${lastStaffDayRow},"Đạt 달성")`,
        result: stPassed
      };
      row.getCell(7).value = {
        formula: `E${r}-F${r}`,
        result: stDeficit
      };
      row.getCell(8).value = {
        formula: `IF(E${r}=0,0,F${r}/E${r})`,
        result: stRate
      };

      bodyRow(ov, r, 8, i % 2 === 1, {
        3: '0.0',
        4: '0.00',
        8: '0%'
      });
      row.getCell(3).font = { name: FONT, bold: true, size: 10, color: { argb: 'FF1D4ED8' } };

      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(3).alignment = { horizontal: 'right' };
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(6).alignment = { horizontal: 'right' };
      row.getCell(7).alignment = { horizontal: 'right' };
      row.getCell(8).alignment = { horizontal: 'right' };
    });
  }

  const tStaff = r_staff_tot;
  const rowStaffTot = ov.getRow(tStaff);
  const totStaffRate = sumStaffDays > 0 ? (sumStaffPassed / sumStaffDays) : 0;

  rowStaffTot.getCell(2).value = 'Tổng cộng 합계';
  rowStaffTot.getCell(4).value = { formula: `SUM(D${r_staff0}:D${tStaff - 1})`, result: Number(sumStaffHours.toFixed(2)) };
  rowStaffTot.getCell(5).value = { formula: `SUM(E${r_staff0}:E${tStaff - 1})`, result: sumStaffDays };
  rowStaffTot.getCell(6).value = { formula: `SUM(F${r_staff0}:F${tStaff - 1})`, result: sumStaffPassed };
  rowStaffTot.getCell(7).value = { formula: `SUM(G${r_staff0}:G${tStaff - 1})`, result: sumStaffDeficits };
  rowStaffTot.getCell(8).value = { formula: `IF(E${tStaff}=0,0,F${tStaff}/E${tStaff})`, result: totStaffRate };
  totalRow(ov, tStaff, 8);
  rowStaffTot.getCell(4).numFmt = '0.00';
  rowStaffTot.getCell(8).numFmt = '0%';
  [4, 5, 6, 7, 8].forEach(c => {
    rowStaffTot.getCell(c).alignment = { horizontal: 'right' };
  });

  // 2. Bảng nick
  sectionTitle(r_nick_hdr - 1, '2. NICK GAME  계정 (Cộng gộp tổng giờ các ca trong ngày trên từng Nick)');
  headerRow(ov, r_nick_hdr, [
    "#", "Mã nick\n계정 코드", "SLA/ngày (h)\n일일 기준", "Tổng giờ\n총 작업(h)",
    "Số ngày cày\n작업 일수", "Ngày đạt\n달성", "Ngày thiếu\n미달", "Tỉ lệ đạt SLA\n달성률"
  ]);

  let sumNickHours = 0;
  let sumNickDays = 0;
  let sumNickPassed = 0;
  let sumNickDeficits = 0;

  if (nickList.length === 0) {
    const row = ov.getRow(r_nick0);
    row.getCell(2).value = 'Chưa có dữ liệu';
    bodyRow(ov, r_nick0, 8, false);
  } else {
    nickList.forEach((nk, i) => {
      const r = r_nick0 + i;
      const row = ov.getRow(r);

      const nkDaysList = nickDayRows.filter(k => k.nick === nk.code);
      let nickHours = 0;
      let nickPassed = 0;
      nkDaysList.forEach(k => {
        nickHours += k.totalHours;
        if (k.totalHours >= nk.targetHours) nickPassed++;
      });
      nickHours = Number(nickHours.toFixed(2));
      const nickDays = nkDaysList.length;
      const nickDeficit = nickDays - nickPassed;
      const nickRate = nickDays > 0 ? (nickPassed / nickDays) : 0;

      sumNickHours += nickHours;
      sumNickDays += nickDays;
      sumNickPassed += nickPassed;
      sumNickDeficits += nickDeficit;

      row.getCell(1).value = i + 1;
      row.getCell(2).value = nk.code;
      row.getCell(3).value = nk.targetHours;
      row.getCell(4).value = {
        formula: `SUMIFS(${Q_DET}!$G$2:$G$${lastDetRow},${Q_DET}!$D$2:$D$${lastDetRow},B${r})`,
        result: nickHours
      };
      row.getCell(5).value = {
        formula: `COUNTIFS(${Q_DAY}!$J$3:$J$${lastNickDayRow},B${r})`,
        result: nickDays
      };
      row.getCell(6).value = {
        formula: `COUNTIFS(${Q_DAY}!$J$3:$J$${lastNickDayRow},B${r},${Q_DAY}!$O$3:$O$${lastNickDayRow},"Đạt 달성")`,
        result: nickPassed
      };
      row.getCell(7).value = {
        formula: `E${r}-F${r}`,
        result: nickDeficit
      };
      row.getCell(8).value = {
        formula: `IF(E${r}=0,0,F${r}/E${r})`,
        result: nickRate
      };

      bodyRow(ov, r, 8, i % 2 === 1, {
        3: '0.0',
        4: '0.00',
        8: '0%'
      });
      row.getCell(3).font = { name: FONT, bold: true, size: 10, color: { argb: 'FF1D4ED8' } };

      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(3).alignment = { horizontal: 'right' };
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(6).alignment = { horizontal: 'right' };
      row.getCell(7).alignment = { horizontal: 'right' };
      row.getCell(8).alignment = { horizontal: 'right' };
    });
  }

  const tNick = r_nick_tot;
  const rowNickTot = ov.getRow(tNick);
  const totNickRate = sumNickDays > 0 ? (sumNickPassed / sumNickDays) : 0;

  rowNickTot.getCell(2).value = 'Tổng cộng 합계';
  rowNickTot.getCell(4).value = { formula: `SUM(D${r_nick0}:D${tNick - 1})`, result: Number(sumNickHours.toFixed(2)) };
  rowNickTot.getCell(5).value = { formula: `SUM(E${r_nick0}:E${tNick - 1})`, result: sumNickDays };
  rowNickTot.getCell(6).value = { formula: `SUM(F${r_nick0}:F${tNick - 1})`, result: sumNickPassed };
  rowNickTot.getCell(7).value = { formula: `SUM(G${r_nick0}:G${tNick - 1})`, result: sumNickDeficits };
  rowNickTot.getCell(8).value = { formula: `IF(E${tNick}=0,0,F${tNick}/E${tNick})`, result: totNickRate };
  totalRow(ov, tNick, 8);
  rowNickTot.getCell(4).numFmt = '0.00';
  rowNickTot.getCell(8).numFmt = '0%';
  [4, 5, 6, 7, 8].forEach(c => {
    rowNickTot.getCell(c).alignment = { horizontal: 'right' };
  });

  // Ghi chú cách tính (cuối trang)
  const note_r = r_nick_tot + 2;
  const notes = [
    "Ghi chú 비고:",
    "• Bảng 1 (Nhân sự): Ngày đạt = tổng giờ của nhân sự trong ngày ≥ KPI/ngày riêng (cột C). 달성 = 일일 개인 근무 ≥ 개인 목표.",
    "• Bảng 2 (Nick Game): Ngày đạt = tổng giờ của tất cả người cày trên Nick đó trong ngày ≥ SLA/ngày của Nick. 달성 = 계정 일일 총 작업 ≥ 계정 기준.",
    "• Các ca đang chạy (chưa check-out) được liệt kê ở 'Chi tiết ca' nhưng không tính vào ngày thiếu SLA."
  ];
  notes.forEach((text, i) => {
    const cell = ov.getCell(`A${note_r + i}`);
    cell.value = text;
    cell.font = f(i === 0, 9, MUTED);
  });

  const fileName = `bang_cong_${fromDate}_den_${toDate}.xlsx`;
  const filePath = path.join(exportsDir, fileName);
  await workbook.xlsx.writeFile(filePath);

  return {
    filePath,
    fileName,
    shifts,
    summary,
    hasData: shifts.length > 0
  };
}
