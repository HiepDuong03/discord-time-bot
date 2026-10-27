import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } from 'discord.js';
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

    return interaction.editReply({
      content: `📊 **BÁO CÁO TÍNH LƯƠNG ĐÃ SẴN SÀNG!**\n` +
               `• Kỳ thống kê: Từ **${fromDate}** đến **${toDate}**\n` +
               `• Số lượng nhân sự: **${result.userCount} người**\n` +
               `• Tổng giờ làm cả đội: **${result.grandTotalHours} giờ**\n\n` +
               `*File Excel đính kèm gồm 2 Sheet: Sheet 1 tính lương tổng hợp, Sheet 2 chi tiết từng ca.*`,
      files: [attachment]
    });
  } catch (error) {
    console.error('[EXPORT ERROR]', error);
    return interaction.editReply({
      content: `❌ Có lỗi xảy ra khi tạo file Excel: ${error.message}`
    });
  }
}
