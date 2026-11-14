import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import db from '../database/db.js';
import { getDaySummaryForUser, getWorkDate } from '../services/shiftService.js';
import { smartParseDate, buildDateAutocompleteChoices, formatTimeInTz } from '../utils/dateUtils.js';
import { formatMinutes } from '../utils/formatUtils.js';

const formatUserMins = (m) => formatMinutes(m, { bilingualUnderHour: true });

export const data = new SlashCommandBuilder()
  .setName('check-user')
  .setDescription('Kiểm tra chi tiết lịch sử ca làm của 1 nhân sự cụ thể / 특정 근무자 상세 조회')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Chọn nhân sự cần kiểm tra / 조회할 근무자 선택')
      .setRequired(true)
  )
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
  const targetUser = interaction.options.getUser('user');
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

  await interaction.deferReply({ ephemeral: true });

  const summary = await getDaySummaryForUser(targetUser.id, targetDate);

  // Lấy danh sách các ca làm của user trong ngày
  const shiftsRes = await db.execute({
    sql: `SELECT id, account_code, check_in, check_out, duration_minutes, status, note
          FROM shifts
          WHERE user_id = ? AND work_date = ?
          ORDER BY check_in ASC`,
    args: [targetUser.id, targetDate]
  });
  const shifts = shiftsRes.rows;

  const totalStr = formatUserMins(summary.totalMinutes);
  const remainingStr = formatUserMins(summary.remainingMinutes);
  const targetStr = Number(summary.targetHours).toFixed(1);
  const statusIcon = summary.isAchieved ? `✅ ĐẠT ${targetStr}H (달성)` : '⚠️ THIẾU GIỜ (미달)';

  let shiftListStr = '';
  if (shifts.length === 0) {
    shiftListStr = '*Không có ca làm việc nào được ghi nhận trong ngày này / 해당 일자의 근무 기록이 없습니다.*';
  } else {
    shiftListStr = shifts.map((s, idx) => {
      if (s.status === 'ADJUSTED') {
        const mins = Number(s.duration_minutes || 0);
        const sign = mins > 0 ? '+' : '';
        const note = s.note ? ` • *${s.note}*` : '';
        return `**${idx + 1}.** 🛠️ \`[ĐIỀU CHỈNH]\` **${sign}${formatUserMins(mins)}**${note}`;
      }
      const inTime = formatTimeInTz(s.check_in);
      const outTime = s.check_out
        ? formatTimeInTz(s.check_out)
        : 'Đang cày (진행 중)';
      const dur = s.duration_minutes ? formatUserMins(s.duration_minutes) : 'Đang chạy (진행 중)';
      const acc = s.account_code ? `\`[${s.account_code}]\`` : '';
      const note = s.note ? ` • *${s.note}*` : '';
      return `**${idx + 1}.** ${acc} ${inTime} ➔ ${outTime} (**${dur}**)${note}`;
    }).join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle(`👤 HỒ SƠ CHẤM CÔNG NHÂN VIÊN | 개인 근무 이력 조회`)
    .setDescription(
      `• **Nhân sự / 근무자:** <@${targetUser.id}> (${targetUser.username})\n` +
      `• **Ngày làm việc / 일자:** \`${targetDate}\`\n` +
      `• **Tổng giờ / 총 근무:** \`${totalStr} / ${targetStr}h\`\n` +
      `• **Trạng thái / 상태:** \`${statusIcon}\` (Thiếu / 잔여: ${remainingStr})\n\n` +
      `-# 🎯 Tiêu chuẩn cá nhân: ${targetStr}h/ngày • 🇰🇷 일일 개인 목표 ${targetStr}시간`
    )
    .setColor('#00D8F6')
    .addFields({
      name: `📋 CHI TIẾT CÁC CA LÀM / 근무 세부 기록 (${shifts.length} ca / 회)`,
      value: shiftListStr.slice(0, 1020)
    })
    .setFooter({ text: 'Gamefy Base Teams • Employee Audit Service | 개인 감사' })
    .setTimestamp();

  return interaction.editReply({
    embeds: [embed]
  });
}
