import { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder
} from 'discord.js';
import { 
  startShiftWithAccount, 
  endShift, 
  getDaySummaryForUser,
  getAccountDailySummary,
  getAllAccountsTodaySummary,
  getActiveShift,
  getActiveShiftByAccount,
  handoffShift,
  normalizeAccountCode
} from '../services/shiftService.js';
import { getHoursUntilCutoff } from '../services/reminderService.js';
import { buildAccountStatusEmbed } from '../commands/accStatus.js';
import { buildReportPayload } from '../commands/report.js';
import { config } from '../config/env.js';
import { formatTimeInTz } from '../utils/dateUtils.js';
import { formatMinutes, createProgressBar } from '../utils/formatUtils.js';

const formatBilingualMins = (m) => formatMinutes(m, { bilingualUnderHour: true });
const CHECKIN_PAGE_SIZE = 25;

function buildCheckinMenuPayload(accList, page = 0) {
  const totalPages = Math.max(1, Math.ceil(accList.length / CHECKIN_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * CHECKIN_PAGE_SIZE;
  const displayList = accList.slice(start, start + CHECKIN_PAGE_SIZE);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_checkin_account')
    .setPlaceholder(
      totalPages > 1
        ? `🎮 Chọn Nick game (Trang ${safePage + 1}/${totalPages})...`
        : '🎮 Chọn Nick game bạn muốn cày / 계정을 선택하세요...'
    );

  const options = displayList.map(acc => {
    const totalH = (acc.totalMinutes / 60).toFixed(1);
    const targetH = Number(acc.targetHours || config.dailyTargetHours).toFixed(1);
    if (acc.hasActiveShift) {
      return new StringSelectMenuOptionBuilder()
        .setLabel(`Nick [${acc.accountCode}] (${totalH}h / ${targetH}h)`)
        .setValue(`acc:${acc.accountCode}`)
        .setDescription(`🔴 Có người cày: ${acc.activeFarmerName.slice(0, 20)} (${acc.activeMinutes}p) - Bàn giao`)
        .setEmoji('🔴');
    }
    if (acc.isAchieved) {
      return new StringSelectMenuOptionBuilder()
        .setLabel(`Nick [${acc.accountCode}] (${totalH}h / ${targetH}h)`)
        .setValue(`acc:${acc.accountCode}`)
        .setDescription(`🌟 Đã hoàn thành 100% SLA hôm nay`)
        .setEmoji('✅');
    }
    const remH = (acc.remainingMinutes / 60).toFixed(1);
    return new StringSelectMenuOptionBuilder()
      .setLabel(`Nick [${acc.accountCode}] (${totalH}h / ${targetH}h)`)
      .setValue(`acc:${acc.accountCode}`)
      .setDescription(`🟢 Đang trống • Còn thiếu ${remH}h`)
      .setEmoji('🟢');
  });

  selectMenu.addOptions(options);
  const components = [new ActionRowBuilder().addComponents(selectMenu)];

  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_checkin_page:${safePage - 1}`)
          .setLabel('◀️ Trang trước')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage === 0),
        new ButtonBuilder()
          .setCustomId('btn_checkin_page_info')
          .setLabel(`Trang ${safePage + 1}/${totalPages} (${accList.length} nick)`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`btn_checkin_page:${safePage + 1}`)
          .setLabel('Trang sau ▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= totalPages - 1)
      )
    );
  }

  const embed = new EmbedBuilder()
    .setTitle('🎮 CHỌN NICK CÀY HÔM NAY | 출근 계정 선택')
    .setDescription(
      `> Vui lòng chọn tài khoản từ danh sách bên dưới:\n\n` +
      `• 🟢 **Nick Đang Trống:** Chọn để nhận ca và bắt đầu tính giờ ngay.\n` +
      `• 🔴 **Nick Đang Cày:** Chọn để **Nhận Bàn Giao Ca** nếu đồng đội quên chốt ca.\n\n` +
      `-# 🇰🇷 아래 메뉴에서 작업할 계정을 선택하세요 (작업 중인 계정은 교대 가능).`
    )
    .setColor('#57F287');

  return { embeds: [embed], components };
}

export function buildCheckinModal() {
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
  return modal;
}

/**
 * Xử lý sự kiện bấm Nút
 */
export async function handleButtonInteraction(interaction) {
  const { customId, user, member } = interaction;
  const displayName = member?.displayName || user.username;

  // 1. NÚT VÀO CA (Kiểm tra Role Member và mở danh sách Nick Game bằng Select Menu)
  if (customId === 'btn_checkin') {
    // Kiểm tra quyền theo Role Member
    if (config.targetWorkerRoleId && member) {
      const hasWorkerRole = member.roles?.cache?.has(config.targetWorkerRoleId);
      const isManager = member.permissions?.has('ManageGuild') || member.permissions?.has('Administrator');
      if (!hasWorkerRole && !isManager) {
        return interaction.reply({
          content: `⛔ **Chưa có quyền vào ca / 권한 없음:**\n` +
                   `Bạn cần có role **Member** (Nhân viên cày game) để sử dụng hệ thống chấm công!\n` +
                   `Vui lòng liên hệ Quản lý để được cấp role trước khi vào ca.\n` +
                   `-# 🇰🇷 작업 진행을 위해 관리자에게 Member 역할을 요청하세요.`,
          ephemeral: true
        });
      }
    }

    const [activeShift, accList] = await Promise.all([
      getActiveShift(user.id),
      getAllAccountsTodaySummary()
    ]);

    if (activeShift) {
      return interaction.reply({
        content: `⚠️ **Bạn đang có ca cày dở dang! / 이미 근무 중입니다:**\n` +
                 `• Nick đang cày: \`[${activeShift.account_code}]\`\n` +
                 `• Giờ vào ca: **${formatTimeInTz(activeShift.check_in)}**\n\n` +
                 `👉 Vui lòng bấm **[🔴 Hết Ca | 퇴근]** trước khi đổi sang Nick khác!`,
        ephemeral: true
      });
    }

    // Nếu chưa có nick nào trong danh mục chính thức, nhắc Quản lý thêm nick
    if (accList.length === 0) {
      return interaction.reply({
        content: `ℹ️ Chưa có Nick game nào trong danh mục hoạt động.\n` +
                 `👉 Quản lý vui lòng dùng lệnh \`/acc-manage add code:<mã_nick>\` để thêm Nick trước khi nhân viên vào ca!\n` +
                 `-# 🇰🇷 등록된 계정이 없습니다. 관리자에게 계정 등록(/acc-manage add)을 요청하세요.`,
        ephemeral: true
      });
    }

    return interaction.reply({
      ...buildCheckinMenuPayload(accList, 0),
      ephemeral: true
    });
  }

  // 1b. CHUYỂN TRANG MENU VÀO CA (>25 NICK)
  if (customId.startsWith('btn_checkin_page:')) {
    const page = parseInt(customId.split(':')[1], 10) || 0;
    const accList = await getAllAccountsTodaySummary();
    if (accList.length === 0) {
      return interaction.update({
        content: 'ℹ️ Chưa có Nick game nào trong danh mục hoạt động.',
        embeds: [],
        components: []
      });
    }
    return interaction.update(buildCheckinMenuPayload(accList, page));
  }

  // 2. NÚT HẾT CA (CHECK-OUT / 퇴근)
  if (customId === 'btn_checkout') {
    const result = await endShift(user.id);

    if (!result.success) {
      return interaction.reply({
        content: `⚠️ **Thông báo / 알림:** ${result.message}\n*(현재 진행 중인 근무가 없습니다.)*`,
        ephemeral: true
      });
    }

    if (config.onShiftRoleId && member) {
      member.roles.remove(config.onShiftRoleId).catch(err => {
        console.warn('[ROLE WARN] Không thể gỡ role On-Shift:', err.message);
      });
    }

    const shiftDurationText = formatBilingualMins(result.durationMinutes);
    const memberTotalText = formatBilingualMins(result.memberTotalToday);
    const accountTotalText = formatBilingualMins(result.accountTotalToday);
    const memberTargetStr = Number(result.memberTargetHours || config.dailyTargetHours).toFixed(1);
    const accountTargetStr = Number(result.accountTargetHours || 8.0).toFixed(1);

    const accountStatusText = result.isAccountAchieved
      ? `✅ **Nick này ĐÃ ĐẠT chỉ tiêu ${accountTargetStr}h hôm nay! / 오늘 목표 ${accountTargetStr}시간 달성!**`
      : `⏳ **Nick [${result.accountCode}] còn thiếu:** **${formatBilingualMins(result.accountRemainingMinutes)}** để đủ ${accountTargetStr}h SLA.`;

    const embed = new EmbedBuilder()
      .setTitle('🔴 KẾT THÚC CA LÀM VIỆC | 퇴근 완료')
      .setDescription(
        `> **Nhân sự / 근무자:** **${displayName}**\n` +
        `> **Nick vừa cày / 작업 계정:** \`[${result.accountCode}]\`  •  **Ca vừa rồi / 이번 근무:** **${shiftDurationText}**\n\n` +
        `👤 **Tổng giờ của bạn hôm nay / 오늘 개인 총 근무:** \`${memberTotalText} / ${memberTargetStr}h\`\n` +
        `🛡️ **Tổng giờ Nick [${result.accountCode}] / 오늘 계정 총 작업:** \`${accountTotalText} / ${accountTargetStr}h\`\n` +
        `└ ${accountStatusText}\n\n` +
        `-# 💡 Đã mở khóa nick. Đồng đội tiếp theo có thể nhận ca!\n` +
        `-# 🇰🇷 다음 작업자를 위해 계정 잠금이 해제되었습니다.`
      )
      .setColor('#ED4245')
      .setFooter({ text: 'Gamefy Base Teams • Shift Completed | 퇴근 완료' })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  // 3. NÚT XEM TIẾN ĐỘ CÁ NHÂN (STATUS / 내 근무)
  if (customId === 'btn_status') {
    const summary = await getDaySummaryForUser(user.id);
    const totalText = formatBilingualMins(summary.totalMinutes);
    const remainingText = formatBilingualMins(summary.remainingMinutes);
    const targetHoursStr = Number(summary.targetHours || config.dailyTargetHours).toFixed(1);
    const hoursLeftBeforeCutoff = getHoursUntilCutoff().toFixed(1);

    const rawPercent = (summary.totalMinutes / (summary.targetHours * 60)) * 100;
    const displayPercent = rawPercent > 0 && rawPercent < 1 
      ? rawPercent.toFixed(1) 
      : Math.min(100, Math.round(rawPercent));

    const progressBar = createProgressBar(rawPercent);

    let currentShiftStatus = summary.hasActiveShift 
      ? `🟢 **Đang trong ca / 근무 중** trên Nick \`[${summary.activeAccount}]\` (Đã cày: ${formatBilingualMins(summary.activeMinutes)})`
      : `⚪ **Đang nghỉ ngơi / 휴식 중**`;

    const embed = new EmbedBuilder()
      .setTitle('📊 TIẾN ĐỘ CÁ NHÂN HÔM NAY | 개인 근무 현황')
      .setDescription(
        `• **Trạng thái / 상태:** ${currentShiftStatus}\n` +
        `• **Tiến độ / 달성률:** \`${progressBar}\` **${displayPercent}%**\n\n` +
        `⏱️ **Tổng giờ của bạn / 총 근무 시간:** \`${totalText} / ${targetHoursStr}h\`\n` +
        `⏳ **Còn thiếu / 부족한 시간:** \`${remainingText}\`\n` +
        `⏰ **Hạn chốt ca / 마감:** còn \`${hoursLeftBeforeCutoff}h\` (trước 06:00 sáng mai / 익일 06:00 마감)\n\n` +
        `-# 💡 Bấm nút [🎮 Trạng Thái Nick] để xem tiến độ của từng tài khoản game.\n` +
        `-# 🇰🇷 계정 현황 버튼으로 계정별 진행 상황을 확인할 수 있습니다.`
      )
      .setColor('#00D8F6')
      .setFooter({ text: `Chu kỳ làm việc / 일자: ${summary.workDate}` })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  // 4. NÚT XEM TRẠNG THÁI NICK GAME TOÀN TEAM (ACC STATUS / 계정 현황)
  if (customId === 'btn_acc_status') {
    const result = await buildAccountStatusEmbed();
    if (!result.hasData) {
      return interaction.reply({
        content: result.message,
        ephemeral: true
      });
    }

    return interaction.reply({
      embeds: [result.embed],
      ephemeral: true
    });
  }

  // 5. NÚT XÁC NHẬN BÀN GIAO CA (HANDOFF CONFIRM)
  if (customId.startsWith('btn_confirm_handoff:')) {
    const targetAccount = customId.split(':')[1];
    const result = await handoffShift(user.id, displayName, targetAccount);

    if (!result.success) {
      return interaction.update({
        content: `⚠️ **Bàn giao không thành công:** ${result.message}`,
        embeds: [],
        components: []
      });
    }

    const checkInTimeStr = formatTimeInTz(result.newShift.checkInTime);
    const oldDurationStr = formatBilingualMins(result.oldUser.durationMinutes);

    // Cập nhật phản hồi ngay cho người nhận ca
    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚡ BÀN GIAO CA THÀNH CÔNG | 인수인계 완료')
      .setDescription(
        `> Bạn đã chính thức nhận ca trên Nick **\`[${result.accountCode}]\`**!\n\n` +
        `• **Chốt ca người cũ / 이전 근무자:** <@${result.oldUser.id}> (**${result.oldUser.displayName}**) — Tổng ca: **${oldDurationStr}**\n` +
        `• **Ca mới của bạn / 새 근무:** Bắt đầu lúc **${checkInTimeStr}**\n\n` +
        `📸 **Nhắc nhở / 주의사항:** Vui lòng chụp ảnh màn hình nhận nick gửi vào kênh!\n` +
        `-# 🇰🇷 교대 완료! 이전 작업자 퇴근 처리 및 새로운 근무가 시작되었습니다.`
      )
      .setColor('#57F287')
      .setFooter({ text: 'Gamefy Base Teams • Shift Handover | 인수인계 완료' })
      .setTimestamp();

    await interaction.update({
      embeds: [confirmEmbed],
      components: []
    });

    // Quản lý Discord Roles: Gỡ On-Shift của người cũ, gán cho người mới (chạy sau khi đã update UI)
    if (config.onShiftRoleId && interaction.guild) {
      interaction.guild.members.fetch({ user: result.oldUser.id, time: 1500 })
        .then(oldMember => oldMember?.roles.remove(config.onShiftRoleId))
        .catch(() => {});
      if (member) {
        member.roles.add(config.onShiftRoleId).catch(() => {});
      }
    }

    // Gửi thông báo công khai lên Kênh để toàn team & Quản lý nắm
    try {
      const publicNotice = new EmbedBuilder()
        .setTitle('⚡ THÔNG BÁO BÀN GIAO CA | 교대 알림')
        .setDescription(
          `🎮 **Nick Game / 작업 계정:** \`[${result.accountCode}]\`\n` +
          `📤 **Người giao ca / 이전 작업자:** <@${result.oldUser.id}> (**${result.oldUser.displayName}**) — Đã làm: **${oldDurationStr}**\n` +
          `📥 **Người nhận ca / 인수 작업자:** <@${user.id}> (**${displayName}**) — Bắt đầu lúc: **${checkInTimeStr}**\n\n` +
          `-# 💡 Hệ thống đã tự động chốt ca cho người cũ và tính giờ cho người nhận ca.\n` +
          `-# 🇰🇷 시스템이 이전 작업자를 자동 퇴근 처리하고 새 작업자의 근무를 시작했습니다.`
        )
        .setColor('#5865F2')
        .setFooter({ text: 'Gamefy Base Teams • Shift Handover Notice | 교대 알림' })
        .setTimestamp();

      await interaction.channel.send({ embeds: [publicNotice] });
    } catch (pubErr) {
      console.warn('[HANDOFF PUBLIC NOTICE ERROR]', pubErr.message);
    }
    return;
  }

  // 6. NÚT HỦY BÀN GIAO CA
  if (customId === 'btn_cancel_handoff') {
    return interaction.update({
      content: '👌 Đã hủy thao tác nhận bàn giao ca.\n*(인수인계가 취소되었습니다.)*',
      embeds: [],
      components: []
    });
  }
}

/**
 * Xử lý khi Member chọn mục từ Select Menu (Chọn Nick game)
 */
export async function handleSelectMenuInteraction(interaction) {
  if (interaction.customId === 'select_report_range') {
    const selectedPreset = interaction.values[0];
    const payload = await buildReportPayload({
      preset: selectedPreset,
      guild: interaction.guild
    });
    return interaction.update(payload);
  }

  if (interaction.customId !== 'select_checkin_account') return;

  const { user, member } = interaction;
  const displayName = member?.displayName || user.username;
  const selectedValue = interaction.values[0];

  // 1. Trường hợp người dùng chọn "Nhập nick mới khác" (phải showModal trước khi defer)
  if (selectedValue === '__NEW_ACCOUNT__') {
    const modal = buildCheckinModal();
    return interaction.showModal(modal);
  }

  // 2. Trường hợp chọn nick cụ thể: 'acc:TÊN_ACC'
  const accountCode = selectedValue.startsWith('acc:') ? selectedValue.slice(4) : selectedValue;
  const cleanAccount = normalizeAccountCode(accountCode);

  // Kiểm tra nick này hiện tại có ai đang cày không
  const activeShiftOnAcc = await getActiveShiftByAccount(cleanAccount);

  if (activeShiftOnAcc) {
    if (activeShiftOnAcc.user_id === user.id) {
      return interaction.update({
        content: `⚠️ Bạn chính là người đang cày Nick **\`[${cleanAccount}]\`** này rồi!\n*(이미 해당 계정으로 작업 중입니다.)*`,
        embeds: [],
        components: []
      });
    }

    // NICK ĐANG CÓ NGƯỜI KHÁC CÀY -> HIỂN THỊ NÚT NHẬN BÀN GIAO CA
    const checkInTime = new Date(activeShiftOnAcc.check_in);
    const checkInStr = formatTimeInTz(checkInTime);
    const elapsedMinutes = Math.max(1, Math.round((Date.now() - checkInTime.getTime()) / 60000));
    const elapsedStr = formatBilingualMins(elapsedMinutes);

    const handoffEmbed = new EmbedBuilder()
      .setTitle('⚡ XÁC NHẬN BÀN GIAO CA | 인수인계 확인')
      .setDescription(
        `Nick **\`[${cleanAccount}]\`** hiện đang được ghi nhận cho:\n` +
        `👤 **${activeShiftOnAcc.display_name}** (<@${activeShiftOnAcc.user_id}>)\n` +
        `⏰ **Bắt đầu lúc:** \`${checkInStr}\` (Đã cày: **${elapsedStr}**)\n\n` +
        `Nếu đồng đội **đã rời máy hoặc quên bấm "Hết Ca"**, bạn hãy bấm **[Nhận Bàn Giao Ca]**:\n` +
        `• 1. Tự động chốt ca cho **${activeShiftOnAcc.display_name}**\n` +
        `• 2. Bắt đầu tính giờ ngay cho bạn (**${displayName}**)\n` +
        `• 3. Ghi log kiểm toán và gửi thông báo vào kênh\n\n` +
        `-# 🇰🇷 이전 작업자가 퇴근을 잊은 경우, 아래 인수인계 버튼을 눌러 교대하세요.`
      )
      .setColor('#FEE75C');

    const handoffRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_confirm_handoff:${cleanAccount}`)
        .setLabel('⚡ Nhận Bàn Giao Ca | 인수인계')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('btn_cancel_handoff')
        .setLabel('❌ Hủy | 취소')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.update({
      embeds: [handoffEmbed],
      components: [handoffRow]
    });
  }

  // NICK ĐANG TRỐNG -> VÀO CA BÌNH THƯỜNG TRỰC TIẾP!
  const result = await startShiftWithAccount(user.id, displayName, cleanAccount);

  if (!result.success) {
    return interaction.update({
      content: `⚠️ **Thông báo / 알림:** ${result.message}`,
      embeds: [],
      components: []
    });
  }

  // Gán role On-Shift nếu có (chạy bất đồng bộ để không chặn phản hồi UI)
  if (config.onShiftRoleId && member) {
    member.roles.add(config.onShiftRoleId).catch(err => {
      console.warn('[ROLE WARN] Không thể gán role On-Shift:', err.message);
    });
  }

  const checkInTimeStr = formatTimeInTz(result.checkInTime);
  const accSummary = await getAccountDailySummary(result.accountCode, result.workDate);
  const accDoneSoFar = formatBilingualMins(accSummary.completedMinutes);
  const accTargetStr = Number(accSummary.targetHours || 8.0).toFixed(1);

  const embed = new EmbedBuilder()
    .setTitle('🟢 CHECK-IN THÀNH CÔNG | 출근 완료')
    .setDescription(
      `> **Nhân sự / 근무자:** **${displayName}**  •  **Giờ vào / 출근 시간:** **${checkInTimeStr}**\n\n` +
      `🎮 **Nick Game / 작업 계정:** \`[${result.accountCode}]\`\n` +
      `📊 **Tiến độ Nick hôm nay / 오늘 계정 누적:** \`${accDoneSoFar} / ${accTargetStr}h\`\n\n` +
      `📸 **Lưu ý / 주의사항:** Chụp ảnh màn hình nhận nick gửi vào kênh này!\n` +
      `-# 🇰🇷 작업 시작 인증샷을 전송하고 교대 시 퇴근 버튼을 꼭 눌러주세요.`
    )
    .setColor('#57F287')
    .setFooter({ text: 'Gamefy Base Teams • Shift Started | 출근 완료' })
    .setTimestamp();

  return interaction.update({
    embeds: [embed],
    components: []
  });
}

/**
 * Xử lý khi Member nộp Form Modal (Check-in với Nick Game thủ công)
 */
export async function handleModalInteraction(interaction) {
  if (interaction.customId !== 'modal_checkin') return;

  const { user, member } = interaction;
  const displayName = member?.displayName || user.username;
  const accountCode = interaction.fields.getTextInputValue('account_code_input').trim();
  const note = interaction.fields.getTextInputValue('note_input')?.trim() || '';

  const result = await startShiftWithAccount(user.id, displayName, accountCode, note);

  if (!result.success) {
    if (result.errorType === 'ACCOUNT_OCCUPIED') {
      const cleanCode = normalizeAccountCode(accountCode);
      const handoffRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_confirm_handoff:${cleanCode}`)
          .setLabel('⚡ Nhận Bàn Giao Ca | 인수인계')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('btn_cancel_handoff')
          .setLabel('❌ Hủy | 취소')
          .setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({
        content: `⛔ **TRÙNG NICK GAME / 계정 중복 경고:**\n` +
                 `${result.message}\n\n` +
                 `👉 Nếu đồng đội quên chốt ca, bạn có thể bấm **[Nhận Bàn Giao Ca]** bên dưới:`,
        components: [handoffRow],
        ephemeral: true
      });
    }

    return interaction.reply({
      content: `⚠️ **Thông báo / 알림:** ${result.message}`,
      ephemeral: true
    });
  }

  // Gán role On-Shift nếu có (chạy bất đồng bộ)
  if (config.onShiftRoleId && member) {
    member.roles.add(config.onShiftRoleId).catch(err => {
      console.warn('[ROLE WARN] Không thể gán role On-Shift:', err.message);
    });
  }

  const checkInTimeStr = formatTimeInTz(result.checkInTime);
  const noteStr = note ? `\n• **Ghi chú:** *${note}*` : '';

  const accSummary = await getAccountDailySummary(result.accountCode, result.workDate);
  const accDoneSoFar = formatBilingualMins(accSummary.completedMinutes);
  const accTargetStr = Number(accSummary.targetHours || 8.0).toFixed(1);

  const embed = new EmbedBuilder()
    .setTitle('🟢 CHECK-IN THÀNH CÔNG | 출근 완료')
    .setDescription(
      `> **Nhân sự / 근무자:** **${displayName}**  •  **Giờ vào / 출근 시간:** **${checkInTimeStr}**\n\n` +
      `🎮 **Nick Game / 작업 계정:** \`[${result.accountCode}]\`\n` +
      `📊 **Tiến độ Nick hôm nay / 오늘 계정 누적:** \`${accDoneSoFar} / ${accTargetStr}h\`${noteStr}\n\n` +
      `📸 **Lưu ý / 주의사항:** Chụp ảnh màn hình nhận nick gửi vào kênh này!\n` +
      `-# 🇰🇷 교대 시 인증샷을 전송하고 퇴근 버튼을 꼭 눌러주세요.`
    )
    .setColor('#57F287')
    .setFooter({ text: 'Gamefy Base Teams • Shift Started | 출근 완료' })
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}
