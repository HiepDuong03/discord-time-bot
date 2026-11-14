import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getTeamTodaySummary, getWorkDate } from '../services/shiftService.js';
import { getHoursUntilCutoff } from '../services/reminderService.js';
import { config } from '../config/env.js';
import { formatMinutes } from '../utils/formatUtils.js';

function joinLinesSafe(lines, maxLen = 1020) {
  let out = '';
  let hidden = 0;
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > maxLen - 28) {
      hidden++;
    } else {
      out = next;
    }
  }
  return hidden > 0 ? `${out}\n*...và ${hidden} người khác.*` : out;
}

export const data = new SlashCommandBuilder()
  .setName('team-status')
  .setDescription('Bảng điều khiển Quản lý: Xem quân số và tiến độ của role Member / 팀 전체 실시간 근무 현황')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const workDate = getWorkDate();
  const teamData = await getTeamTodaySummary(workDate);
  const hoursLeftBeforeCutoff = getHoursUntilCutoff().toFixed(1);

  const guild = interaction.guild;
  let targetMembers = [];

  if (guild && config.targetWorkerRoleId) {
    try {
      await guild.members.fetch({ time: 1200 }).catch(() => null);
      const role = guild.roles.cache.get(config.targetWorkerRoleId);
      if (role) {
        targetMembers = Array.from(role.members.values());
      }
    } catch (err) {
      console.warn('[TEAM STATUS] Lỗi fetch guild members:', err.message);
    }
  }

  const activeWorkers = [];
  const offWorkers = [];
  const notStartedWorkers = [];

  const teamMap = new Map();
  teamData.forEach(m => teamMap.set(m.discordId, m));

  if (targetMembers.length > 0) {
    for (const gm of targetMembers) {
      const did = gm.id;
      const dName = gm.displayName || gm.user.username;
      const m = teamMap.get(did);
      const targetStr = `${(m?.targetHours ?? config.dailyTargetHours)}h`;

      if (m && m.hasActiveShift) {
        const totalStr = formatMinutes(m.totalMinutes);
        activeWorkers.push(
          `• 🟢 **${dName}** (<@${did}>) ➔ Ca này / 이번: **${m.activeMinutes}분** | Tổng / 누적: \`${totalStr} / ${targetStr}\``
        );
      } else if (m && m.totalMinutes > 0) {
        const totalStr = formatMinutes(m.totalMinutes);
        const icon = m.isAchieved ? '🌟' : m.totalMinutes >= 240 ? '🟡' : '🔴';
        const statusNote = m.isAchieved ? `Đạt ${targetStr} SLA (달성)` : `Thiếu ${formatMinutes(m.remainingMinutes)} (미달)`;
        offWorkers.push(
          `• ${icon} **${dName}** (<@${did}>) ➔ \`${totalStr} / ${targetStr}\` (${statusNote})`
        );
      } else {
        notStartedWorkers.push(
          `• ⚪ **${dName}** (<@${did}>) ➔ Chưa vào ca / 미출근 *(0.0h / ${targetStr})*`
        );
      }
    }
  } else {
    for (const m of teamData) {
      const totalStr = formatMinutes(m.totalMinutes);
      const neededStr = formatMinutes(m.remainingMinutes);
      const targetStr = `${m.targetHours}h`;

      if (m.hasActiveShift) {
        activeWorkers.push(
          `• 🟢 **${m.displayName}** (<@${m.discordId}>) ➔ Ca này / 이번: **${m.activeMinutes}분** | Tổng / 누적: \`${totalStr} / ${targetStr}\``
        );
      } else {
        const icon = m.isAchieved ? '🌟' : m.totalMinutes >= 240 ? '🟡' : '🔴';
        const statusNote = m.isAchieved ? `Đạt ${targetStr} SLA (달성)` : `Thiếu ${neededStr} (미달)`;
        offWorkers.push(
          `• ${icon} **${m.displayName}** (<@${m.discordId}>) ➔ \`${totalStr} / ${targetStr}\` (${statusNote})`
        );
      }
    }
  }

  const totalHeadcount = targetMembers.length > 0 ? targetMembers.length : teamData.length;

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ QUÂN SỐ & TRẠNG THÁI NHÂN VIÊN (ROLE MEMBER) | 팀 실시간 현황`)
    .setDescription(
      `📅 **Chu kỳ / 일자:** \`${workDate}\`  •  ⏰ **Hạn chốt / 마감:** còn \`${hoursLeftBeforeCutoff}h\` (익일 06:00)\n` +
      `👥 **Quân số (Role Member) / 총 인원:** **${totalHeadcount}** nhân sự (명)\n` +
      `📊 **Phân bổ / 현황:** 🟢 **${activeWorkers.length}** Đang cày (진행)  |  ⚪ **${offWorkers.length}** Đang nghỉ (휴식)  |  🔴 **${notStartedWorkers.length}** Chưa vào ca (미출근)`
    )
    .setColor('#5865F2');

  if (activeWorkers.length > 0) {
    embed.addFields({
      name: `🟢 ĐANG TRONG CA / 근무 진행 중 (${activeWorkers.length} người / 명)`,
      value: joinLinesSafe(activeWorkers)
    });
  }

  if (offWorkers.length > 0) {
    embed.addFields({
      name: `⚪ ĐÃ CÀY HÔM NAY - ĐANG NGHỈ / 휴식 중 (${offWorkers.length} người / 명)`,
      value: joinLinesSafe(offWorkers)
    });
  }

  if (notStartedWorkers.length > 0) {
    embed.addFields({
      name: `🔴 CHƯA VÀO CA HÔM NAY / 미출근 (${notStartedWorkers.length} người / 명)`,
      value: joinLinesSafe(notStartedWorkers)
    });
  }

  embed.setFooter({ text: 'Gamefy Base Teams • Member Role Live Roster | 팀 인원 현황' });
  embed.setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}
