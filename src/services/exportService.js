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

export async function exportTimesheetToExcel(fromDate, toDate) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AURA Time Tracker';
  workbook.created = new Date();

  // ==========================================
  // SHEET 1: BẢNG TỔNG HỢP TÍNH LƯƠNG / 급여 정산
  // ==========================================
  const summarySheet = workbook.addWorksheet('BANG_TINH_LUONG_급여정산', {
    views: [{ showGridLines: true }]
  });

  summarySheet.mergeCells('A1:G1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = `BẢNG TỔNG HỢP GIỜ LÀM & TÍNH LƯƠNG / 근무 시간 및 급여 정산 (${fromDate} ~ ${toDate})`;
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(1).height = 32;

  const headers = [
    'STT / No',
    'Tên Nhân Sự / 근무자',
    'Discord ID',
    'Tổng Giờ Làm / 총 근무(h)',
    'Số Ngày Làm / 출근 일수',
    'Ngày Đạt / 달성(>=8h)',
    'Ngày Thiếu / 미달(<8h)'
  ];
  summarySheet.getRow(3).values = headers;
  summarySheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summarySheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  summarySheet.getRow(3).alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(3).height = 26;

  const users = db.prepare('SELECT discord_id, display_name, daily_target_hours FROM users').all();
  
  let rowIndex = 4;
  let stt = 1;
  let grandTotalHours = 0;

  for (const user of users) {
    const dailyStats = db.prepare(`
      SELECT work_date, SUM(duration_minutes) as day_minutes
      FROM shifts
      WHERE user_id = ? 
        AND work_date >= ? 
        AND work_date <= ?
        AND status IN ('COMPLETED', 'ADJUSTED')
      GROUP BY work_date
    `).all(user.discord_id, fromDate, toDate);

    let userTotalMinutes = 0;
    let achievedDays = 0;
    let deficitDays = 0;
    const targetMinutes = Math.round((user.daily_target_hours || 8.0) * 60);

    for (const stat of dailyStats) {
      userTotalMinutes += stat.day_minutes;
      if (stat.day_minutes >= targetMinutes) {
        achievedDays++;
      } else {
        deficitDays++;
      }
    }

    const totalHours = Number((userTotalMinutes / 60).toFixed(2));
    grandTotalHours += totalHours;

    const row = summarySheet.getRow(rowIndex);
    row.values = [
      stt++,
      user.display_name,
      user.discord_id,
      totalHours,
      dailyStats.length,
      achievedDays,
      deficitDays
    ];

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { horizontal: 'right' };
    row.getCell(5).alignment = { horizontal: 'center' };
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(7).alignment = { horizontal: 'center' };

    row.getCell(4).font = { bold: true };
    if (deficitDays > 0) {
      row.getCell(7).font = { color: { argb: 'FFC00000' }, bold: true };
    }

    rowIndex++;
  }

  const totalRow = summarySheet.getRow(rowIndex);
  totalRow.values = [
    '',
    'TỔNG CỘNG / 총합계',
    '',
    Number(grandTotalHours.toFixed(2)),
    '',
    '',
    ''
  ];
  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  totalRow.getCell(4).alignment = { horizontal: 'right' };

  // ==============================================================
  // SHEET 2: BẢNG TIẾN ĐỘ TỪNG NICK GAME / 계정별 달성 현황 (CHO KHÁCH HÀN)
  // ==============================================================
  const accountSheet = workbook.addWorksheet('TIEN_DO_NICK_계정별현황', {
    views: [{ showGridLines: true }]
  });

  accountSheet.mergeCells('A1:G1');
  const accTitleCell = accountSheet.getCell('A1');
  accTitleCell.value = `BÁO CÁO NGHIỆM THU THEO NICK GAME / 계정별 작업 시간 보고서 (${fromDate} ~ ${toDate})`;
  accTitleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  accTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7030A0' } }; // Màu tím sang trọng
  accTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  accountSheet.getRow(1).height = 32;

  const accHeaders = [
    'STT / No',
    'Mã Nick Game / 계정 코드',
    'Tổng Giờ Cày / 총 작업(h)',
    'Số Ngày Cày / 작업 일수',
    'Ngày Đạt / 달성(>=8h)',
    'Ngày Thiếu / 미달(<8h)',
    'Tỉ Lệ Đạt SLA / 달성률(%)'
  ];
  accountSheet.getRow(3).values = accHeaders;
  accountSheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  accountSheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF595959' } };
  accountSheet.getRow(3).alignment = { horizontal: 'center', vertical: 'middle' };
  accountSheet.getRow(3).height = 26;

  const distinctAccounts = db.prepare(`
    SELECT DISTINCT account_code FROM shifts 
    WHERE work_date >= ? AND work_date <= ?
    UNION
    SELECT DISTINCT account_code FROM accounts
  `).all(fromDate, toDate);

  let accRowIdx = 4;
  let accStt = 1;
  let grandTotalAccHours = 0;

  for (const acc of distinctAccounts) {
    if (!acc.account_code) continue;

    const accDailyStats = db.prepare(`
      SELECT work_date, SUM(duration_minutes) as day_minutes
      FROM shifts
      WHERE account_code = ? 
        AND work_date >= ? 
        AND work_date <= ?
        AND status IN ('COMPLETED', 'ADJUSTED')
      GROUP BY work_date
    `).all(acc.account_code, fromDate, toDate);

    let accTotalMinutes = 0;
    let achievedDays = 0;
    let deficitDays = 0;
    const targetMinutes = 8.0 * 60; // 8 tiếng

    for (const stat of accDailyStats) {
      accTotalMinutes += stat.day_minutes;
      if (stat.day_minutes >= targetMinutes) {
        achievedDays++;
      } else {
        deficitDays++;
      }
    }

    const totalHours = Number((accTotalMinutes / 60).toFixed(2));
    grandTotalAccHours += totalHours;

    const totalActiveDays = accDailyStats.length;
    const slaRate = totalActiveDays > 0 ? ((achievedDays / totalActiveDays) * 100).toFixed(1) + '%' : '0%';

    const row = accountSheet.getRow(accRowIdx);
    row.values = [
      accStt++,
      acc.account_code,
      totalHours,
      totalActiveDays,
      achievedDays,
      deficitDays,
      slaRate
    ];

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'right' };
    row.getCell(4).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'center' };
    row.getCell(6).alignment = { horizontal: 'center' };
    row.getCell(7).alignment = { horizontal: 'center' };

    row.getCell(3).font = { bold: true };
    if (deficitDays > 0) {
      row.getCell(6).font = { color: { argb: 'FFC00000' }, bold: true };
    }

    accRowIdx++;
  }

  const accTotalRow = accountSheet.getRow(accRowIdx);
  accTotalRow.values = [
    '',
    'TỔNG CỘNG TẤT CẢ NICK',
    Number(grandTotalAccHours.toFixed(2)),
    '',
    '',
    '',
    ''
  ];
  accTotalRow.font = { bold: true };
  accTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
  accTotalRow.getCell(3).alignment = { horizontal: 'right' };

  // ==========================================
  // SHEET 3: CHI TIẾT CÁC CA / 근무 상세 내역
  // ==========================================
  const detailSheet = workbook.addWorksheet('CHI_TIET_CA_근무상세', {
    views: [{ showGridLines: true }]
  });

  const detailHeaders = [
    'Mã Ca / ID',
    'Nhân Viên / 근무자',
    'Nick Cày / 계정 코드',
    'Ngày Làm / 일자',
    'Giờ Vào / 출근',
    'Giờ Ra / 퇴근',
    'Thời Lượng / 근무(분)',
    'Thời Lượng / 근무(시간)',
    'Trạng Thái / 상태',
    'Ghi Chú / 비고'
  ];
  detailSheet.getRow(1).values = detailHeaders;
  detailSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  detailSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333F48' } };
  detailSheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
  detailSheet.getRow(1).height = 26;

  const rawShifts = db.prepare(`
    SELECT s.id, u.display_name, s.account_code, s.work_date, s.check_in, s.check_out, s.duration_minutes, s.status, s.note
    FROM shifts s
    JOIN users u ON s.user_id = u.discord_id
    WHERE s.work_date >= ? AND s.work_date <= ?
    ORDER BY s.check_in DESC
  `).all(fromDate, toDate);

  let detailRowIdx = 2;
  for (const s of rawShifts) {
    const dRow = detailSheet.getRow(detailRowIdx);
    const inTime = s.check_in ? new Date(s.check_in).toLocaleString('vi-VN') : '';
    const outTime = s.check_out ? new Date(s.check_out).toLocaleString('vi-VN') : 'Đang làm / 근무 중';
    const hours = Number(((s.duration_minutes || 0) / 60).toFixed(2));

    dRow.values = [
      s.id,
      s.display_name,
      s.account_code || 'N/A',
      s.work_date,
      inTime,
      outTime,
      s.duration_minutes || 0,
      hours,
      s.status,
      s.note || ''
    ];
    dRow.getCell(1).alignment = { horizontal: 'center' };
    dRow.getCell(3).alignment = { horizontal: 'center' };
    dRow.getCell(4).alignment = { horizontal: 'center' };
    dRow.getCell(7).alignment = { horizontal: 'right' };
    dRow.getCell(8).alignment = { horizontal: 'right' };
    detailRowIdx++;
  }

  // Tự động căn chỉnh độ rộng cột cho cả 3 sheet
  [summarySheet, accountSheet, detailSheet].forEach(sheet => {
    sheet.columns.forEach(column => {
      let maxLen = 0;
      column.eachCell({ includeEmpty: true }, cell => {
        const val = cell.value ? cell.value.toString() : '';
        maxLen = Math.max(maxLen, val.length);
      });
      column.width = Math.max(maxLen + 4, 14);
    });
  });

  const fileName = `bang_cong_${fromDate}_den_${toDate}.xlsx`;
  const filePath = path.join(exportsDir, fileName);
  await workbook.xlsx.writeFile(filePath);

  console.log(`[EXPORT] Đã xuất file Excel 3 Sheet: ${filePath}`);
  return {
    filePath,
    fileName,
    grandTotalHours,
    userCount: users.length,
    accountCount: distinctAccounts.length
  };
}
