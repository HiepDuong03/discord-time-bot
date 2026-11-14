import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import {
  forceEndShiftByUser,
  forceReleaseAccount,
  getAllActiveShifts,
  normalizeAccountCode
} from '../services/shiftService.js';
import { config } from '../config/env.js';

const FORCE_CHECKOUT_REASONS = [
  'Quản lý cưỡng chế kết thúc ca',
  'Nhân viên quên bấm Hết ca (퇴근 버튼 누락)',
  'Ngủ quên khi đang cày (작업 중 수면)',
  'Mất điện / Mất kết nối mạng (정전/네트워크 끊김)',
  'Đổi ca khẩn cấp (긴급 교대)'
];

export const data = new SlashCommandBuilder()
  .setName('force-checkout')
  .setDescription('Cưỡng chế kết thúc ca / Giải phóng Nick kẹt (Quản lý) / 강제 퇴근')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(option =>
    option.setName('account')
      .setDescription('Chọn Nick đang có người cày cần giải phóng / 해제할 계정 선택')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Hoặc chọn thành viên cần kết thúc ca / 퇴근시킬 팀원 선택')
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName('reason')
      .setDescription('Lý do (chọn gợi ý hoặc gõ tay, mặc định tự điền) / 사유')
      .setRequired(false)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  const query = focusedOption.value.trim().toLowerCase();

  if (focusedOption.name === 'account') {
    const activeShifts = await getAllActiveShifts().catch(() => []);
    const nowMs = Date.now();
    const choices = activeShifts
      .map(s => {
        const mins = Math.max(1, Math.round((nowMs - new Date(s.check_in).getTime()) / 60000));
        return {
          name: `🟢 ${s.account_code} • Đang cày: ${s.display_name} (${mins}p)`.slice(0, 100),
          value: s.account_code
        };
      })
      .filter(c => !query || c.name.toLowerCase().includes(query) || c.value.toLowerCase().includes(query));

    if (choices.length === 0 && !query) {
      return interaction.respond([]).catch(() => {});
    }
    return interaction.respond(choices.slice(0, 25)).catch(() => {});
  }

  if (focusedOption.name === 'reason') {
    const choices = FORCE_CHECKOUT_REASONS
      .filter(r => !query || r.toLowerCase().includes(query))
      .map(r => ({ name: r, value: r }));
    return interaction.respond(choices.slice(0, 25)).catch(() => {});
  }
}

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('user');
  const targetAccount = interaction.options.getString('account');
  const reason = interaction.options.getString('reason')?.trim() || 'Quản lý cưỡng chế kết thúc ca';
  const leaderName = interaction.member?.displayName || interaction.user.username;

  if (!targetUser && !targetAccount) {
    return interaction.reply({
      content: '❌ Bạn phải chọn ít nhất 1 trong 2: **Chọn Thành Viên** (`user`) HOẶC **Nhập Mã Nick** (`account`) để giải phóng!\n*(user 또는 account 중 하나를 입력해야 합니다.)*',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: false });

  try {
    let result;
    let targetName = '';

    if (targetUser) {
      result = await forceEndShiftByUser(targetUser.id, leaderName, reason);
      targetName = `<@${targetUser.id}>`;
    } else {
      const cleanAcc = normalizeAccountCode(targetAccount);
      result = await forceReleaseAccount(cleanAcc, leaderName, reason);
      targetName = result.userId ? `<@${result.userId}> (\`[${cleanAcc}]\`)` : `Nick \`[${cleanAcc}]\``;
    }

    if (!result.success) {
      return interaction.editReply({
        content: `⚠️ **Thông báo / 알림:** ${result.message}`
      });
    }

    // Gỡ role On-Shift cho user vừa bị chốt ca (cả khi chọn user lẫn chọn account)
    if (config.onShiftRoleId && interaction.guild && result.userId) {
      try {
        const gm = await interaction.guild.members.fetch(result.userId);
        if (gm) await gm.roles.remove(config.onShiftRoleId);
      } catch {}
    }

    const embed = new EmbedBuilder()
      .setTitle('⛔ CƯỠNG CHẾ KẾT THÚC CA THÀNH CÔNG | 강제 퇴근 처리 완료')
      .setDescription(
        `• **Đối tượng / 대상:** ${targetName}\n` +
        `• **Nick game / 작업 계정:** \`[${result.accountCode}]\`\n` +
        `• **Thời gian ca / 근무 시간:** **${result.durationMinutes} phút / 분** (${(result.durationMinutes / 60).toFixed(2)}h)\n` +
        `• **Người thực hiện / 처리자:** **${leaderName}**\n` +
        `• **Lý do / 사유:** *${reason}*\n\n` +
        `-# 💡 Đã giải phóng nick game. Nhân sự tiếp theo có thể nhận ca ngay!\n` +
        `-# 🇰🇷 계정이 정상적으로 잠금 해제되어 교대 작업이 가능합니다.`
      )
      .setColor('#ED4245')
      .setFooter({ text: 'Gamefy Base Teams • Force Checkout Service | 강제 퇴근 관리' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[FORCE CHECKOUT ERROR]', error);
    return interaction.editReply({
      content: `❌ Lỗi khi cưỡng chế kết thúc ca / 오류 발생: ${error.message}`
    });
  }
}
