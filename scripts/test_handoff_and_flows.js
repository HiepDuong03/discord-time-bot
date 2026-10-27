import { 
  startShiftWithAccount, 
  endShift, 
  handoffShift, 
  getActiveShift, 
  getActiveShiftByAccount,
  getAllAccountsTodaySummary 
} from '../src/services/shiftService.js';
import db from '../src/database/db.js';

async function runTests() {
  console.log('🧪 BẮT ĐẦU TEST TOÀN DIỆN CÁC FLOW MỚI...');

  const testUserA = '999999001';
  const testNameA = 'Worker_A_Test';
  const testUserB = '999999002';
  const testNameB = 'Worker_B_Test';
  const testAcc = 'ACC_HANDOFF_TEST';

  // Dọn dẹp ca test cũ nếu có
  await db.execute({
    sql: `DELETE FROM audit_logs WHERE user_id IN (?, ?)`,
    args: [testUserA, testUserB]
  });
  await db.execute({
    sql: `DELETE FROM shifts WHERE user_id IN (?, ?) OR account_code = ?`,
    args: [testUserA, testUserB, testAcc]
  });

  console.log('1. Test Check-in Worker A trên Nick:', testAcc);
  const startA = await startShiftWithAccount(testUserA, testNameA, testAcc, 'Test ca sáng');
  if (!startA.success) throw new Error('Checkin A thất bại: ' + startA.message);
  console.log('✅ Worker A đã vào ca thành công:', startA.accountCode);

  console.log('2. Test Worker B cố vào ca cùng nick (Kỳ vọng: ACCOUNT_OCCUPIED)');
  const startB_Duplicate = await startShiftWithAccount(testUserB, testNameB, testAcc);
  if (startB_Duplicate.success || startB_Duplicate.errorType !== 'ACCOUNT_OCCUPIED') {
    throw new Error('Chống tranh acc thất bại!');
  }
  console.log('✅ Hệ thống chặn tranh acc thành công: ', startB_Duplicate.message);

  console.log('3. Test Worker B nhận BÀN GIAO CA 1-chạm (handoffShift)...');
  const handoffRes = await handoffShift(testUserB, testNameB, testAcc);
  if (!handoffRes.success) throw new Error('Handoff thất bại: ' + handoffRes.message);
  console.log('✅ Handoff thành công!', {
    account: handoffRes.accountCode,
    oldUser: handoffRes.oldUser,
    newShiftId: handoffRes.newShift.id
  });

  // Verify DB state
  const activeA = await getActiveShift(testUserA);
  if (activeA) throw new Error('Worker A vẫn còn ca active!');

  const activeB = await getActiveShift(testUserB);
  if (!activeB || activeB.account_code !== testAcc) throw new Error('Worker B không có ca active trên nick test!');

  console.log('4. Test Worker B hết ca...');
  const endB = await endShift(testUserB);
  if (!endB.success) throw new Error('End shift B thất bại');
  console.log('✅ Worker B hết ca thành công!');

  // Dọn dẹp data test
  await db.execute({
    sql: `DELETE FROM audit_logs WHERE user_id IN (?, ?)`,
    args: [testUserA, testUserB]
  });
  await db.execute({
    sql: `DELETE FROM shifts WHERE user_id IN (?, ?) OR account_code = ?`,
    args: [testUserA, testUserB, testAcc]
  });

  console.log('\n🎉 TẤT CẢ CÁC BƯỚC TEST FLOW ĐÃ PASS 100% TRÊN TURSO CLOUD!');
}

runTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
