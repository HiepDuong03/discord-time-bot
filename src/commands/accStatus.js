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

export async function buildAccountStatusEmbed(workDate = getWorkDate()) {
  const accList = await getAllAccountsTodaySummary(workDate);
  const hoursLeft = getHoursUntilCutoff().toFixed(1);

  if (accList.length === 0) {
    return {
      hasData: false,
      message: `ℹ️ Chưa có Nick game nào được ghi nhận ca cày hôm nay (**${workDate}**).\n*(오늘 기록된 계정 작업 내역이 없습니다.)*`
    };
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
        `• \`[${acc.accountCode}]\` ➔ **${acc.activeFarmerName}** (<@${acc.activeFarmerId}>)\n` +
        `  └ Đang cày: **${acc.activeMinutes}p** | Tổng hôm nay: \`${totalStr} / ${targetStr}\``
      );
    } else if (acc.isAchieved) {
      achievedAccs.push(
        `• \`[${acc.accountCode}]\` ➔ \`${totalStr} / ${targetStr}\` (🌟 Đạt 100% SLA)`
      );
    } else {
      deficitAccs.push(
        `• \`[${acc.accountCode}]\` ➔ Mới đạt \`${totalStr} / ${targetStr}\` (Thiếu **${neededStr}**)\n` +
        `  └ ⚠️ *ĐANG TRỐNG! Cần người vào cày bù / 작업 필요*`
      );
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎮 TIẾN ĐỘ TỪNG NICK GAME | 계정별 작업 현황`)
    .setDescription(
      `> **THEO DÕI CHỈ TIÊU & TIẾN ĐỘ TỪNG NICK CÀY**\n` +
      `> *Account SLA & Rotation Monitoring (${workDate})*\n\n` +
      '```yaml\n' +
      `• Chỉ tiêu mỗi Nick : 8.0h / ngày (일일 8시간)\n` +
      `• Hạn chốt ca       : còn ${hoursLeft}h (trước 06:00 sáng mai)\n` +
      `• Tổng số Nick      : ${accList.length} acc đang quản lý\n` +
      '```'
    )
    .setColor('#FEE75C');

  if (deficitAccs.length > 0) {
    embed.addFields({
      name: `🔴 CẦN CÀY BÙ / ĐANG TRỐNG (작업 필요 - ${deficitAccs.length} Nick)`,
      value: deficitAccs.join('\n')
    });
  }

  if (activeAccs.length > 0) {
    embed.addFields({
      name: `🟢 ĐANG CÓ NGƯỜI CÀY (진행 중 - ${activeAccs.length} Nick)`,
      value: activeAccs.join('\n')
    });
  }

  if (achievedAccs.length > 0) {
    embed.addFields({
      name: `✅ ĐÃ ĐẠT CHỈ TIÊU SLA (달성 완료 - ${achievedAccs.length} Nick)`,
      value: achievedAccs.join('\n')
    });
  }

  embed.setFooter({ text: 'Gamefy Base Teams • Chu kỳ chốt: 06:00 AM' });
  embed.setTimestamp();

  return {
    hasData: true,
    embed
  };
}

export async function execute(interaction) {
  const result = await buildAccountStatusEmbed();
  if (!result.hasData) {
    return interaction.reply({
      content: result.message,
      ephemeral: true
    });
  }

  return interaction.reply({ embeds: [result.embed] });
}
