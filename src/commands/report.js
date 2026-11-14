import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { generateDailyBarChartUrl } from '../services/chartService.js';
import { getTeamTodaySummary, getWorkDate } from '../services/shiftService.js';
import { config } from '../config/env.js';
import { smartParseDate, buildDateAutocompleteChoices } from '../utils/dateUtils.js';

function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const hours = Math.floor(m / 60);
  const remainingMins = m % 60;
  const decimalHours = (m / 60).toFixed(2);

  if (hours === 0) {
    return `${remainingMins}p (${decimalHours}h)`;
  }
  return `${hours}h ${remainingMins}p (${decimalHours}h)`;
}

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Xem biểu đồ tiến độ ngày (Song ngữ Việt - Hàn) / 일일 근무 현황 보고서')
  .addStringOption(option =>
    option.setName('date')
      .setDescription('Chọn ngày gợi ý hoặc gõ (14, 14/11, 2026-11-14) / 조회 일자')
      .setRequired(false)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  if (focusedOption.name === 'date') {
    const suggestions = buildDateAutocompleteChoices(focusedOption.value, { includeRangeShortcuts: false });
    await interaction.respond(suggestions).catch(() => {});
  }
}

export async function execute(interaction) {
  const customDate = interaction.options.getString('date');
  let targetDate = getWorkDate();

  if (customDate) {
    const parsed = smartParseDate(customDate);
    if (!parsed) {
      return interaction.reply({
        content: `❌ Ngày \`${customDate}\` không hợp lệ!\n👉 Hãy chọn từ danh sách gợi ý hoặc gõ \`14\`, \`14/11\`, \`2026-11-14\`.`,
        ephemeral: true
      });
    }
    targetDate = parsed;
  }

  await interaction.deferReply();

  try {
    let teamData = await getTeamTodaySummary(targetDate);
    const guild = interaction.guild;

    // Lọc theo Role Member: Nếu Server có cấu hình TARGET_WORKER_ROLE_ID,
    // chỉ giữ lại những thành viên thực tế có role Member (hoặc có ca làm trong ngày)
    if (guild && config.targetWorkerRoleId) {
      try {
        await guild.members.fetch();
        const role = guild.roles.cache.get(config.targetWorkerRoleId);
        if (role) {
          const validMemberIds = new Set(role.members.keys());
          teamData = teamData.filter(m => validMemberIds.has(m.discordId) || m.totalMinutes > 0);
        }
      } catch (fetchErr) {
        console.warn('[REPORT ROSTER WARN]', fetchErr.message);
      }
    }

    if (teamData.length === 0) {
      return interaction.editReply({
        content: `ℹ️ Chưa có dữ liệu chấm công nào cho ngày **${targetDate}**.\n*(해당 일자의 근무 기록이 없습니다.)*`
      });
    }

    const chartUrl = await generateDailyBarChartUrl(targetDate, teamData);

    const leaderboardLines = teamData
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .map((member, idx) => {
        const rankPrefix = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**${idx + 1}.**`;
        const timeStr = formatMinutes(member.totalMinutes);
        const icon = member.isAchieved ? '🟢' : member.totalMinutes >= 240 ? '🟡' : '🔴';
        const statusText = member.isAchieved 
          ? '🌟 Đạt 8h (달성)' 
          : `Thiếu ${formatMinutes(member.remainingMinutes)} (미달)`;
        return `${rankPrefix} ${icon} **${member.displayName}** ➔ \`${timeStr} / 8.0h\` • *${statusText}*`;
      });

    const embed = new EmbedBuilder()
      .setTitle(`📊 BÁO CÁO TIẾN ĐỘ TOÀN ĐỘI | 일일 근무 현황 보고서`)
      .setDescription(
        `> **TIẾN ĐỘ CHỈ TIÊU & BIỂU ĐỒ NĂNG SUẤT (${targetDate})**\n` +
        `> *Game Farming Shift & Performance Report*\n\n` +
        `🏆 **Bảng xếp hạng cày game hôm nay / 일일 근무 랭킹:**\n${leaderboardLines.join('\n')}\n\n` +
        `-# 💡 Đường kẻ đỏ nét đứt: Mốc chỉ tiêu 8h/ngày | 붉은 점선: 일일 목표 8시간`
      )
      .setColor('#5865F2')
      .setImage(chartUrl)
      .setFooter({ text: 'Gamefy Base Teams • Performance Analytics | 근무 실적 분석' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[REPORT ERROR]', error);
    return interaction.editReply({
      content: `❌ Lỗi khi vẽ biểu đồ / 오류 발생: ${error.message}`
    });
  }
}
