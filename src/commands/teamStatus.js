import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getTeamTodaySummary, getWorkDate } from '../services/shiftService.js';
import { getHoursUntilCutoff } from '../services/reminderService.js';

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
  .setName('team-status')
  .setDescription('Bảng điều khiển Quản lý: Xem tiến độ thời gian thực của cả team / 팀 전체 실시간 근무 현황')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const workDate = getWorkDate();
  const teamData = getTeamTodaySummary(workDate);
  const hoursLeftBeforeCutoff = getHoursUntilCutoff().toFixed(1);

  if (teamData.length === 0) {
    return interaction.reply({
      content: `ℹ️ Chưa có thành viên nào ghi nhận giờ làm hôm nay (**${workDate}**).`,
      ephemeral: true
    });
  }

  const activeWorkers = [];
  const offWorkers = [];

  for (const m of teamData) {
    const totalStr = formatMinutes(m.totalMinutes);
    const neededStr = formatMinutes(m.remainingMinutes);
    const targetStr = `${m.targetHours}h`;

    if (m.hasActiveShift) {
      activeWorkers.push(
        `• 🟢 **${m.displayName}** (<@${m.discordId}>) ➔ Ca này: **${m.activeMinutes}p** | Tổng: \`${totalStr} / ${targetStr}\``
      );
    } else {
      const icon = m.isAchieved ? '✅' : m.totalMinutes >= 240 ? '🟡' : '🔴';
      const statusNote = m.isAchieved 
        ? 'Đạt 8h' 
        : `Thiếu ${neededStr}`;
      offWorkers.push(
        `• ${icon} **${m.displayName}** (<@${m.discordId}>) ➔ \`${totalStr} / ${targetStr}\` (${statusNote})`
      );
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ QUÂN SỐ & TRẠNG THÁI CẢ ĐỘI | 팀 실시간 현황`)
    .setDescription(
      `> **BẢNG ĐIỀU HÀNH QUÂN SỐ & TIẾN ĐỘ THỜI GIAN THỰC**\n` +
      `> *Live Team Attendance & Roster (${workDate})*\n\n` +
      '```yaml\n' +
      `• Tổng nhân sự : ${teamData.length} người\n` +
      `• Đang trong ca : ${activeWorkers.length} người (🟢 ONLINE)\n` +
      `• Đang nghỉ ngơi: ${offWorkers.length} người (⚪ OFF)\n` +
      `• Hạn chốt ca   : còn ${hoursLeftBeforeCutoff}h (06:00 AM)\n` +
      '```'
    )
    .setColor('#5865F2')
    .addFields(
      {
        name: `🟢 ĐANG TRONG CA (근무 중 - ${activeWorkers.length})`,
        value: activeWorkers.length > 0 ? activeWorkers.join('\n') : '*Hiện cả đội đang nghỉ ngơi.*'
      },
      {
        name: `⚪ ĐANG NGHỈ (휴식 중 - ${offWorkers.length})`,
        value: offWorkers.length > 0 ? offWorkers.join('\n') : '*Tất cả thành viên đều đang trong ca.*'
      }
    )
    .setFooter({ text: 'Gamefy Base Teams • Command Center' })
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true // Chỉ quản lý gõ lệnh mới thấy
  });
}
