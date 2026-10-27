import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { adjustShiftTime } from '../services/shiftService.js';

export const data = new SlashCommandBuilder()
  .setName('adjust-time')
  .setDescription('Điều chỉnh (bù hoặc trừ) số phút làm việc của nhân sự / 근무 시간 수동 조정')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Chọn thành viên cần điều chỉnh / 조정할 근무자 선택')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName('minutes')
      .setDescription('Số phút điều chỉnh (+/- phút, ví dụ: 60 hoặc -30) / 조정 시간(분)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('reason')
      .setDescription('Lý do điều chỉnh (lưu audit log) / 조정 사유')
      .setRequired(true)
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('user');
  const minutes = interaction.options.getInteger('minutes');
  const reason = interaction.options.getString('reason');
  const leaderName = interaction.member?.displayName || interaction.user.username;

  try {
    const result = await adjustShiftTime(targetUser.id, minutes, reason, leaderName);
    const sign = minutes > 0 ? '+' : '';

    const embed = new EmbedBuilder()
      .setTitle('⏱️ ĐIỀU CHỈNH GIỜ LÀM VIỆC | 근무 시간 조정 완료')
      .setDescription(
        `• **Nhân sự / 대상 작업자:** <@${targetUser.id}> (${targetUser.username})\n` +
        `• **Thay đổi / 시간 변동:** **${sign}${minutes} phút / 분** (${(minutes / 60).toFixed(2)}h)\n` +
        `• **Ngày áp dụng / 적용 일자:** \`${result.workDate}\`\n` +
        `• **Người duyệt / 승인자:** **${leaderName}**\n` +
        `• **Lý do / 조정 사유:** *${reason}*\n\n` +
        `-# 💡 Đã cập nhật vào cơ sở dữ liệu và ghi log kiểm toán.\n` +
        `-# 🇰🇷 근무 시간이 수정되었으며 감사 로그에 안전하게 기록되었습니다.`
      )
      .setColor('#5865F2')
      .setFooter({ text: 'Gamefy Base Teams • Time Adjustment | 근무 조정' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('[ADJUST ERROR]', error);
    return interaction.reply({
      content: `❌ Lỗi khi điều chỉnh giờ / 오류 발생: ${error.message}`,
      ephemeral: true
    });
  }
}
