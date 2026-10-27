import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../database/db.js';

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

function bodyRow(ws, rowNum, ncols, isBand, numFormats = {}) {
  const row = ws.getRow(rowNum);
  for (let col = 1; col <= ncols; col++) {
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

/**
 * Tính nhanh các chỉ số cho embed (cùng logic với công thức trong Excel)
 */
export function summarizeShifts(shifts, slaHours = 8) {
  const days = {};
  let totalHours = 0;
  const staffSet = new Set();
  const nickSet = new Set();

  shifts.forEach(s => {
    staffSet.add(s.staff);
    nickSet.add(s.nick);
    if (!s.checkOutDate) return;
    const h = (s.checkOutDate - s.checkInDate) / (1000 * 3600);
    totalHours += h;
    const k = `${s.work_date}|${s.nick}|${s.staff}`;
    days[k] = (days[k] || 0) + h;
  });

  const totalDaySlots = Object.keys(days).length;
  let passedCount = 0;
  const deficits = [];

  Object.entries(days).forEach(([k, h]) => {
    if (h >= slaHours) {
      passedCount++;
    } else {
      const [d, nick, staff] = k.split('|');
      deficits.push({ date: d, nick, staff, hours: h });
    }
  });

  return {
    totalHours: Number(totalHours.toFixed(2)),
    staffCount: staffSet.size,
    nickCount: nickSet.size,
    daysCount: totalDaySlots,
    passedCount,
    slaRate: totalDaySlots > 0 ? (passedCount / totalDaySlots) : 0,
    deficits: deficits.sort((a, b) => a.date.localeCompare(b.date))
  };
}

/**
 * Xuất file Excel 3 Sheet chuẩn kiểm toán (100% công thức động)
 */
export async function exportTimesheetToExcel(fromDate, toDate, slaHours = 8) {
  // Lấy dữ liệu ca làm từ SQLite
  const rawShifts = db.prepare(`
    SELECT s.id, 
           COALESCE(u.display_name, s.user_id) as display_name, 
           s.user_id as discord_id, 
           COALESCE(s.account_code, 'DEFAULT_ACC') as account_code, 
           s.work_date, 
           s.check_in, 
           s.check_out, 
           s.duration_minutes, 
           s.status, 
           s.note
    FROM shifts s
    LEFT JOIN users u ON s.user_id = u.discord_id
    WHERE s.work_date >= ? AND s.work_date <= ?
    ORDER BY s.check_in ASC
  `).all(fromDate, toDate);

  const shifts = rawShifts.map(s => ({
    id: 'S' + String(s.id).padStart(4, '0'),
    staff: s.display_name,
    discord_id: s.discord_id,
    nick: s.account_code,
    work_date: s.work_date,
    checkInDate: new Date(s.check_in),
    checkOutDate: s.check_out ? new Date(s.check_out) : null,
    workDateObj: new Date(s.work_date + 'T00:00:00.000Z'),
    note: s.note || ''
  })).sort((a, b) => a.checkInDate - b.checkInDate);

  const summary = summarizeShifts(shifts, slaHours);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AURA Time Tracker';
  workbook.created = new Date();

  // Khởi tạo 3 Sheet đúng thứ tự hiển thị: 1. Tổng quan, 2. Theo ngày, 3. Chi tiết ca
  const ov = workbook.addWorksheet(S_OV, { views: [{ showGridLines: false }] });
  const day = workbook.addWorksheet(S_DAY, { views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }] });
  const det = workbook.addWorksheet(S_DET, { views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }] });

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
    // Thời lượng tính bằng công thức, ca đang chạy để trống
    row.getCell(7).value = { formula: `IF(F${r}="","",ROUND((F${r}-E${r})*24,2))` };
    row.getCell(8).value = { formula: `IF(F${r}="","Đang chạy 진행 중","Hoàn tất 완료")` };
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
  setColumnWidths(det, [11, 12, 20, 14, 10, 10, 16, 18, 28]);
  det.autoFilter = `A1:I${lastDetRow}`;

  // ───────── Sheet 2: Theo ngày (mỗi ngày × nick × nhân sự = 1 dòng) ─────────
  const dayKeysMap = new Map();
  shifts.forEach(s => {
    const k = `${s.work_date}|${s.nick}|${s.staff}`;
    if (!dayKeysMap.has(k)) {
      dayKeysMap.set(k, { dateStr: s.work_date, dateObj: s.workDateObj, nick: s.nick, staff: s.staff });
    }
  });
  const dayKeys = Array.from(dayKeysMap.values());

  headerRow(day, 1, [
    "Ngày\n일자", "Nhân sự\n근무자", "Nick\n계정", "Số ca\n근무 횟수",
    "Tổng giờ\n총 근무(h)", "Chuẩn SLA (h)\n기준", "Kết quả\n결과"
  ]);

  dayKeys.forEach((k, i) => {
    const r = i + 2;
    const row = day.getRow(r);
    row.getCell(1).value = k.dateObj;
    row.getCell(2).value = k.staff;
    row.getCell(3).value = k.nick;
    row.getCell(4).value = {
      formula: `COUNTIFS(${Q_DET}!$B$2:$B$${lastDetRow},A${r},${Q_DET}!$C$2:$C$${lastDetRow},B${r},${Q_DET}!$D$2:$D$${lastDetRow},C${r})`
    };
    row.getCell(5).value = {
      formula: `SUMIFS(${Q_DET}!$G$2:$G$${lastDetRow},${Q_DET}!$B$2:$B$${lastDetRow},A${r},${Q_DET}!$C$2:$C$${lastDetRow},B${r},${Q_DET}!$D$2:$D$${lastDetRow},C${r})`
    };
    row.getCell(6).value = { formula: `${Q_OV}!$C$3` };
    row.getCell(7).value = { formula: `IF(E${r}>=F${r},"Đạt 달성","Thiếu 미달")` };

    bodyRow(day, r, 7, i % 2 === 1, {
      1: 'yyyy-mm-dd',
      5: '0.00',
      6: '0.0'
    });

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'right' };
    row.getCell(6).alignment = { horizontal: 'right' };
    row.getCell(7).alignment = { horizontal: 'center' };
  });

  const n_day = dayKeys.length + 1;
  const lastDayRow = Math.max(n_day, 2);
  setColumnWidths(day, [12, 20, 14, 10, 14, 14, 14]);
  day.autoFilter = `A1:G${lastDayRow}`;

  // ───────── Sheet 1: Tổng quan ─────────
  setColumnWidths(ov, [6, 24, 22, 14, 14, 14, 14, 14]);

  ov.getCell('A1').value = 'BÁO CÁO GIỜ LÀM & SLA  ·  근무 시간 및 SLA 보고서';
  ov.getCell('A1').font = f(true, 16, NAVY);
  ov.getRow(1).height = 28;

  ov.getCell('A2').value = 'Kỳ báo cáo 기간';
  ov.getCell('A2').font = f(false, 9, MUTED);
  ov.getCell('C2').value = `${fromDate}  →  ${toDate}`;
  ov.getCell('C2').font = f(true, 10);
  const exportedAtStr = new Date().toLocaleString('vi-VN', { hour12: false });
  ov.getCell('D2').value = `Xuất lúc 생성: ${exportedAtStr}`;
  ov.getCell('D2').font = f(false, 9, MUTED);

  ov.getCell('A3').value = 'Chuẩn SLA 기준 (giờ/ngày)';
  ov.getCell('A3').font = f(false, 9, MUTED);
  ov.getCell('C3').value = slaHours;
  ov.getCell('C3').font = { name: FONT, bold: true, size: 10, color: { argb: 'FF0000FF' } };
  ov.getCell('C3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
  ov.getCell('C3').alignment = { horizontal: 'left' };
  ov.getCell('D3').value = '← có thể chỉnh, toàn bộ báo cáo tự tính lại';
  ov.getCell('D3').font = f(false, 9, MUTED);

  const staffMap = new Map();
  const nickSet = new Set();
  shifts.forEach(s => {
    if (!staffMap.has(s.staff)) {
      staffMap.set(s.staff, s.discord_id);
    }
    nickSet.add(s.nick);
  });
  const staffList = Array.from(staffMap.entries()).map(([name, did]) => ({ name, did }));
  const nickList = Array.from(nickSet);

  const r_staff_hdr = 9;
  const r_staff0 = r_staff_hdr + 1;
  const r_staff_tot = r_staff0 + Math.max(staffList.length, 1);
  const r_nick_hdr = r_staff_tot + 3;
  const r_nick0 = r_nick_hdr + 1;
  const r_nick_tot = r_nick0 + Math.max(nickList.length, 1);

  // KPI (hàng 5-6)
  ov.getRow(5).height = 30;
  ov.getRow(6).height = 34;

  const kpis = [
    { col: 'B', label: 'Tổng giờ làm\n총 근무 시간', formula: `SUM(${Q_DET}!$G$2:$G$${lastDetRow})`, fmt: '0.0" h"' },
    { col: 'C', label: 'Nhân sự\n근무자', formula: `COUNTA(B${r_staff0}:B${r_staff_tot - 1})`, fmt: '0' },
    { col: 'D', label: 'Nick game\n계정', formula: `COUNTA(B${r_nick0}:B${r_nick_tot - 1})`, fmt: '0' },
    { col: 'E', label: 'Tỉ lệ đạt SLA\n달성률', formula: `IF(COUNT(${Q_DAY}!$E$2:$E$${lastDayRow})=0,0,COUNTIFS(${Q_DAY}!$E$2:$E$${lastDayRow},">="&$C$3)/COUNT(${Q_DAY}!$E$2:$E$${lastDayRow}))`, fmt: '0.0%' }
  ];

  kpis.forEach(({ col, label, formula, fmt }) => {
    const lblCell = ov.getCell(`${col}5`);
    const valCell = ov.getCell(`${col}6`);
    lblCell.value = label;
    valCell.value = { formula };
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

  // 1. Bảng nhân sự
  sectionTitle(r_staff_hdr - 1, '1. NHÂN SỰ  근무자');
  headerRow(ov, r_staff_hdr, [
    "#", "Nhân sự\n근무자", "Discord ID", "Tổng giờ\n총 근무(h)",
    "Số ngày làm\n출근 일수", "Ngày đạt\n달성", "Ngày thiếu\n미달", "Tỉ lệ đạt\n달성률"
  ]);

  if (staffList.length === 0) {
    const row = ov.getRow(r_staff0);
    row.getCell(2).value = 'Chưa có dữ liệu';
    bodyRow(ov, r_staff0, 8, false);
  } else {
    staffList.forEach((st, i) => {
      const r = r_staff0 + i;
      const row = ov.getRow(r);
      row.getCell(1).value = i + 1;
      row.getCell(2).value = st.name;
      row.getCell(3).value = String(st.did || '');
      row.getCell(4).value = { formula: `SUMIFS(${Q_DET}!$G$2:$G$${lastDetRow},${Q_DET}!$C$2:$C$${lastDetRow},B${r})` };
      row.getCell(5).value = { formula: `COUNTIFS(${Q_DAY}!$B$2:$B$${lastDayRow},B${r})` };
      row.getCell(6).value = { formula: `COUNTIFS(${Q_DAY}!$B$2:$B$${lastDayRow},B${r},${Q_DAY}!$E$2:$E$${lastDayRow},">="&$C$3)` };
      row.getCell(7).value = { formula: `E${r}-F${r}` };
      row.getCell(8).value = { formula: `IF(E${r}=0,0,F${r}/E${r})` };

      bodyRow(ov, r, 8, i % 2 === 1, {
        4: '0.00',
        8: '0%'
      });

      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(6).alignment = { horizontal: 'right' };
      row.getCell(7).alignment = { horizontal: 'right' };
      row.getCell(8).alignment = { horizontal: 'right' };
    });
  }

  const tStaff = r_staff_tot;
  const rowStaffTot = ov.getRow(tStaff);
  rowStaffTot.getCell(2).value = 'Tổng cộng 합계';
  rowStaffTot.getCell(4).value = { formula: `SUM(D${r_staff0}:D${tStaff - 1})` };
  rowStaffTot.getCell(5).value = { formula: `SUM(E${r_staff0}:E${tStaff - 1})` };
  rowStaffTot.getCell(6).value = { formula: `SUM(F${r_staff0}:F${tStaff - 1})` };
  rowStaffTot.getCell(7).value = { formula: `SUM(G${r_staff0}:G${tStaff - 1})` };
  rowStaffTot.getCell(8).value = { formula: `IF(E${tStaff}=0,0,F${tStaff}/E${tStaff})` };
  totalRow(ov, tStaff, 8);
  rowStaffTot.getCell(4).numFmt = '0.00';
  rowStaffTot.getCell(8).numFmt = '0%';
  [4, 5, 6, 7, 8].forEach(c => {
    rowStaffTot.getCell(c).alignment = { horizontal: 'right' };
  });

  // 2. Bảng nick
  sectionTitle(r_nick_hdr - 1, '2. NICK GAME  계정');
  headerRow(ov, r_nick_hdr, [
    "#", "Mã nick\n계정 코드", "Số ca\n근무 횟수", "Tổng giờ\n총 작업(h)",
    "Số ngày cày\n작업 일수", "Ngày đạt\n달성", "Ngày thiếu\n미달", "Tỉ lệ đạt SLA\n달성률"
  ]);

  if (nickList.length === 0) {
    const row = ov.getRow(r_nick0);
    row.getCell(2).value = 'Chưa có dữ liệu';
    bodyRow(ov, r_nick0, 8, false);
  } else {
    nickList.forEach((nick, i) => {
      const r = r_nick0 + i;
      const row = ov.getRow(r);
      row.getCell(1).value = i + 1;
      row.getCell(2).value = nick;
      row.getCell(3).value = { formula: `COUNTIFS(${Q_DET}!$D$2:$D$${lastDetRow},B${r})` };
      row.getCell(4).value = { formula: `SUMIFS(${Q_DET}!$G$2:$G$${lastDetRow},${Q_DET}!$D$2:$D$${lastDetRow},B${r})` };
      row.getCell(5).value = { formula: `COUNTIFS(${Q_DAY}!$C$2:$C$${lastDayRow},B${r})` };
      row.getCell(6).value = { formula: `COUNTIFS(${Q_DAY}!$C$2:$C$${lastDayRow},B${r},${Q_DAY}!$E$2:$E$${lastDayRow},">="&$C$3)` };
      row.getCell(7).value = { formula: `E${r}-F${r}` };
      row.getCell(8).value = { formula: `IF(E${r}=0,0,F${r}/E${r})` };

      bodyRow(ov, r, 8, i % 2 === 1, {
        4: '0.00',
        8: '0%'
      });

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
  rowNickTot.getCell(2).value = 'Tổng cộng 합계';
  rowNickTot.getCell(3).value = { formula: `SUM(C${r_nick0}:C${tNick - 1})` };
  rowNickTot.getCell(4).value = { formula: `SUM(D${r_nick0}:D${tNick - 1})` };
  rowNickTot.getCell(5).value = { formula: `SUM(E${r_nick0}:E${tNick - 1})` };
  rowNickTot.getCell(6).value = { formula: `SUM(F${r_nick0}:F${tNick - 1})` };
  rowNickTot.getCell(7).value = { formula: `SUM(G${r_nick0}:G${tNick - 1})` };
  rowNickTot.getCell(8).value = { formula: `IF(E${tNick}=0,0,F${tNick}/E${tNick})` };
  totalRow(ov, tNick, 8);
  rowNickTot.getCell(4).numFmt = '0.00';
  rowNickTot.getCell(8).numFmt = '0%';
  [3, 4, 5, 6, 7, 8].forEach(c => {
    rowNickTot.getCell(c).alignment = { horizontal: 'right' };
  });

  // Ghi chú cách tính (cuối trang)
  const note_r = r_nick_tot + 2;
  const notes = [
    "Ghi chú 비고:",
    "• Ngày đạt = tổng giờ làm trong ngày ≥ chuẩn SLA (ô C3). 달성 = 일일 근무 ≥ 기준.",
    "• Giờ làm tính từ giờ vào → giờ ra của từng ca; ca chưa check-out chưa được tính giờ.",
    "• Chi tiết từng ngày / từng ca xem ở sheet 'Theo ngày' và 'Chi tiết ca'."
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
