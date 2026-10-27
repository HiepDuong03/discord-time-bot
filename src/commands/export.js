import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { exportTimesheetToExcel } from '../services/exportService.js';

export const data = new SlashCommandBuilder()
  .setName('export')
  .setDescription('Xuất file Excel tổng hợp số giờ làm theo khoảng ngày để tính lương')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(option =>
    option.setName('from')
      .setDescription('Ngày bắt đầu (Định dạng: YYYY-MM-DD, ví dụ: 2026-10-01)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('to')
      .setDescription('Ngày kết thúc (Định dạng: YYYY-MM-DD, ví dụ: 2026-10-15)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const fromDate = interaction.options.getString('from').trim();
  const toDate = interaction.options.getString('to').trim();

  // Validate định dạng YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
    return interaction.reply({
      content: '❌ Định dạng ngày không đúng! Vui lòng nhập theo dạng `YYYY-MM-DD` (Ví dụ: `2026-10-01`).',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: false });

  try {
    const result = await exportTimesheetToExcel(fromDate, toDate);
    const attachment = new AttachmentBuilder(result.filePath, { name: result.fileName });

    const embed = new EmbedBuilder()
      .setTitle('📊 DỮ LIỆU GIỜ LÀM & AUDIT ĐÃ SẴN SÀNG! | 근무 시간 & 감사 데이터')
      .setDescription(
        `> **BÁO CÁO TỔNG HỢP & KIỂM TOÁN GIỜ CÀY GAME**\n` +
        `> *Game Farming Timesheet & SLA Audit Report*\n\n` +
        '```yaml\n' +
        `• Kỳ thống kê / 기간     : ${fromDate} ➔ ${toDate}\n` +
        `• Quân số / 인원         : ${result.userCount} người (명)\n` +
        `• Tổng giờ làm / 총 근무 : ${result.grandTotalHours}h (toàn đội)\n` +
        '```\n' +
        '📁 **Cấu trúc 3 Sheet trong File Excel đính kèm:**\n' +
        '• **Sheet 1:** Tổng giờ làm từ khoảng thời gian đó\n' +
        '• **Sheet 2:** Báo Cáo SLA Từng Nick (Account SLA)\n' +
        '• **Sheet 3:** Nhật Ký Ra Vào Chi Tiết (Raw Shifts Log)\n\n' +
        '-# 🇰🇷 첨부된 엑셀 파일(3개 시트)을 다운로드하여 정산 및 계정 감사를 확인하세요.'
      )
      .setColor('#2ECC71')
      .setFooter({ text: 'AURA Time Tracking • Excel Audit & Payroll Service' })
      .setTimestamp();

    return interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });
  } catch (error) {
    console.error('[EXPORT ERROR]', error);
    return interaction.editReply({
      content: `❌ Có lỗi xảy ra khi tạo file Excel: ${error.message}`
    });
  }
}
