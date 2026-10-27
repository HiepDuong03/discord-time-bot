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
  normalizeAccountCode,
  getWorkDate
} from '../services/shiftService.js';
import { getHoursUntilCutoff } from '../services/reminderService.js';
import { buildAccountStatusEmbed } from '../commands/accStatus.js';
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

function createProgressBar(percent, length = 12) {
  const filled = Math.min(length, Math.max(0, Math.round((percent / 100) * length)));
  const empty = length - filled;
  return `${'▰'.repeat(filled)}${'▱'.repeat(empty)}`;
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

    const activeShift = await getActiveShift(user.id);
    if (activeShift) {
      return interaction.reply({
        content: `⚠️ **Bạn đang có ca cày dở dang! / 이미 근무 중입니다:**\n` +
                 `• Nick đang cày: \`[${activeShift.account_code}]\`\n` +
                 `• Giờ vào ca: **${new Date(activeShift.check_in).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}**\n\n` +
                 `👉 Vui lòng bấm **[🔴 Hết Ca | 퇴근]** trước khi đổi sang Nick khác!`,
        ephemeral: true
      });
    }

    const accList = await getAllAccountsTodaySummary();

    // Nếu chưa có nick nào trong danh mục chính thức, nhắc Quản lý thêm nick
    if (accList.length === 0) {
      return interaction.reply({
        content: `ℹ️ Chưa có Nick game nào trong danh mục hoạt động.\n` +
                 `👉 Quản lý vui lòng dùng lệnh \`/acc-manage add code:<mã_nick>\` để thêm Nick trước khi nhân viên vào ca!\n` +
                 `-# 🇰🇷 등록된 계정이 없습니다. 관리자에게 계정 등록(/acc-manage add)을 요청하세요.`,
        ephemeral: true
      });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_checkin_account')
      .setPlaceholder('🎮 Chọn Nick game bạn muốn cày / 계정을 선택하세요...');

    // Lấy tối đa 25 nick chính thức đang hoạt động
    const displayList = accList.slice(0, 25);
    const options = [];

    for (const acc of displayList) {
      const totalH = (acc.totalMinutes / 60).toFixed(1);
      if (acc.hasActiveShift) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Nick [${acc.accountCode}] (${totalH}h / 8.0h)`)
            .setValue(`acc:${acc.accountCode}`)
            .setDescription(`🔴 Có người cày: ${acc.activeFarmerName.slice(0, 20)} (${acc.activeMinutes}p) - Bàn giao`)
            .setEmoji('🔴')
        );
      } else if (acc.isAchieved) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Nick [${acc.accountCode}] (${totalH}h / 8.0h)`)
            .setValue(`acc:${acc.accountCode}`)
            .setDescription(`🌟 Đã hoàn thành 100% SLA hôm nay`)
            .setEmoji('✅')
        );
      } else {
        const remH = (acc.remainingMinutes / 60).toFixed(1);
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Nick [${acc.accountCode}] (${totalH}h / 8.0h)`)
            .setValue(`acc:${acc.accountCode}`)
            .setDescription(`🟢 Đang trống • Còn thiếu ${remH}h`)
            .setEmoji('🟢')
        );
      }
    }

    selectMenu.addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
      .setTitle('🎮 CHỌN NICK CÀY HÔM NAY | 출근 계정 선택')
      .setDescription(
        `> Vui lòng chọn tài khoản từ danh sách bên dưới:\n\n` +
        `• 🟢 **Nick Đang Trống:** Chọn để nhận ca và bắt đầu tính giờ ngay.\n` +
        `• 🔴 **Nick Đang Cày:** Chọn để **Nhận Bàn Giao Ca** nếu đồng đội quên chốt ca.\n\n` +
        `-# 🇰🇷 아래 메뉴에서 작업할 계정을 선택하세요 (작업 중인 계정은 교대 가능).`
      )
      .setColor('#57F287');

    return interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });
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
      ? '✅ **Nick này ĐÃ ĐẠT chỉ tiêu 8h hôm nay! / 오늘 목표 8시간 달성!**'
      : `⏳ **Nick [${result.accountCode}] còn thiếu:** **${formatMinutes(Math.max(0, 480 - result.accountTotalToday))}** để đủ 8h SLA.`;

    const embed = new EmbedBuilder()
      .setTitle('🔴 KẾT THÚC CA LÀM VIỆC | 퇴근 완료')
      .setDescription(
        `> **Nick vừa cày:** \`[${result.accountCode}]\`  •  **Ca vừa rồi:** **${shiftDurationText}**\n\n` +
        `👤 **Tổng giờ của bạn hôm nay:** \`${memberTotalText} / 8.0h\`\n` +
        `🛡️ **Tổng giờ Nick [${result.accountCode}]:** \`${accountTotalText} / 8.0h\`\n` +
        `└ ${accountStatusText}\n\n` +
        `-# 💡 Đã mở khóa nick. Đồng đội tiếp theo có thể nhận ca!\n` +
        `-# 🇰🇷 다음 작업자를 위해 계정 잠금이 해제되었습니다.`
      )
      .setColor('#ED4245')
      .setFooter({ text: 'Gamefy Base Teams • Shift Completed' })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  // 3. NÚT XEM TIẾN ĐỘ CÁ NHÂN (STATUS / 내 근무)
  if (customId === 'btn_status') {
    const summary = await getDaySummaryForUser(user.id);
    const totalText = formatMinutes(summary.totalMinutes);
    const remainingText = formatMinutes(summary.remainingMinutes);
    const hoursLeftBeforeCutoff = getHoursUntilCutoff().toFixed(1);

    const rawPercent = (summary.totalMinutes / (summary.targetHours * 60)) * 100;
    const displayPercent = rawPercent > 0 && rawPercent < 1 
      ? rawPercent.toFixed(1) 
      : Math.min(100, Math.round(rawPercent));

    const progressBar = createProgressBar(rawPercent);

    let currentShiftStatus = summary.hasActiveShift 
      ? `🟢 **Đang trong ca** trên Nick \`[${summary.activeAccount}]\` (Đã cày: ${formatMinutes(summary.activeMinutes)})`
      : `⚪ **Đang nghỉ ngơi**`;

    const embed = new EmbedBuilder()
      .setTitle('📊 TIẾN ĐỘ CÁ NHÂN HÔM NAY | 개인 근무 현황')
      .setDescription(
        `• **Trạng thái:** ${currentShiftStatus}\n` +
        `• **Tiến độ:** \`${progressBar}\` **${displayPercent}%**\n\n` +
        `⏱️ **Tổng giờ của bạn:** \`${totalText} / 8.0h\`\n` +
        `⏳ **Còn thiếu:** \`${remainingText}\`\n` +
        `⏰ **Hạn chốt ca:** còn \`${hoursLeftBeforeCutoff}h\` (trước 06:00 sáng mai)\n\n` +
        `-# 💡 Bấm nút [🎮 Trạng Thái Nick] để xem tiến độ của từng tài khoản game.\n` +
        `-# 🇰🇷 계정 현황 버튼으로 계정별 진행 상황을 확인할 수 있습니다.`
      )
      .setColor('#00D8F6')
      .setFooter({ text: `Chu kỳ làm việc: ${summary.workDate}` })
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

    // Quản lý Discord Roles: Gỡ On-Shift của người cũ, gán cho người mới
    if (config.onShiftRoleId && interaction.guild) {
      try {
        const oldMember = await interaction.guild.members.fetch(result.oldUser.id).catch(() => null);
        if (oldMember) {
          await oldMember.roles.remove(config.onShiftRoleId).catch(() => {});
        }
        if (member) {
          await member.roles.add(config.onShiftRoleId).catch(() => {});
        }
      } catch (err) {
        console.warn('[HANDOFF ROLE WARN]', err.message);
      }
    }

    const checkInTimeStr = result.newShift.checkInTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const oldDurationStr = formatMinutes(result.oldUser.durationMinutes);

    // Cập nhật phản hồi cho người nhận ca
    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚡ BÀN GIAO CA THÀNH CÔNG | 인수인계 완료')
      .setDescription(
        `> Bạn đã chính thức nhận ca trên Nick **\`[${result.accountCode}]\`**!\n\n` +
        `• **Chốt ca người cũ:** <@${result.oldUser.id}> (**${result.oldUser.displayName}**) — Tổng ca: **${oldDurationStr}**\n` +
        `• **Ca mới của bạn:** Bắt đầu lúc **${checkInTimeStr}**\n\n` +
        `📸 **Nhắc nhở:** Vui lòng chụp ảnh màn hình nhận nick gửi vào kênh!\n` +
        `-# 🇰🇷 교대 완료! 이전 작업자 퇴근 처리 및 새로운 근무가 시작되었습니다.`
      )
      .setColor('#57F287')
      .setTimestamp();

    await interaction.update({
      embeds: [confirmEmbed],
      components: []
    });

    // Gửi thông báo công khai lên Kênh để toàn team & Quản lý nắm
    try {
      const publicNotice = new EmbedBuilder()
        .setTitle('⚡ THÔNG BÁO BÀN GIAO CA | 교대 알림')
        .setDescription(
          `🎮 **Nick Game (계정):** \`[${result.accountCode}]\`\n` +
          `📤 **Người giao ca:** <@${result.oldUser.id}> (**${result.oldUser.displayName}**) — Đã làm: **${oldDurationStr}**\n` +
          `📥 **Người nhận ca:** <@${user.id}> (**${displayName}**) — Bắt đầu lúc: **${checkInTimeStr}**\n\n` +
          `-# 💡 Hệ thống đã tự động chốt ca cho người cũ và tính giờ cho người nhận ca.`
        )
        .setColor('#5865F2')
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
  if (interaction.customId !== 'select_checkin_account') return;

  const { user, member } = interaction;
  const displayName = member?.displayName || user.username;
  const selectedValue = interaction.values[0];

  // 1. Trường hợp người dùng chọn "Nhập nick mới khác"
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
    const checkInStr = checkInTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const elapsedMinutes = Math.max(1, Math.round((Date.now() - checkInTime.getTime()) / 60000));
    const elapsedStr = formatMinutes(elapsedMinutes);

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

  // Gán role On-Shift nếu có
  if (config.onShiftRoleId && member) {
    try {
      await member.roles.add(config.onShiftRoleId);
    } catch (err) {
      console.warn('[ROLE WARN] Không thể gán role On-Shift:', err.message);
    }
  }

  const checkInTimeStr = result.checkInTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const accSummary = await getAccountDailySummary(result.accountCode, result.workDate);
  const accDoneSoFar = formatMinutes(accSummary.completedMinutes);

  const embed = new EmbedBuilder()
    .setTitle('🟢 CHECK-IN THÀNH CÔNG | 출근 완료')
    .setDescription(
      `> Nhân sự: **${displayName}**  •  Giờ vào: **${checkInTimeStr}**\n\n` +
      `🎮 **Nick Game (계정):** \`[${result.accountCode}]\`\n` +
      `📊 **Tiến độ Nick hôm nay:** \`${accDoneSoFar} / 8.0h\`\n\n` +
      `📸 **Lưu ý:** Chụp ảnh màn hình nhận nick gửi vào kênh này!\n` +
      `-# 🇰🇷 작업 시작 인증샷을 전송하고 교대 시 퇴근 버튼을 꼭 눌러주세요.`
    )
    .setColor('#57F287')
    .setFooter({ text: 'Gamefy Base Teams • Shift Started' })
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

  // Gán role On-Shift nếu có
  if (config.onShiftRoleId && member) {
    try {
      await member.roles.add(config.onShiftRoleId);
    } catch (err) {
      console.warn('[ROLE WARN] Không thể gán role On-Shift:', err.message);
    }
  }

  const checkInTimeStr = result.checkInTime.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const noteStr = note ? `\n• **Ghi chú:** *${note}*` : '';

  // Lấy tiến độ hiện tại của Nick này trong ngày để báo cho member biết
  const accSummary = await getAccountDailySummary(result.accountCode, result.workDate);
  const accDoneSoFar = formatMinutes(accSummary.completedMinutes);

  const embed = new EmbedBuilder()
    .setTitle('🟢 CHECK-IN THÀNH CÔNG | 출근 완료')
    .setDescription(
      `> Nhân sự: **${displayName}**  •  Giờ vào: **${checkInTimeStr}**\n\n` +
      `🎮 **Nick Game (계정):** \`[${result.accountCode}]\`\n` +
      `📊 **Tiến độ Nick hôm nay:** \`${accDoneSoFar} / 8.0h\`${noteStr}\n\n` +
      `📸 **Lưu ý:** Chụp ảnh màn hình nhận nick gửi vào kênh này!\n` +
      `-# 🇰🇷 교대 시 인증샷을 전송하고 퇴근 버튼을 꼭 눌러주세요.`
    )
    .setColor('#57F287')
    .setFooter({ text: 'Gamefy Base Teams • Shift Started' })
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}
