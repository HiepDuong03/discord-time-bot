import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';
import { generateDailyBarChartUrl } from '../services/chartService.js';
import { getTeamTodaySummary, getTeamRangeSummary, getWorkDate } from '../services/shiftService.js';
import { config } from '../config/env.js';
import {
  smartParseDate,
  buildDateAutocompleteChoices,
  REPORT_RANGE_PRESETS,
  resolveReportRangePreset
} from '../utils/dateUtils.js';
import { formatMinutes } from '../utils/formatUtils.js';

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Xem xếp hạng & biểu đồ tiến độ (1 ngày hoặc khoảng thời gian) / 근무 랭킹 및 보고서')
  .addStringOption(option =>
    option.setName('preset')
      .setDescription('Chọn nhanh mốc thời gian (không cần gõ) / 기간 빠른 선택')
      .setRequired(false)
      .addChoices(...REPORT_RANGE_PRESETS.map(p => ({ name: p.label, value: p.value })))
  )
  .addStringOption(option =>
    option.setName('date')
      .setDescription('Hoặc chọn 1 ngày cụ thể / 특정 일자 선택')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName('from')
      .setDescription('Từ ngày (chọn từ danh sách) / 시작일')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName('to')
      .setDescription('Đến ngày (mặc định hôm nay) / 종료일')
      .setRequired(false)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  if (focusedOption.name === 'date') {
    const suggestions = buildDateAutocompleteChoices(focusedOption.value, { includeRangeShortcuts: false });
    await interaction.respond(suggestions).catch(() => {});
    return;
  }
  if (focusedOption.name === 'from' || focusedOption.name === 'to') {
    const suggestions = buildDateAutocompleteChoices(focusedOption.value, { includeRangeShortcuts: true });
    await interaction.respond(suggestions).catch(() => {});
  }
}

function buildRangeSelectRow(activePreset = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('select_report_range')
    .setPlaceholder('🗓️ Đổi nhanh khoảng thời gian xếp hạng / 기간 변경...')
    .addOptions(
      REPORT_RANGE_PRESETS.map(p =>
        new StringSelectMenuOptionBuilder()
          .setLabel(p.label)
          .setValue(p.value)
          .setDescription(p.description)
          .setDefault(activePreset === p.value)
      )
    );

  return new ActionRowBuilder().addComponents(menu);
}

/**
 * Tạo nội dung Embed + Select Menu cho cả Slash Command /report và Select Menu đổi khoảng thời gian
 */
