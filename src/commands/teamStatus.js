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
        `• 🟢 **${m.displayName}** (<@${m.discordId}>)\n` +
        `  └ Ca hiện tại: **${m.activeMinutes} phút** | Tổng hôm nay: **${totalStr} / ${targetStr}**`
      );
    } else {
      const icon = m.isAchieved ? '✅' : m.totalMinutes >= 240 ? '🟡' : '🔴';
      const statusNote = m.isAchieved 
        ? 'Đã đạt chỉ tiêu 8h / 목표 달성' 
        : `Còn thiếu: ${neededStr} / 부족`;
      offWorkers.push(
        `• ${icon} **${m.displayName}** (<@${m.discordId}>)\n` +
        `  └ Tổng hôm nay: **${totalStr} / ${targetStr}** (${statusNote})`
      );
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ BẢNG THEO DÕI QUÂN SỐ CẢ ĐỘI / 팀 실시간 근무 현황`)
    .setDescription(
      `📅 **Ngày tính công / 일자:** \`${workDate}\`\n` +
      `⏱️ **Thời gian đến 06:00 sáng mai / 마감까지:** \`${hoursLeftBeforeCutoff} tiếng (시간)\`\n` +
      `👥 **Tổng quân số đã ghi nhận:** \`${teamData.length} người / 명\`\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`
    )
    .setColor('#3498DB')
    .addFields(
      {
        name: `🟢 ĐANG TRONG CA / 현재 근무 중 (${activeWorkers.length} người)`,
        value: activeWorkers.length > 0 ? activeWorkers.join('\n') : '*Hiện không có ai đang trong ca.*'
      },
      {
        name: `⚪ ĐANG NGHỈ / 현재 휴식 중 (${offWorkers.length} người)`,
        value: offWorkers.length > 0 ? offWorkers.join('\n') : '*Tất cả thành viên đều đang trong ca.*'
      }
    )
    .setFooter({ text: 'Dành riêng cho Quản lý • AURA Management' })
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true // Chỉ quản lý gõ lệnh mới thấy
  });
}
