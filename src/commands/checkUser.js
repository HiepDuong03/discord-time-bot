import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import db from '../database/db.js';
import { getDaySummaryForUser, getWorkDate } from '../services/shiftService.js';

function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const hours = Math.floor(m / 60);
  const remainingMins = m % 60;
  const decimalHours = (m / 60).toFixed(2);

  if (hours === 0) {
    return `${remainingMins} phút / 분 (${decimalHours}h)`;
  }
  return `${hours}h ${remainingMins}p (${decimalHours}h)`;
}

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
      .setDescription('Ngày cần xem (YYYY-MM-DD, mặc định hôm nay / 조회 일자)')
      .setRequired(false)
  );

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('user');
  const customDate = interaction.options.getString('date');
  const targetDate = customDate ? customDate.trim() : getWorkDate();

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

  const totalStr = formatMinutes(summary.totalMinutes);
  const remainingStr = formatMinutes(summary.remainingMinutes);
  const statusIcon = summary.isAchieved ? '✅ ĐẠT 8H (달성)' : '⚠️ THIẾU GIỜ (미달)';

  let shiftListStr = '';
  if (shifts.length === 0) {
    shiftListStr = '*Không có ca làm việc nào được ghi nhận trong ngày này / 해당 일자의 근무 기록이 없습니다.*';
  } else {
    shiftListStr = shifts.map((s, idx) => {
      const inTime = new Date(s.check_in).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      const outTime = s.check_out 
        ? new Date(s.check_out).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        : 'Đang cày (진행 중)';
      const dur = s.duration_minutes ? formatMinutes(s.duration_minutes) : 'Đang chạy (진행 중)';
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
      `• **Tổng giờ / 총 근무:** \`${totalStr} / ${summary.targetHours}h\`\n` +
      `• **Trạng thái / 상태:** \`${statusIcon}\` (Thiếu / 잔여: ${remainingStr})\n\n` +
      `-# 🎯 Tiêu chuẩn cá nhân: 8.0h/ngày • 🇰🇷 일일 개인 목표 8.0시간`
    )
    .setColor('#00D8F6')
    .addFields({
      name: `📋 CHI TIẾT CÁC CA LÀM / 근무 세부 기록 (${shifts.length} ca / 회)`,
      value: shiftListStr
    })
    .setFooter({ text: 'Gamefy Base Teams • Employee Audit Service | 개인 감사' })
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}
