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
    .setTitle('🎮 BẢNG CHẤM CÔNG & QUẢN LÝ CA | 출퇴근 및 근무 관리')
    .setDescription(
      '**Vui lòng bấm nút bên dưới để ghi nhận giờ làm / 아래 버튼을 눌러 근무 시간을 기록하세요:**\n\n' +
      '🟢 **VÀO CA | 출근:** Bắt đầu ca cày game (bấm giờ) / 게임 작업 및 근무 시작\n' +
      '🔴 **HẾT CA | 퇴근:** Kết thúc ca / Nghỉ ngơi / 작업 종료 및 휴식\n' +
      '⏱️ **TIẾN ĐỘ | 근무 현황:** Xem tổng giờ đã làm hôm nay / 오늘의 근무 시간 확인\n\n' +
      '📌 **Quy định làm việc / 근무 규정:**\n' +
      '• **Chỉ tiêu tối thiểu / 일일 최소 근무:** `8.0h / ngày (일)`\n' +
      '• **Chốt chu kỳ ngày / 일일 마감 시간:** `06:00 AM sáng hôm sau (익일 06:00)`\n' +
      '• *Hỗ trợ chia nhiều ca trong ngày, tự động cộng dồn / 분할 근무 가능, 시간 자동 합산*'
    )
    .setColor('#5865F2')
    .setFooter({ text: 'AURA Time Tracking System • 자동 근무 관리 시스템' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_checkin')
      .setLabel('🟢 Vào Ca | 출근')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_checkout')
      .setLabel('🔴 Hết Ca | 퇴근')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('btn_status')
      .setLabel('⏱️ Tiến Độ | 근무 현황')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.channel.send({
    embeds: [embed],
    components: [row]
  });

  return interaction.reply({
    content: '✅ Đã tạo Bảng Chấm Công song ngữ (Việt - Hàn) thành công! / 출퇴근 관리 패널이 생성되었습니다.',
    ephemeral: true
  });
}
