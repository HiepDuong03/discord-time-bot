import { 
  SlashCommandBuilder, 
  PermissionFlagsBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('setup-panel')
  .setDescription('Tạo bảng điều khiển Chấm công song ngữ (Việt - Hàn) / 출퇴근 관리 패널 생성')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ GAMEFY OPERATIONS HUB | 작업 관리')
    .setDescription(
      '> **HỆ THỐNG ĐIỂM DANH & QUẢN LÝ CA LÀM VIỆC**\n' +
      '> *Game Farming Shift & Attendance System*\n\n' +
      '```yaml\n' +
      '• Chỉ tiêu ngày / 일일 목표 : 8.0h / ngày (일)\n' +
      '• Chốt chu kỳ / 마감 시간   : 06:00 AM (sáng hôm sau)\n' +
      '• Trạng thái / 시스템       : Sẵn sàng (ONLINE)\n' +
      '```\n' +
      '📸 **Lưu ý:** Gửi ảnh chụp màn hình nhận/trả acc lên kênh này sau khi bấm nút.\n' +
      '-# 🇰🇷 작업 시작 및 종료 시 인증 스크린샷을 이 채널에 전송해 주세요.\n' +
      '-# 💡 Bấm nút bên dưới để ghi nhận giờ làm | 아래 버튼을 눌러 출퇴근을 기록하세요.'
    )
    .setColor('#57F287')
    .setFooter({ text: 'Gamefy Base Teams • Time & Account Rotation Tracker | 출퇴근 및 계정 관리' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_checkin')
      .setLabel('🟢 Vào Ca | 출근')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_checkout')
      .setLabel('🔴 Hết Ca | 퇴근')
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_status')
      .setLabel('👤 Giờ Của Tôi | 내 근무')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_acc_status')
      .setLabel('🎮 Trạng Thái Nick | 계정 현황')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.channel.send({
    embeds: [embed],
    components: [row1, row2]
  });

  return interaction.reply({
    content: '✅ Đã khởi tạo Bảng Chấm Công Gaming HUD thành công! / 출퇴근 관리 패널이 생성되었습니다.',
    ephemeral: true
  });
}
