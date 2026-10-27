import { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder 
} from 'discord.js';
import { 
  startShiftWithAccount, 
  endShift, 
  getDaySummaryForUser,
  getAccountDailySummary
} from '../services/shiftService.js';
import { getHoursUntilCutoff } from '../services/reminderService.js';
import { config } from '../config/env.js';

function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const hours = Math.floor(m / 60);
  const remainingMins = m % 60;
  const decimalHours = (m / 60).toFixed(2);

  if (hours === 0) {
    return `${remainingMins} phút / 분 (${decimalHours}h)`;
  }
  return `${hours}h ${remainingMins}p (${decimalHours}h)`;
}

function createProgressBar(percent, length = 15) {
  const filled = Math.min(length, Math.max(0, Math.round((percent / 100) * length)));
  const empty = length - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

/**
 * Xử lý sự kiện bấm Nút
 */
export async function handleButtonInteraction(interaction) {
  const { customId, user, member } = interaction;
  const displayName = member?.displayName || user.username;

  // 1. NÚT VÀO CA (Mở Modal chọn Nick Game)
  if (customId === 'btn_checkin') {
    const modal = new ModalBuilder()
      .setCustomId('modal_checkin')
      .setTitle('CHỌN NICK CÀY / 출근 계정 선택');

    const accountInput = new TextInputBuilder()
      .setCustomId('account_code_input')
      .setLabel('Tên/Mã Nick Game / 계정 코드 (bắt buộc)')
      .setPlaceholder('Ví dụ: Acc_01, Acc_02, Nam, Ngô Thành...')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(50);

    const noteInput = new TextInputBuilder()
      .setCustomId('note_input')
      .setLabel('Ghi chú ca cày / 작업 메모 (tùy chọn)')
      .setPlaceholder('Level ban đầu, nhiệm vụ hôm nay...')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100);

    const row1 = new ActionRowBuilder().addComponents(accountInput);
    const row2 = new ActionRowBuilder().addComponents(noteInput);
    modal.addComponents(row1, row2);

    // Bắt buộc gọi showModal trực tiếp không defer
    return interaction.showModal(modal);
  }

  // 2. NÚT HẾT CA (CHECK-OUT / 퇴근)
  if (customId === 'btn_checkout') {
    const result = endShift(user.id);

    if (!result.success) {
      return interaction.reply({
        content: `⚠️ **Thông báo / 알림:** ${result.message}\n*(현재 진행 중인 근무가 없습니다.)*`,
        ephemeral: true
      });
    }

    if (config.onShiftRoleId && member) {
      try {
        await member.roles.remove(config.onShiftRoleId);
      } catch (err) {
        console.warn('[ROLE WARN] Không thể gỡ role On-Shift:', err.message);
      }
    }

    const shiftDurationText = formatMinutes(result.durationMinutes);
    const memberTotalText = formatMinutes(result.memberTotalToday);
    const accountTotalText = formatMinutes(result.accountTotalToday);

    const accountStatusText = result.isAccountAchieved
      ? '✅ **Nick này ĐÃ ĐẠT chỉ tiêu 8h hôm nay! / 오늘 목표 8시간 달성 완료!**'
      : `⏳ **Nick [${result.accountCode}] còn thiếu:** **${formatMinutes(Math.max(0, 480 - result.accountTotalToday))}** để đủ 8h SLA.`;

    return interaction.reply({
      content: `🔴 **KẾT THÚC CA LÀM VIỆC! / 퇴근 완료!**\n\n` +
               `• **Nick vừa cày / 작업 계정:** \`[${result.accountCode}]\`\n` +
               `• **Ca vừa rồi / 이번 근무:** **${shiftDurationText}**\n` +
               `• **Tổng giờ của bạn hôm nay / 오늘 개인 총 근무:** **${memberTotalText}** / 8.0h\n` +
               `• **Tổng giờ của Nick [${result.accountCode}] cả ngày:** **${accountTotalText}** / 8.0h\n` +
               `└ ${accountStatusText}`,
      ephemeral: true
    });
  }

  // 3. NÚT XEM TIẾN ĐỘ HÔM NAY (STATUS / 근무 현황)
  if (customId === 'btn_status') {
    const summary = getDaySummaryForUser(user.id);
    const totalText = formatMinutes(summary.totalMinutes);
    const remainingText = formatMinutes(summary.remainingMinutes);
    const hoursLeftBeforeCutoff = getHoursUntilCutoff().toFixed(1);

    const rawPercent = (summary.totalMinutes / (summary.targetHours * 60)) * 100;
    const displayPercent = rawPercent > 0 && rawPercent < 1 
      ? rawPercent.toFixed(1) 
      : Math.min(100, Math.round(rawPercent));

    const progressBar = createProgressBar(rawPercent);

    let currentShiftStatus = summary.hasActiveShift 
      ? `🟢 **Đang trong ca / 근무 중** trên Nick \`[${summary.activeAccount}]\` (Đã cày: ${formatMinutes(summary.activeMinutes)})`
      : `⚪ **Đang nghỉ / 휴식 중**`;

    return interaction.reply({
      content: `📊 **TIẾN ĐỘ CỦA BẠN HÔM NAY / 오늘의 개인 근무 현황 (${summary.workDate})**\n\n` +
               `• **Trạng thái / 상태:** ${currentShiftStatus}\n` +
               `• **Tiến độ / 달성률:** ${progressBar} **${displayPercent}%**\n` +
               `• **Tổng giờ cá nhân / 총 근무:** **${totalText}** / 8.0h\n` +
               `• **Còn thiếu / 남은 시간:** **${remainingText}**\n` +
               `• **Thời gian đến 06:00 sáng mai / 마감까지:** **${hoursLeftBeforeCutoff}h**\n\n` +
               `*(Mẹo: Dùng lệnh \`/acc-status\` để xem tiến độ của từng Nick Game)*`,
      ephemeral: true
    });
  }
}

