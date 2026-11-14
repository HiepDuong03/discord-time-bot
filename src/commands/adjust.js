import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { adjustShiftTime, registerOrUpdateUser } from '../services/shiftService.js';

const MINUTE_PRESETS = [
  { name: '➕ +30 phút (0.5h)', value: 30 },
  { name: '➕ +60 phút (1.0h)', value: 60 },
  { name: '➕ +120 phút (2.0h)', value: 120 },
  { name: '➕ +240 phút (4.0h)', value: 240 },
  { name: '➕ +480 phút (8.0h - Đủ chỉ tiêu ngày)', value: 480 },
  { name: '➖ -30 phút (-0.5h)', value: -30 },
  { name: '➖ -60 phút (-1.0h)', value: -60 },
  { name: '➖ -120 phút (-2.0h)', value: -120 },
  { name: '➖ -240 phút (-4.0h)', value: -240 },
  { name: '➖ -480 phút (-8.0h)', value: -480 }
];

const ADJUST_REASONS = [
  'Bù giờ do quên bấm Vào ca (출근 버튼 누락 보정)',
  'Bù giờ lỗi mạng / lỗi hệ thống (시스템/네트워크 오류 보정)',
  'Thưởng thêm giờ làm / OT (추가 근무 보상)',
  'Trừ giờ do quên bấm Hết ca (퇴근 미처리 차감)',
  'Trừ giờ nghỉ giữa ca / việc riêng (개인 사유 휴식 차감)',
  'Quản lý điều chỉnh giờ thủ công (관리자 수동 조정)'
];

export const data = new SlashCommandBuilder()
  .setName('adjust-time')
  .setDescription('Điều chỉnh (bù hoặc trừ) số phút làm việc của nhân sự / 근무 시간 수동 조정')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption(option =>
    option.setName('user')
      .setDescription('Chọn thành viên cần điều chỉnh / 조정할 근무자 선택')
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName('minutes')
      .setDescription('Chọn mốc phút hoặc gõ số (+/- phút, vd: 45 hoặc -30) / 조정 시간(분)')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName('reason')
      .setDescription('Chọn lý do hoặc gõ tự do (mặc định tự điền) / 조정 사유')
      .setRequired(false)
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  const query = String(focusedOption.value || '').trim().toLowerCase();

  if (focusedOption.name === 'minutes') {
    const choices = [];
    const parsedNum = parseInt(query, 10);
    if (query && !Number.isNaN(parsedNum) && parsedNum !== 0) {
      const sign = parsedNum > 0 ? '+' : '';
      choices.push({
        name: `⏱️ Số tùy chỉnh: ${sign}${parsedNum} phút (${(parsedNum / 60).toFixed(2)}h)`,
        value: parsedNum
      });
    }

    for (const preset of MINUTE_PRESETS) {
      if (!query || preset.name.toLowerCase().includes(query) || String(preset.value).includes(query)) {
        if (!choices.some(c => c.value === preset.value)) {
          choices.push(preset);
        }
      }
    }

    return interaction.respond(choices.slice(0, 25)).catch(() => {});
  }

  if (focusedOption.name === 'reason') {
    const choices = ADJUST_REASONS
      .filter(r => !query || r.toLowerCase().includes(query))
      .map(r => ({ name: r, value: r }));
    return interaction.respond(choices.slice(0, 25)).catch(() => {});
  }
}

export async function execute(interaction) {
  const targetUser = interaction.options.getUser('user');
  const minutes = interaction.options.getInteger('minutes');
  const reason = interaction.options.getString('reason')?.trim() || 'Quản lý điều chỉnh giờ thủ công';
  const leaderName = interaction.member?.displayName || interaction.user.username;

  if (minutes === 0) {
    return interaction.reply({
      content: '❌ Số phút điều chỉnh phải khác `0`!',
      ephemeral: true
    });
  }

  try {
    const memberObj = interaction.guild?.members?.cache?.get(targetUser.id);
    const displayName = memberObj?.displayName || targetUser.globalName || targetUser.username;
    await registerOrUpdateUser(targetUser.id, displayName);

    const result = await adjustShiftTime(targetUser.id, minutes, reason, leaderName);
    const sign = minutes > 0 ? '+' : '';

    const embed = new EmbedBuilder()
      .setTitle('⏱️ ĐIỀU CHỈNH GIỜ LÀM VIỆC | 근무 시간 조정 완료')
      .setDescription(
        `• **Nhân sự / 대상 작업자:** <@${targetUser.id}> (${targetUser.username})\n` +
        `• **Thay đổi / 시간 변동:** **${sign}${minutes} phút / 분** (${(minutes / 60).toFixed(2)}h)\n` +
        `• **Ngày áp dụng / 적용 일자:** \`${result.workDate}\`\n` +
        `• **Người duyệt / 승인자:** **${leaderName}**\n` +
        `• **Lý do / 조정 사유:** *${reason}*\n\n` +
        `-# 💡 Đã cập nhật vào cơ sở dữ liệu và ghi log kiểm toán.\n` +
        `-# 🇰🇷 근무 시간이 수정되었으며 감사 로그에 안전하게 기록되었습니다.`
      )
      .setColor('#5865F2')
      .setFooter({ text: 'Gamefy Base Teams • Time Adjustment | 근무 조정' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('[ADJUST ERROR]', error);
    return interaction.reply({
      content: `❌ Lỗi khi điều chỉnh giờ / 오류 발생: ${error.message}`,
      ephemeral: true
    });
  }
}
