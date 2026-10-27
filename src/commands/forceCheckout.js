import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
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
      content: '❌ Bạn phải chọn ít nhất 1 trong 2: **Chọn Thành Viên** (`user`) HOẶC **Nhập Mã Nick** (`account`) để giải phóng!',
      ephemeral: true
    });
  }

  try {
    let result;
    let targetName = '';

    if (targetUser) {
      result = forceEndShiftByUser(targetUser.id, leaderName, reason);
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
      result = forceReleaseAccount(cleanAcc, leaderName, reason);
      targetName = `Nick \`[${cleanAcc}]\``;
    }

    if (!result.success) {
      return interaction.reply({
        content: `⚠️ **Không thể giải phóng:** ${result.message}`,
        ephemeral: true
      });
    }

    const durationHours = (result.durationMinutes / 60).toFixed(2);

    return interaction.reply({
      content: `⚡ **CƯỠNG CHẾ GIẢI PHÓNG THÀNH CÔNG! / 강제 퇴근 및 계정 해제 완료!**\n\n` +
               `• **Đối tượng / 대상:** ${targetName}\n` +
               `• **Nick được mở khóa / 해제된 계정:** \`[${result.accountCode}]\`\n` +
               `• **Thời lượng ca đã chốt:** **${durationHours}h** (${result.durationMinutes} phút)\n` +
               `• **Người thực hiện:** **${leaderName}**\n` +
               `• **Lý do / 사유:** *${reason}*\n\n` +
               `🟢 **Trạng thái:** Nick \`[${result.accountCode}]\` hiện đã TRỐNG, anh em khác có thể xoay ca vào cày ngay!`,
      ephemeral: false
    });
  } catch (error) {
    console.error('[FORCE_CHECKOUT ERROR]', error);
    return interaction.reply({
      content: `❌ Lỗi khi thực hiện cưỡng chế: ${error.message}`,
      ephemeral: true
    });
  }
}
