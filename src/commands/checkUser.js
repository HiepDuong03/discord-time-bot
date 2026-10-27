import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import db from '../database/db.js';
import { getDaySummaryForUser, getWorkDate } from '../services/shiftService.js';

function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const hours = Math.floor(m / 60);
  const remainingMins = m % 60;
  const decimalHours = (m / 60).toFixed(2);

  if (hours === 0) {
    return `${remainingMins} phút (${decimalHours}h)`;
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
    sql: `SELECT id, check_in, check_out, duration_minutes, status, note
          FROM shifts
          WHERE user_id = ? AND work_date = ?
          ORDER BY check_in ASC`,
    args: [targetUser.id, targetDate]
  });
  const shifts = shiftsRes.rows;

  const totalStr = formatMinutes(summary.totalMinutes);
  const remainingStr = formatMinutes(summary.remainingMinutes);
  const statusIcon = summary.isAchieved ? '✅ ĐẠT 8H' : '⚠️ THIẾU GIỜ';

  let shiftListStr = '';
  if (shifts.length === 0) {
    shiftListStr = '*Không có ca làm việc nào được ghi nhận trong ngày này.*';
  } else {
    shiftListStr = shifts.map((s, idx) => {
      const inTime = new Date(s.check_in).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      const outTime = s.check_out 
        ? new Date(s.check_out).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        : '⏳ Đang làm...';
      const durationStr = s.check_out ? formatMinutes(s.duration_minutes) : 'Chưa kết thúc';
      const noteStr = s.note ? ` | Note: *${s.note}*` : '';
      return `**Ca ${idx + 1}:** \`${inTime}\` ➔ \`${outTime}\` (**${durationStr}**) [${s.status}]${noteStr}`;
    }).join('\n');
  }

  const embed = new EmbedBuilder()
    .setTitle(`👤 CHI TIẾT CA LÀM VIỆC: ${targetUser.username}`)
    .setDescription(
      `• **Nhân sự:** <@${targetUser.id}>\n` +
      `• **Ngày làm việc:** \`${targetDate}\`\n` +
      `• **Tổng thời gian tích lũy:** **${totalStr} / ${summary.targetHours}h** (${statusIcon})\n` +
      `• **Số giờ còn thiếu:** **${remainingStr}**\n\n` +
      `📋 **Lịch sử các ca trong ngày:**\n${shiftListStr}`
    )
    .setColor('#9B59B6')
    .setFooter({ text: 'Dành riêng cho Quản lý • AURA Management' })
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}
