import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getAllAccountsTodaySummary, getWorkDate } from '../services/shiftService.js';
import { getHoursUntilCutoff } from '../services/reminderService.js';

function createMiniBar(completedMinutes, targetHours = 8.0) {
  const targetMinutes = targetHours * 60;
  const ratio = Math.min(1, Math.max(0, completedMinutes / targetMinutes));
  const filled = Math.round(ratio * 5);
  return '▰'.repeat(filled) + '▱'.repeat(5 - filled);
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
      message: `ℹ️ Chưa có Nick game nào trong danh mục hoạt động.\n👉 Quản lý hãy dùng lệnh \`/acc-manage add code:<mã_nick>\` để thêm Nick cho team!\n*(등록된 계정이 없습니다. /acc-manage add 명령어로 추가해주세요.)*`
    };
  }

  const activeAccs = [];
  const deficitAccs = [];
  const achievedAccs = [];

  for (const acc of accList) {
    const doneH = (acc.totalMinutes / 60).toFixed(1);
    const targetH = `${acc.targetHours.toFixed(1)}h`;
    const remH = (acc.remainingMinutes / 60).toFixed(1);
    const miniBar = createMiniBar(acc.totalMinutes, acc.targetHours);

    if (acc.hasActiveShift) {
      activeAccs.push(
        `• \`[${acc.accountCode}]\` \`${miniBar}\` **${doneH}/${targetH}** • 🟢 **${acc.activeFarmerName}** (${acc.activeMinutes}p)`
      );
    } else if (acc.isAchieved) {
      achievedAccs.push(
        `• \`[${acc.accountCode}]\` \`${miniBar}\` **${doneH}/${targetH}** • 🌟 Đạt SLA`
      );
    } else {
      deficitAccs.push(
        `• \`[${acc.accountCode}]\` \`${miniBar}\` **${doneH}/${targetH}** • ⚪ Trống *(Thiếu ${remH}h)*`
      );
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎮 TIẾN ĐỘ TỪNG NICK GAME | 계정별 작업 현황`)
    .setDescription(
      `📅 **Chu kỳ:** \`${workDate}\`  •  ⏰ **Hạn chốt ca:** còn \`${hoursLeft}h\` (06:00 sáng)\n` +
      `📊 **Tổng quan:** **${activeAccs.length}** Đang cày  |  **${deficitAccs.length}** Đang trống  |  **${achievedAccs.length}** Đạt SLA\n` +
      `-# 🎯 Tiêu chuẩn: 8.0h/nick/ngày • 🇰🇷 일일 계정 목표 8.0시간`
    )
    .setColor('#5865F2');

  if (activeAccs.length > 0) {
    embed.addFields({
      name: `🟢 ĐANG CÓ NGƯỜI CÀY (${activeAccs.length} Nick / 진행 중)`,
      value: activeAccs.join('\n')
    });
  }

  if (deficitAccs.length > 0) {
    embed.addFields({
      name: `⚪ ĐANG TRỐNG / CẦN CÀY (${deficitAccs.length} Nick / 대기 중)`,
      value: deficitAccs.join('\n')
    });
  }

  if (achievedAccs.length > 0) {
    embed.addFields({
      name: `🌟 ĐÃ HOÀN THÀNH SLA (${achievedAccs.length} Nick / 달성 완료)`,
      value: achievedAccs.join('\n')
    });
  }

  embed.setFooter({ text: 'Gamefy Base Teams • Account SLA Monitor' });
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
