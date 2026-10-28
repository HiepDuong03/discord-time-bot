import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { exportTimesheetToExcel } from '../services/exportService.js';

function formatDateIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Bộ phân tích ngày thông minh (Smart Date Parser)
 * Chấp nhận: số ngày '1', '27'; ngày/tháng '15/9', '15-09'; chuẩn '2026-10-01'; chuỗi dính '20261001'
 */
export function smartParseDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = n => String(n).padStart(2, '0');

  // 1. Nếu chỉ gõ 1-2 chữ số (ví dụ: '1', '15', '27') -> ngày trong tháng hiện tại
  if (/^\d{1,2}$/.test(str)) {
    const day = parseInt(str, 10);
    if (day >= 1 && day <= 31) {
      return `${y}-${pad(m + 1)}-${pad(day)}`;
    }
  }

  // 2. Nếu gõ dạng ngày/tháng hoặc ngày-tháng (ví dụ: '15/9', '15-09', '15/10')
  const dmMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (dmMatch) {
    const day = parseInt(dmMatch[1], 10);
    const month = parseInt(dmMatch[2], 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${pad(month)}-${pad(day)}`;
    }
  }

  // 3. Chuỗi 8 số liền nhau (ví dụ: '20261001')
  const digits = str.replace(/\D/g, '');
  if (digits.length === 8 && (digits.startsWith('202') || digits.startsWith('203'))) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  // 4. Định dạng chuẩn YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // 5. Nếu có lỗi nhảy phím lặp số đầu kiểu '2202610...'
  if (str.length > 8) {
    const yearMatch = str.match(/(202\d)/);
    if (yearMatch) {
      const yearIdx = str.indexOf(yearMatch[1]);
      const cleanSub = str.slice(yearIdx).replace(/\D/g, '');
      if (cleanSub.length >= 8) {
        return `${cleanSub.slice(0, 4)}-${cleanSub.slice(4, 6)}-${cleanSub.slice(6, 8)}`;
      }
    }
  }

  return null;
}

export const data = new SlashCommandBuilder()
  .setName('export')
  .setDescription('Xuất file Excel tổng hợp số giờ làm theo khoảng ngày để tính lương')
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
      .setDescription('Từ ngày (Click gợi ý hoặc gõ số ngày: 1, 15, 2026-10-01)')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName('to')
      .setDescription('Đến ngày (Click gợi ý hoặc gõ số ngày: 27, 2026-10-27)')
      .setRequired(false)
      .setAutocomplete(true)
  );

/**
 * Xử lý gợi ý ngày tự động 1-chạm (Discord Autocomplete)
 */
export async function autocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  const query = focusedOption.value.trim().toLowerCase();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const pad = n => String(n).padStart(2, '0');
  const formatIso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  const suggestions = [];

  if (focusedOption.name === 'from' || focusedOption.name === 'to') {
    if (!query) {
      const todayIso = formatIso(currentYear, currentMonth, now.getDate());
      const firstDayThisMonth = formatIso(currentYear, currentMonth, 1);

      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayIso = formatIso(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDaysAgoIso = formatIso(sevenDaysAgo.getFullYear(), sevenDaysAgo.getMonth(), sevenDaysAgo.getDate());

      const firstDayLastMonth = formatIso(currentYear, currentMonth - 1, 1);
      const lastDayLastMonthObj = new Date(currentYear, currentMonth, 0);
      const lastDayLastMonth = formatIso(lastDayLastMonthObj.getFullYear(), lastDayLastMonthObj.getMonth(), lastDayLastMonthObj.getDate());

      suggestions.push(
        { name: `📅 Hôm nay (${todayIso})`, value: todayIso },
        { name: `📅 Đầu tháng này (${firstDayThisMonth})`, value: firstDayThisMonth },
        { name: `⏮️ Hôm qua (${yesterdayIso})`, value: yesterdayIso },
        { name: `⏮️ 7 ngày trước (${sevenDaysAgoIso})`, value: sevenDaysAgoIso },
        { name: `🗓️ Đầu tháng trước (${firstDayLastMonth})`, value: firstDayLastMonth },
        { name: `🗓️ Cuối tháng trước (${lastDayLastMonth})`, value: lastDayLastMonth }
      );
    } else {
      const num = parseInt(query, 10);
      if (!isNaN(num) && num >= 1 && num <= 31) {
        const thisMonthDate = formatIso(currentYear, currentMonth, num);
        suggestions.push({
          name: `📅 Ngày ${num} tháng này (${thisMonthDate})`,
          value: thisMonthDate
        });

        const lastMonthDate = formatIso(currentYear, currentMonth - 1, num);
        suggestions.push({
          name: `🗓️ Ngày ${num} tháng trước (${lastMonthDate})`,
          value: lastMonthDate
        });
      }

      if (query.length >= 4) {
        const cleanDigits = query.replace(/\D/g, '');
        if (cleanDigits.length === 8) {
          const formatted = `${cleanDigits.slice(0, 4)}-${cleanDigits.slice(4, 6)}-${cleanDigits.slice(6, 8)}`;
          suggestions.push({ name: `📅 Chọn ngày: ${formatted}`, value: formatted });
        }
      }
    }
  }

  await interaction.respond(suggestions.slice(0, 25)).catch(() => {});
}

export async function execute(interaction) {
  const preset = interaction.options.getString('range') || interaction.options.getString('khoang_thoi_gian');
  const rawFrom = interaction.options.getString('from')?.trim();
  const rawTo = interaction.options.getString('to')?.trim();

  let fromDate = null;
  let toDate = null;
  const now = new Date();

  // 1. Ưu tiên Preset nếu có chọn
  if (preset) {
    if (preset === 'today') {
      const t = formatDateIso(now);
      fromDate = t;
      toDate = t;
    } else if (preset === 'this_week') {
      const d = new Date(now);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      fromDate = formatDateIso(d);
      toDate = formatDateIso(now);
    } else if (preset === 'last_week') {
      const d = new Date(now);
      const day = d.getDay();
      const diffToThisMon = day === 0 ? -6 : 1 - day;
      const lastMon = new Date(now);
      lastMon.setDate(now.getDate() + diffToThisMon - 7);
      const lastSun = new Date(now);
      lastSun.setDate(now.getDate() + diffToThisMon - 1);
      fromDate = formatDateIso(lastMon);
      toDate = formatDateIso(lastSun);
    } else if (preset === 'last_month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      fromDate = formatDateIso(first);
      toDate = formatDateIso(last);
    } else if (preset === 'last_7_days') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      fromDate = formatDateIso(d);
      toDate = formatDateIso(now);
    } else if (preset === 'last_30_days') {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      fromDate = formatDateIso(d);
      toDate = formatDateIso(now);
    } else {
      // this_month
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      fromDate = formatDateIso(first);
      toDate = formatDateIso(now);
    }
  } else if (rawFrom || rawTo) {
    // 2. Người dùng nhập from / to tự do
    fromDate = smartParseDate(rawFrom);
    toDate = smartParseDate(rawTo) || formatDateIso(now);

    if (!fromDate) {
      return interaction.reply({
        content: `❌ Giá trị "Từ ngày" (\`${rawFrom}\`) không hợp lệ!\n👉 Bạn có thể gõ số ngày đơn giản (ví dụ: \`1\`, \`15\`) hoặc click chọn gợi ý.`,
        ephemeral: true
      });
    }

    if (fromDate > toDate) {
      // Đảo lại nếu nhập ngược
      const temp = fromDate;
      fromDate = toDate;
      toDate = temp;
    }
  } else {
    // 3. Mặc định: Từ ngày 01 tháng này đến hôm nay
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    fromDate = formatDateIso(first);
    toDate = formatDateIso(now);
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
