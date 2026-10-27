import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { generateDailyBarChartUrl } from '../services/chartService.js';
import { getTeamTodaySummary, getWorkDate } from '../services/shiftService.js';

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
      .setDescription('Ngày cần xem (YYYY-MM-DD, mặc định hôm nay / 조회 일자)')
      .setRequired(false)
  );

export async function execute(interaction) {
  const customDate = interaction.options.getString('date');
  const targetDate = customDate ? customDate.trim() : getWorkDate();

  await interaction.deferReply();

  try {
    const chartUrl = await generateDailyBarChartUrl(targetDate);
    const teamData = getTeamTodaySummary(targetDate);

    if (teamData.length === 0) {
      return interaction.editReply({
        content: `ℹ️ Chưa có dữ liệu chấm công nào cho ngày **${targetDate}**.\n*(해당 일자의 근무 기록이 없습니다.)*`
      });
    }

    const leaderboardLines = teamData
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .map((member, idx) => {
        const rankPrefix = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `**${idx + 1}.**`;
        const timeStr = formatMinutes(member.totalMinutes);
        const icon = member.isAchieved ? '🟢' : member.totalMinutes >= 240 ? '🟡' : '🔴';
        const statusText = member.isAchieved 
          ? '🌟 Đạt 8h' 
          : `Thiếu ${formatMinutes(member.remainingMinutes)}`;
        return `${rankPrefix} ${icon} **${member.displayName}** ➔ \`${timeStr} / 8.0h\` (${statusText})`;
      });

    const embed = new EmbedBuilder()
      .setTitle(`📊 BÁO CÁO TIẾN ĐỘ TOÀN ĐỘI | 일일 근무 현황`)
      .setDescription(
        `> **TIẾN ĐỘ CHỈ TIÊU & BIỂU ĐỒ NĂNG SUẤT (${targetDate})**\n\n` +
        `🏆 **Bảng xếp hạng cày game hôm nay:**\n${leaderboardLines.join('\n')}\n\n` +
        `-# 💡 Đường kẻ đỏ nét đứt: Mốc chỉ tiêu 8h/ngày | 붉은 점선: 일일 목표 8시간`
      )
      .setColor('#5865F2')
      .setImage(chartUrl)
      .setFooter({ text: 'Gamefy Base Teams • Performance Analytics' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[REPORT ERROR]', error);
    return interaction.editReply({
      content: `❌ Lỗi khi vẽ biểu đồ / 오류 발생: ${error.message}`
    });
  }
}
