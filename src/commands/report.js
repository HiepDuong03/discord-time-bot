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
        const timeStr = formatMinutes(member.totalMinutes);
        const icon = member.isAchieved ? '🟢' : member.totalMinutes >= 240 ? '🟡' : '🔴';
        const statusText = member.isAchieved 
          ? 'ĐẠT / 달성' 
          : `Thiếu ${formatMinutes(member.remainingMinutes)} / 남음`;
        return `${idx + 1}. ${icon} **${member.displayName}**: ${timeStr} / 8.0h (${statusText})`;
      });

    const embed = new EmbedBuilder()
      .setTitle(`📊 BÁO CÁO TIẾN ĐỘ / 일일 근무 현황 (${targetDate})`)
      .setDescription(
        `**Xếp hạng tiến độ toàn đội / 팀원별 근무 순위:**\n${leaderboardLines.join('\n')}\n\n` +
        `*Đường kẻ đỏ: Mốc chỉ tiêu 8h / 붉은 점선: 일일 목표 8시간 기준선*`
      )
      .setColor('#2ECC71')
      .setImage(chartUrl)
      .setFooter({ text: 'Chu kỳ chốt / 마감 기준: 익일 06:00 AM' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[REPORT ERROR]', error);
    return interaction.editReply({
      content: `❌ Lỗi khi vẽ biểu đồ / 오류 발생: ${error.message}`
    });
  }
}