/**
 * Xử lý khi Member nộp Form Modal (Check-in với Nick Game)
 */
export async function handleModalInteraction(interaction) {
  if (interaction.customId !== 'modal_checkin') return;

  const { user, member } = interaction;
  const displayName = member?.displayName || user.username;
  const accountCode = interaction.fields.getTextInputValue('account_code_input').trim();
  const note = interaction.fields.getTextInputValue('note_input')?.trim() || '';

  const result = startShiftWithAccount(user.id, displayName, accountCode, note);

  if (!result.success) {
    if (result.errorType === 'ACCOUNT_OCCUPIED') {
      return interaction.reply({
        content: `⛔ **TRÙNG NICK GAME / 계정 중복 경고:**\n` +
                 `${result.message}\n` +
                 `*(해당 계정은 이미 다른 팀원이 작업 중입니다. 교대 후 다시 시도해주세요.)*`,
        ephemeral: true
      });
    }

    return interaction.reply({
      content: `⚠️ **Thông báo / 알림:** ${result.message}`,
      ephemeral: true
    });
  }

  // Gán role On-Shift nếu có
  if (config.onShiftRoleId && member) {
    try {
      await member.roles.add(config.onShiftRoleId);
    } catch (err) {
      console.warn('[ROLE WARN] Không thể gán role On-Shift:', err.message);
    }
  }

  const checkInTimeStr = result.checkInTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const noteStr = note ? `\n• **Ghi chú / 메모:** *${note}*` : '';

  // Lấy tiến độ hiện tại của Nick này trong ngày để báo cho member biết
  const accSummary = getAccountDailySummary(result.accountCode, result.workDate);
  const accDoneSoFar = formatMinutes(accSummary.completedMinutes);

  return interaction.reply({
    content: `🟢 **VÀO CA THÀNH CÔNG! / 출근 완료!**\n\n` +
             `• **Nhân sự / 근무자:** **${displayName}**\n` +
             `• **Nick đảm nhận / 담당 계정:** \`[${result.accountCode}]\`\n` +
             `• **Giờ vào / 출근 시간:** **${checkInTimeStr}**\n` +
             `• **Hôm nay Nick này đã được cày:** **${accDoneSoFar} / 8.0h**${noteStr}\n\n` +
             `*Chúc bạn cày game hiệu quả! Khi nghỉ nhớ bấm nút "Hết ca" để mở khóa Nick cho anh em xoay ca tiếp theo nhé!*\n` +
             `*교대 시 다음 사람을 위해 퇴근 버튼을 꼭 눌러주세요!*`,
    ephemeral: true
  });
}
