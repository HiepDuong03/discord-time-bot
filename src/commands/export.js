import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { exportTimesheetToExcel } from '../services/exportService.js';

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveDateRange(range, customFrom, customTo) {
  const now = new Date();

  if (range === 'today') {
    const today = formatDate(now);
    return { fromDate: today, toDate: today };
  }

  if (range === 'this_week') {
    const d = new Date(now);
    const dayOfWeek = d.getDay(); // 0: CN, 1: T2...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    d.setDate(d.getDate() + diffToMonday);
    return {
      fromDate: formatDate(d),
      toDate: formatDate(now)
    };
  }

  if (range === 'last_month') {
    const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      fromDate: formatDate(firstDayLastMonth),
      toDate: formatDate(lastDayLastMonth)
    };
  }

  if (range === 'custom') {
    if (!customFrom || !customTo) {
      return {
        error: '⚠️ Khi chọn "custom" (tự nhập ngày), bạn bắt buộc phải nhập cả 2 tham số `from` và `to` (Định dạng: `YYYY-MM-DD`).'
      };
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(customFrom) || !dateRegex.test(customTo)) {
      return {
        error: '❌ Định dạng ngày không đúng! Vui lòng nhập theo dạng `YYYY-MM-DD` (Ví dụ: `2026-10-01`).'
      };
    }
    return { fromDate: customFrom, toDate: customTo };
  }

  // Mặc định 'this_month': Từ ngày 01 tháng này đến hôm nay
  const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    fromDate: formatDate(firstDayThisMonth),
    toDate: formatDate(now)
  };
}

export const data = new SlashCommandBuilder()
  .setName('export')
  .setDescription('Xuất file Excel tổng hợp số giờ làm theo khoảng ngày để tính lương')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(option =>
    option.setName('range')
      .setDescription('Khoảng thời gian nhanh / 빠른 기간 선택 (Mặc định: Tháng này)')
      .setRequired(false)
      .addChoices(
        { name: '📅 Tháng này / 이번 달 (Mặc định: Ngày 1 -> nay)', value: 'this_month' },
        { name: '☀️ Hôm nay / 오늘', value: 'today' },
        { name: '📆 Tuần này / 이번 주 (Thứ 2 -> nay)', value: 'this_week' },
        { name: '⏮️ Tháng trước / 지난 달 (Trọn vẹn tháng trước)', value: 'last_month' },
        { name: '⚙️ Tự nhập ngày / 직접 입력 (Dùng tham số from & to)', value: 'custom' }
      )
  )
  .addStringOption(option =>
    option.setName('from')
      .setDescription('Ngày bắt đầu nếu chọn custom (YYYY-MM-DD, ví dụ: 2026-10-01)')
      .setRequired(false)
  )
  .addStringOption(option =>
    option.setName('to')
      .setDescription('Ngày kết thúc nếu chọn custom (YYYY-MM-DD, ví dụ: 2026-10-15)')
      .setRequired(false)
  );

export async function execute(interaction) {
  const range = interaction.options.getString('range') || 'this_month';
  const rawFrom = interaction.options.getString('from')?.trim();
  const rawTo = interaction.options.getString('to')?.trim();

  // Nếu người dùng không chọn range nhưng lại nhập from & to -> tự động coi như custom
  const effectiveRange = (rawFrom && rawTo && !interaction.options.getString('range')) ? 'custom' : range;

  const { fromDate, toDate, error } = resolveDateRange(effectiveRange, rawFrom, rawTo);
  if (error) {
    return interaction.reply({ content: error, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: false });

  try {
    const result = await exportTimesheetToExcel(fromDate, toDate);

    if (!result.hasData) {
      return interaction.editReply({
        content: `⚠️ Không tìm thấy dữ liệu chấm công nào từ ngày **${fromDate}** đến **${toDate}**.\n*(해당 기간의 근무 기록이 없습니다.)*`
      });
    }

    const { summary, fileName, filePath } = result;
    const attachment = new AttachmentBuilder(filePath, { name: fileName });

    const targetRate = 0.9;
    const rate = summary.daysCount > 0 ? (summary.passedCount / summary.daysCount) : 0;
    const isGood = rate >= targetRate;
    const color = isGood ? '#16A34A' : '#F59E0B';

    const embed = new EmbedBuilder()
      .setTitle('📊 DỮ LIỆU GIỜ LÀM & AUDIT ĐÃ SẴN SÀNG! | 근무 시간 & SLA 보고서')
      .setDescription(
        `> **BÁO CÁO TỔNG HỢP & KIỂM TOÁN GIỜ CÀY GAME**\n` +
        `> *Game Farming Timesheet & SLA Audit Report*\n\n` +
        `**Kỳ báo cáo / 기간:** \`${fromDate}\` → \`${toDate}\`\n` +
        `**Chuẩn SLA / 기준:** \`8.0h / ngày\``
      )
      .setColor(color)
      .addFields(
        { name: 'Tổng giờ · 총 근무', value: `**${summary.totalHours.toFixed(1)} h**`, inline: true },
        { name: 'Nhân sự · 근무자', value: `**${summary.staffCount} người**`, inline: true },
        { name: 'Nick game · 계정', value: `**${summary.nickCount} nick**`, inline: true },
        {
          name: 'Tỉ lệ đạt SLA · 달성률',
          value: `**${Math.round(rate * 100)}%** (${summary.passedCount}/${summary.daysCount} lượt ngày·nick)`,
          inline: false
        }
      );

    if (summary.deficits && summary.deficits.length > 0) {
      const lines = summary.deficits.slice(0, 5).map(item => {
        const datePart = item.date.slice(5); // MM-DD
        return `• \`${datePart}\` · **${item.nick}** · ${item.staff} ➔ **${item.hours.toFixed(1)}h**`;
      });
      const more = summary.deficits.length - 5;
      if (more > 0) {
        lines.push(`*… và ${more} mục khác (xem chi tiết trong file)*`);
      }
      embed.addFields({
        name: '⚠️ Chưa đạt SLA · 미달 (Top 5)',
        value: lines.join('\n'),
        inline: false
      });
    } else {
      embed.addFields({
        name: '✅ Trạng thái · 상태',
        value: '🌟 Tất cả các ca và Nick đều đạt chuẩn SLA! (모두 달성)',
        inline: false
      });
    }

    embed.addFields({
      name: '📁 Cấu trúc 3 Sheet trong File Excel đính kèm:',
      value: '• **Sheet 1:** Tổng giờ làm từ khoảng thời gian đó (Tổng quan 요약)\n' +
             '• **Sheet 2:** Báo Cáo SLA Từng Nick (Theo ngày 일별 - Account SLA)\n' +
             '• **Sheet 3:** Nhật Ký Ra Vào Chi Tiết (Chi tiết ca 상세 - Raw Shifts Log)\n\n' +
             '-# 🇰🇷 첨부된 엑셀 파일(3개 시트)을 다운로드하여 정산 및 계정 감사를 확인하세요.',
      inline: false
    });

    embed.setFooter({ text: 'AURA Time Tracking • Excel Audit & Payroll Service' });
    embed.setTimestamp();

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
