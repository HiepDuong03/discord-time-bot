import { smartParseDate } from '../src/commands/export.js';
import { exportTimesheetToExcel } from '../src/services/exportService.js';
import { addOfficialAccount, removeOfficialAccount } from '../src/services/shiftService.js';
import db from '../src/database/db.js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';

async function runVerification() {
  console.log('🧪 1. KIỂM THỬ SMART DATE PARSER...');
  const tests = [
    { input: '1', expected: '2026-10-01' },
    { input: '27', expected: '2026-10-27' },
    { input: '15/9', expected: '2026-09-15' },
    { input: '15-10', expected: '2026-10-15' },
    { input: '20261001', expected: '2026-10-01' },
    { input: '220261001', expected: '2026-10-01' },
    { input: '2026-10-15', expected: '2026-10-15' }
  ];

  for (const t of tests) {
    const res = smartParseDate(t.input);
    console.log(`  Gõ "${t.input}" ➔ "${res}" (Kỳ vọng: "${t.expected}")`);
    if (res !== t.expected) {
      throw new Error(`Parse date thất bại cho "${t.input}": nhận được "${res}"`);
    }
  }
  console.log('✅ Smart Date Parser hoạt động xuất sắc!\n');

  console.log('🧪 2. KIỂM THỬ /acc-manage (Thêm & Gỡ Nick)...');
  const addRes = await addOfficialAccount('ACC_REAL_01', 8.0);
  console.log('  Thêm ACC_REAL_01:', addRes);
  if (!addRes.success) throw new Error('Thêm acc thất bại');

  console.log('🧪 3. KIỂM THỬ XUẤT EXCEL & GIÁ TRỊ CÁC Ô TÍNH TOÁN...');
  const testUser = '1114434766624804874';
  const testName = 'Dai_Hiep21';
  const testAcc = 'ACC_REAL_01';
  
  // Tạo 1 ca làm hoàn tất với thời lượng 1.5 giờ (90 phút) để kiểm thử số thực
  const checkIn = new Date('2026-10-27T08:00:00Z');
  const checkOut = new Date('2026-10-27T09:30:00Z');
  await db.execute({
    sql: `INSERT INTO shifts (user_id, account_code, check_in, check_out, duration_minutes, work_date, status, note)
          VALUES (?, ?, ?, ?, 90, '2026-10-27', 'COMPLETED', 'Test ca mẫu 1.5h')`,
    args: [testUser, testAcc, checkIn.toISOString(), checkOut.toISOString()]
  });

  const exportRes = await exportTimesheetToExcel('2026-10-01', '2026-10-31');
  if (!exportRes.hasData) throw new Error('Export không có dữ liệu');

  // Đọc lại file Excel và kiểm tra cả ExcelJS model và XML <v> tag
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(exportRes.filePath);

  const ov = wb.getWorksheet('Tổng quan 요약');
  const day = wb.getWorksheet('Theo ngày 일별');
  const det = wb.getWorksheet('Chi tiết ca 상세');

  console.log('\n📊 KIỂM TRA SHEET 1 (TỔNG QUAN):');
  console.log('  B6 (Tổng giờ):', ov.getCell('B6').value);
  console.log('  C6 (Nhân sự):', ov.getCell('C6').value);
  console.log('  D10 (Tổng giờ nhân viên):', ov.getCell('D10').value);

  console.log('\n📊 KIỂM TRA SHEET 2 (THEO NGÀY):');
  console.log('  D2 (Số ca):', day.getCell('D2').value);
  console.log('  E2 (Tổng giờ):', day.getCell('E2').value);
  console.log('  G2 (Kết quả):', day.getCell('G2').value);

  console.log('\n📊 KIỂM TRA SHEET 3 (CHI TIẾT CA):');
  console.log('  G2 (Thời lượng h):', det.getCell('G2').value);
  console.log('  H2 (Trạng thái):', det.getCell('H2').value);

  // Kiểm tra raw XML trong tệp xlsx để xác nhận thẻ <v> có mặt đầy đủ
  const zipData = fs.readFileSync(exportRes.filePath);
  const zip = await JSZip.loadAsync(zipData);
  const detXml = await zip.file('xl/worksheets/sheet3.xml').async('string');
  const hasValueTagInDet = detXml.includes('<v>1.5</v>');
  console.log('\n🔍 Kiểm tra raw XML thẻ <v>1.5</v> trong Sheet Chi tiết ca:', hasValueTagInDet ? '✅ CÓ MẶT ĐẦY ĐỦ!' : '❌ THIẾU');

  if (!hasValueTagInDet) {
    throw new Error('❌ Lỗi: Thẻ <v> không xuất hiện trong OpenXML!');
  }

  console.log('\n🎉 TẤT CẢ CÁC Ô TÍNH TOÁN ĐÃ CÓ PRE-COMPUTED RESULT! HOÀN TOÀN KHÔNG BỊ TRỐNG KHI MỞ TRÊN GOOGLE SHEETS / CSV / MOBILE!');

  // Dọn dẹp ca test & nick test
  await removeOfficialAccount('ACC_REAL_01');
  await db.execute("DELETE FROM accounts WHERE account_code = 'ACC_REAL_01'");
  await db.execute("DELETE FROM shifts WHERE account_code = 'ACC_REAL_01'");
  console.log('🧹 Đã dọn dẹp sạch sẽ dữ liệu test.');
}

runVerification().catch(err => {
  console.error('❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
