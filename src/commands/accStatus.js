import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getAllAccountsTodaySummary, getWorkDate } from '../services/shiftService.js';
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
  .setName('acc-status')
  .setDescription('Bảng theo dõi tiến độ từng Nick Game trong ngày (Song ngữ) / 계정별 일일 근무 현황');

export async function execute(interaction) {
  const workDate = getWorkDate();
  const accList = getAllAccountsTodaySummary(workDate);
  const hoursLeft = getHoursUntilCutoff().toFixed(1);

  if (accList.length === 0) {
    return interaction.reply({
      content: `ℹ️ Chưa có Nick game nào được ghi nhận ca cày hôm nay (**${workDate}**).\n*(오늘 기록된 계정 작업 내역이 없습니다.)*`,
      ephemeral: true
    });
  }

  const activeAccs = [];
  const deficitAccs = [];
  const achievedAccs = [];

  for (const acc of accList) {
    const totalStr = formatMinutes(acc.totalMinutes);
    const neededStr = formatMinutes(acc.remainingMinutes);
    const targetStr = `${acc.targetHours}h`;

    if (acc.hasActiveShift) {
      activeAccs.push(
        `• 🟢 \`[${acc.accountCode}]\`: Đang được cày bởi **${acc.activeFarmerName}** (<@${acc.activeFarmerId}>)\n` +
        `  └ Ca hiện tại: **${acc.activeMinutes} phút** | Tổng hôm nay: **${totalStr} / ${targetStr}**`
      );
    } else if (acc.isAchieved) {
      achievedAccs.push(
        `• ✅ \`[${acc.accountCode}]\`: **${totalStr} / ${targetStr}** (Đã đạt SLA 8h / 목표 달성)`
      );
    } else {
      deficitAccs.push(
        `• 🔴 \`[${acc.accountCode}]\`: Mới đạt **${totalStr} / ${targetStr}** (Còn thiếu **${neededStr}**)\n` +
        `  └ ⚠️ *Trạng thái: Đang TRỐNG! Cần người vào cày bù / 현재 비어있음, 작업 필요*`
      );
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎮 TIẾN ĐỘ TỪNG NICK GAME / 계정별 일일 작업 현황 (${workDate})`)
    .setDescription(
      `📌 **Mục tiêu mỗi Nick:** \`Tối thiểu 8.0h / ngày (일일 8시간)\`\n` +
      `⏱️ **Thời gian đến mốc 06:00 sáng mai / 마감까지:** \`${hoursLeft} tiếng (시간)\`\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`
    )
    .setColor('#F1C40F');

  if (activeAccs.length > 0) {
    embed.addFields({
      name: `🟢 ĐANG CÓ NGƯỜI CÀY / 현재 작업 중 (${activeAccs.length} Nick)`,
      value: activeAccs.join('\n')
    });
  }

  if (deficitAccs.length > 0) {
    embed.addFields({
      name: `🔴 CẦN CÀY BÙ (ĐANG TRỐNG) / 미달 및 작업 필요 (${deficitAccs.length} Nick)`,
      value: deficitAccs.join('\n')
    });
  }

  if (achievedAccs.length > 0) {
    embed.addFields({
      name: `✅ ĐÃ ĐẠT CHỈ TIÊU SLA / 8시간 목표 달성 (${achievedAccs.length} Nick)`,
      value: achievedAccs.join('\n')
    });
  }

  embed.setFooter({ text: 'AURA Account SLA Monitor • Chu kỳ chốt: 익일 06:00 AM' });
  embed.setTimestamp();

  return interaction.reply({ embeds: [embed] });
}
