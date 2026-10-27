import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { adjustShiftTime } from '../services/shiftService.js';

export const data = new SlashCommandBuilder()
  .setName('adjust-time')
  .setDescription('Điều chỉnh (bù hoặc trừ) số phút làm việc của nhân sự')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Chọn thành viên cần điều chỉnh')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName('minutes')
      .setDescription('Số phút điều chỉnh (Ví dụ: 60 để cộng 1 tiếng, -30 để trừ 30 phút)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('reason')
      .setDescription('Lý do điều chỉnh (bắt buộc để lưu audit log)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('user');
  const minutes = interaction.options.getInteger('minutes');
  const reason = interaction.options.getString('reason');
  const leaderName = interaction.member?.displayName || interaction.user.username;

  try {
    const result = adjustShiftTime(targetUser.id, minutes, reason, leaderName);
    const sign = minutes > 0 ? '+' : '';

    return interaction.reply({
      content: `✅ **ĐÃ ĐIỀU CHỈNH GIỜ THÀNH CÔNG!**\n` +
               `• Nhân sự: <@${targetUser.id}>\n` +
               `• Thay đổi: **${sign}${minutes} phút** (${(minutes / 60).toFixed(2)} giờ)\n` +
               `• Ngày áp dụng: **${result.workDate}**\n` +
               `• Người duyệt: **${leaderName}**\n` +
               `• Lý do: *${reason}*`,
      ephemeral: false
    });
  } catch (error) {
    console.error('[ADJUST ERROR]', error);
    return interaction.reply({
      content: `❌ Lỗi khi điều chỉnh giờ: ${error.message}`,
      ephemeral: true
    });
  }
}
