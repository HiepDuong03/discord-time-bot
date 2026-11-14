import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { exportTimesheetToExcel } from '../services/exportService.js';
import {
  smartParseDate,
  getTodayIso,
  getDatePartsInTimezone,
  addDaysToIso,
  getMonthRangeIso,
  buildDateAutocompleteChoices
} from '../utils/dateUtils.js';

export { smartParseDate };

export const data = new SlashCommandBuilder()
  .setName('export')
  .setDescription('Xuất file Excel tổng hợp giờ làm & SLA / 근무 시간 엑셀 보고서 출력')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(option =>
    option.setName('range')
      .setDescription('Khoảng thời gian định kỳ (Tháng này, Tuần này...) / 빠른 기간 선택')
      .setRequired(false)
      .addChoices(
        { name: '📅 Tháng này / 이번 달 (Từ ngày 01 đến hôm nay)', value: 'this_month' },
        { name: '⏮️ Tháng trước / 지난 달 (Trọn vẹn tháng trước)', value: 'last_month' },
        { name: '📆 Tuần này / 이번 주 (Từ Thứ 2 đến hôm nay)', value: 'this_week' },
        { name: '🗓️ Tuần trước / 지난 주 (Trọn vẹn tuần trước)', value: 'last_week' },
        { name: '⏳ 7 ngày gần nhất / 최근 7일', value: 'last_7_days' },
        { name: '⏳ 30 ngày gần nhất / 최근 30일', value: 'last_30_days' },
        { name: '☀️ Hôm nay / 오늘', value: 'today' }
      )
  )
  .addStringOption(option =>
    option.setName('from')
      .setDescription('Từ ngày (Click gợi ý hoặc gõ: 1, 15, 2026-10-01) / 시작일')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName('to')
      .setDescription('Đến ngày (Click gợi ý hoặc gõ: 27, 2026-10-27) / 종료일')
      .setRequired(false)
      .setAutocomplete(true)
  );

/**
 * Xử lý gợi ý ngày tự động 1-chạm (Discord Autocomplete)
 */
export async function autocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  if (focusedOption.name === 'from' || focusedOption.name === 'to') {
    const suggestions = buildDateAutocompleteChoices(focusedOption.value, { includeRangeShortcuts: true });
    await interaction.respond(suggestions).catch(() => {});
  }
}

export async function execute(interaction) {
  const preset = interaction.options.getString('range') || interaction.options.getString('khoang_thoi_gian');
  const rawFrom = interaction.options.getString('from')?.trim();
  const rawTo = interaction.options.getString('to')?.trim();

  let fromDate = null;
  let toDate = null;
  const now = new Date();
  const todayIso = getTodayIso(now);
  const { year: curYear, month: curMonth, weekday } = getDatePartsInTimezone(now);

  // 1. Ưu tiên Preset nếu có chọn
  if (preset) {
    if (preset === 'today') {
      fromDate = todayIso;
      toDate = todayIso;
    } else if (preset === 'this_week') {
      const diffToMon = weekday === 0 ? -6 : 1 - weekday;
      fromDate = addDaysToIso(todayIso, diffToMon);
      toDate = todayIso;
    } else if (preset === 'last_week') {
      const diffToThisMon = weekday === 0 ? -6 : 1 - weekday;
      fromDate = addDaysToIso(todayIso, diffToThisMon - 7);
      toDate = addDaysToIso(todayIso, diffToThisMon - 1);
    } else if (preset === 'last_month') {
      const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
      const prevYear = curMonth === 1 ? curYear - 1 : curYear;
      const range = getMonthRangeIso(prevYear, prevMonth);
      fromDate = range.from;
      toDate = range.to;
    } else if (preset === 'last_7_days') {
      fromDate = addDaysToIso(todayIso, -6);
      toDate = todayIso;
    } else if (preset === 'last_30_days') {
      fromDate = addDaysToIso(todayIso, -29);
      toDate = todayIso;
    } else {
      // this_month
      fromDate = getMonthRangeIso(curYear, curMonth).from;
      toDate = todayIso;
    }
  } else if (rawFrom || rawTo) {
    // 2. Người dùng nhập from / to tự do hoặc chọn autocomplete
    if (rawFrom) {
      fromDate = smartParseDate(rawFrom);
      if (!fromDate) {
        return interaction.reply({
          content: `❌ Giá trị "Từ ngày" (\`${rawFrom}\`) không hợp lệ!\n👉 Bạn có thể gõ \`15\`, \`15/11\`, \`2026-11-15\` hoặc click chọn từ danh sách gợi ý.`,
          ephemeral: true
        });
      }
    }

    if (rawTo) {
      toDate = smartParseDate(rawTo);
      if (!toDate) {
        return interaction.reply({
          content: `❌ Giá trị "Đến ngày" (\`${rawTo}\`) không hợp lệ!\n👉 Bạn có thể gõ \`15\`, \`15/11\`, \`2026-11-15\` hoặc click chọn từ danh sách gợi ý.`,
          ephemeral: true
        });
      }
    } else {
      toDate = todayIso;
    }

    if (!fromDate) {
      fromDate = `${toDate.slice(0, 7)}-01`;
    }

    if (fromDate > toDate) {
      const temp = fromDate;
      fromDate = toDate;
      toDate = temp;
    }
  } else {
    // 3. Mặc định: Từ ngày 01 tháng này đến hôm nay
    fromDate = getMonthRangeIso(curYear, curMonth).from;
    toDate = todayIso;
  }

  try {
    const result = await exportTimesheetToExcel(fromDate, toDate);

    if (!result.hasData) {
      return interaction.reply({
        content: `⚠️ Không tìm thấy dữ liệu chấm công nào từ ngày **${fromDate}** đến **${toDate}**.\n*(해당 기간의 근무 기록이 없습니다.)*`,
        ephemeral: true
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
        const datePart = item.date.slice(5);
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

    embed.setFooter({ text: 'AURA Time Tracking • Excel Audit & Payroll Service | 급여 정산 및 감사' });
    embed.setTimestamp();

    return interaction.reply({
      embeds: [embed],
      files: [attachment]
    });
  } catch (error) {
    console.error('[EXPORT ERROR]', error);
    return interaction.reply({
      content: `❌ Có lỗi xảy ra khi tạo file Excel: ${error.message}`,
      ephemeral: true
    });
  }
}