export async function buildReportPayload({ preset = null, date = null, from = null, to = null, guild = null }) {
  let fromDate;
  let toDate;
  let isSingleDay = true;
  let rangeLabel = '';
  let activePreset = preset;

  if (from || to) {
    fromDate = from || to;
    toDate = to || getWorkDate();
    if (fromDate > toDate) {
      [fromDate, toDate] = [toDate, fromDate];
    }
    isSingleDay = fromDate === toDate;
    rangeLabel = isSingleDay ? fromDate : `${fromDate} → ${toDate}`;
    activePreset = null;
  } else if (date) {
    fromDate = date;
    toDate = date;
    isSingleDay = true;
    rangeLabel = date;
    activePreset = null;
  } else {
    const chosenPreset = preset || 'today';
    const resolved = resolveReportRangePreset(chosenPreset);
    fromDate = resolved.from;
    toDate = resolved.to;
    isSingleDay = resolved.isSingleDay;
    rangeLabel = isSingleDay ? fromDate : `${fromDate} → ${toDate}`;
    activePreset = chosenPreset;
  }

  let teamData = isSingleDay
    ? await getTeamTodaySummary(fromDate)
    : await getTeamRangeSummary(fromDate, toDate);

  if (guild && config.targetWorkerRoleId) {
    try {
      await guild.members.fetch({ time: 1200 }).catch(() => null);
      const role = guild.roles.cache.get(config.targetWorkerRoleId);
      if (role) {
        const validMemberIds = new Set(role.members.keys());
        teamData = teamData.filter(m => validMemberIds.has(m.discordId) || m.totalMinutes > 0);
      }
    } catch (fetchErr) {
      console.warn('[REPORT ROSTER WARN]', fetchErr.message);
    }
  }

  const components = [buildRangeSelectRow(activePreset)];

  if (teamData.length === 0) {
    return {
      content: `ℹ️ Chưa có dữ liệu chấm công nào cho **${rangeLabel}**.\n*(해당 기간의 근무 기록이 없습니다.)*`,
      embeds: [],
      components
    };
  }

  const sortedTeam = [...teamData].sort((a, b) => b.totalMinutes - a.totalMinutes);
  const chartUrl = await generateDailyBarChartUrl(fromDate, sortedTeam, {
    isRange: !isSingleDay,
    rangeLabel
  });

  const leaderboardLines = sortedTeam.map((member, idx) => {
    const rankPrefix = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**${idx + 1}.**`;
    const timeStr = formatMinutes(member.totalMinutes);

    if (isSingleDay) {
      const targetNum = Number(member.targetHours || config.dailyTargetHours);
      const targetStr = targetNum.toFixed(1);
      const icon = member.isAchieved ? '🟢' : member.totalMinutes >= (targetNum * 60) / 2 ? '🟡' : '🔴';
      const statusText = member.isAchieved
        ? `🌟 Đạt ${targetStr}h (달성)`
        : `Thiếu ${formatMinutes(member.remainingMinutes)} (미달)`;
      return `${rankPrefix} ${icon} **${member.displayName}** ➔ \`${timeStr} / ${targetStr}h\` • *${statusText}*`;
    }

    const avgStr = member.activeDays > 0 ? `${(member.avgMinutesPerDay / 60).toFixed(1)}h/ngày` : '0.0h/ngày';
    const icon = member.totalMinutes > 0 ? '🟢' : '⚪';
    return `${rankPrefix} ${icon} **${member.displayName}** ➔ \`${timeStr}\` • ${member.activeDays} ngày (${avgStr})`;
  });

  const totalRangeHours = (sortedTeam.reduce((acc, m) => acc + m.totalMinutes, 0) / 60).toFixed(1);
  const descHeader = isSingleDay
    ? `> **TIẾN ĐỘ CHỈ TIÊU & BIỂU ĐỒ NĂNG SUẤT (${rangeLabel})**\n> *Game Farming Shift & Performance Report*`
    : `> **BẢNG XẾP HẠNG THEO KHOẢNG THỜI GIAN (${rangeLabel})**\n> *Tổng toàn đội: \`${totalRangeHours}h\` • Game Farming Leaderboard*`;
  const descFooter = isSingleDay
    ? `-# 💡 Đường kẻ đỏ nét đứt: Mốc chỉ tiêu 8h/ngày | 붉은 점선: 일일 목표 8시간`
    : `-# 💡 Dùng menu bên dưới để đổi nhanh khoảng thời gian | 아래 메뉴로 기간을 변경하세요.`;

  const listText = leaderboardLines.join('\n').slice(0, 3500);

  const embed = new EmbedBuilder()
    .setTitle(
      isSingleDay
        ? `📊 BÁO CÁO TIẾN ĐỘ TOÀN ĐỘI | 일일 근무 현황 보고서`
        : `🏆 BẢNG XẾP HẠNG GIỜ LÀM TOÀN ĐỘI | 기간별 근무 랭킹`
    )
    .setDescription(
      `${descHeader}\n\n` +
      `🏆 **Bảng xếp hạng / 근무 랭킹:**\n${listText}\n\n` +
      `${descFooter}`
    )
    .setColor('#5865F2')
    .setImage(chartUrl)
    .setFooter({ text: `Gamefy Base Teams • Kỳ: ${rangeLabel} | 근무 실적 분석` })
    .setTimestamp();

  return {
    content: null,
    embeds: [embed],
    components
  };
}

export async function execute(interaction) {
  const preset = interaction.options.getString('preset');
  const rawDate = interaction.options.getString('date');
  const rawFrom = interaction.options.getString('from');
  const rawTo = interaction.options.getString('to');

  let parsedDate = null;
  let parsedFrom = null;
  let parsedTo = null;

  if (rawDate) {
    parsedDate = smartParseDate(rawDate);
    if (!parsedDate) {
      return interaction.reply({
        content: `❌ Ngày \`${rawDate}\` không hợp lệ!\n👉 Hãy bấm chọn từ danh sách gợi ý hoặc dùng menu \`preset\`.`,
        ephemeral: true
      });
    }
  }
  if (rawFrom) {
    parsedFrom = smartParseDate(rawFrom);
    if (!parsedFrom) {
      return interaction.reply({
        content: `❌ Giá trị "Từ ngày" (\`${rawFrom}\`) không hợp lệ! Hãy bấm chọn từ danh sách gợi ý.`,
        ephemeral: true
      });
    }
  }
  if (rawTo) {
    parsedTo = smartParseDate(rawTo);
    if (!parsedTo) {
      return interaction.reply({
        content: `❌ Giá trị "Đến ngày" (\`${rawTo}\`) không hợp lệ! Hãy bấm chọn từ danh sách gợi ý.`,
        ephemeral: true
      });
    }
  }

  try {
    const payload = await buildReportPayload({
      preset,
      date: parsedDate,
      from: parsedFrom,
      to: parsedTo,
      guild: interaction.guild
    });
    return interaction.reply(payload);
  } catch (error) {
    console.error('[REPORT ERROR]', error);
    return interaction.reply({
      content: `❌ Lỗi khi vẽ biểu đồ / 오류 발생: ${error.message}`,
      ephemeral: true
    });
  }
}
