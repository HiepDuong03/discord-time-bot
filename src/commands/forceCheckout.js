import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { forceEndShiftByUser, forceReleaseAccount, normalizeAccountCode } from '../services/shiftService.js';
import { config } from '../config/env.js';

export const data = new SlashCommandBuilder()
  .setName('force-checkout')
  .setDescription('Cưỡng chế kết thúc ca / Giải phóng Nick kẹt khi member ngủ quên (Quản lý) / 강제 퇴근')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(option =>
    option.setName('reason')
      .setDescription('Lý do cưỡng chế (ví dụ: ngủ quên, mất điện, đổi ca khẩn...) / 사유')
      .setRequired(true)
  )
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Chọn thành viên cần kết thúc ca / 퇴근시킬 팀원 선택')
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName('account')
      .setDescription('Mã Nick game cần giải phóng ngay (ví dụ: Acc_01) / 해제할 계정 코드')
      .setRequired(false)
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('user');
  const targetAccount = interaction.options.getString('account');
  const reason = interaction.options.getString('reason');
  const leaderName = interaction.member?.displayName || interaction.user.username;

  if (!targetUser && !targetAccount) {
    return interaction.reply({
      content: '❌ Bạn phải chọn ít nhất 1 trong 2: **Chọn Thành Viên** (`user`) HOẶC **Nhập Mã Nick** (`account`) để giải phóng!\n*(user 또는 account 중 하나를 입력해야 합니다.)*',
      ephemeral: true
    });
  }

  try {
    let result;
    let targetName = '';

    if (targetUser) {
      result = await forceEndShiftByUser(targetUser.id, leaderName, reason);
      targetName = `<@${targetUser.id}>`;

      // Gỡ role On-Shift nếu có
      if (config.onShiftRoleId && interaction.guild) {
        try {
          const gm = await interaction.guild.members.fetch(targetUser.id);
          if (gm) await gm.roles.remove(config.onShiftRoleId);
        } catch {}
      }
    } else {
      const cleanAcc = normalizeAccountCode(targetAccount);
      result = await forceReleaseAccount(cleanAcc, leaderName, reason);
      targetName = `Nick \`[${cleanAcc}]\``;
    }

    if (!result.success) {
      return interaction.reply({
        content: `⚠️ **Thông báo / 알림:** ${result.message}`,
        ephemeral: true
      });
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

    return interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('[FORCE CHECKOUT ERROR]', error);
    return interaction.reply({
      content: `❌ Lỗi khi cưỡng chế kết thúc ca / 오류 발생: ${error.message}`,
      ephemeral: true
    });
  }
}
