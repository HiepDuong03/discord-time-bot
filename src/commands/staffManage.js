import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import {
  getActiveShift,
  upsertStaffMember,
  removeStaffRecordIfUnused,
  getAllStaffMembers
} from '../services/shiftService.js';
import { config } from '../config/env.js';

const TARGET_HOUR_PRESETS = [
  { name: '⏱️ 8.0 giờ/ngày (Chuẩn / 기본)', value: 8.0 },
  { name: '⏱️ 4.0 giờ/ngày (Bán thời gian / 파트타임)', value: 4.0 },
  { name: '⏱️ 6.0 giờ/ngày', value: 6.0 },
  { name: '⏱️ 10.0 giờ/ngày', value: 10.0 },
  { name: '⏱️ 12.0 giờ/ngày', value: 12.0 }
];

export const data = new SlashCommandBuilder()
  .setName('staff-manage')
  .setDescription('Quản lý danh sách nhân viên chấm công & Role (Admin) / 직원 관리')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName('add')
      .setDescription('Thêm nhân viên vào DB & cấp Role chấm công / 직원 등록 및 역할 부여')
      .addUserOption(opt =>
        opt.setName('user')
          .setDescription('Chọn thành viên Discord / 직원 선택')
          .setRequired(true)
      )
      .addNumberOption(opt =>
        opt.setName('target')
          .setDescription(`Chỉ tiêu giờ/ngày (Mặc định: ${config.dailyTargetHours}h) / 일일 목표 시간`)
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Gỡ Role nhân viên & xóa khỏi DB nếu chưa có ca làm / 직원 해제')
      .addUserOption(opt =>
        opt.setName('user')
          .setDescription('Chọn nhân viên cần gỡ / 해제할 직원 선택')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('Xem toàn bộ danh sách nhân viên trong team / 전체 직원 목록')
  );

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'target') return;

  const query = String(focused.value || '').trim();
  const num = parseFloat(query);
  const choices = [];

  if (query && !Number.isNaN(num) && num > 0 && num <= 24) {
    choices.push({ name: `⏱️ Chỉ tiêu tùy chỉnh: ${num.toFixed(1)} giờ/ngày`, value: num });
  }

  for (const preset of TARGET_HOUR_PRESETS) {
    if (!query || String(preset.value).includes(query) || preset.name.toLowerCase().includes(query.toLowerCase())) {
      if (!choices.some(c => c.value === preset.value)) {
        choices.push(preset);
      }
    }
  }

  await interaction.respond(choices.slice(0, 25)).catch(() => {});
}

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'add') {
    const targetUser = interaction.options.getUser('user');
    const targetHours = interaction.options.getNumber('target') || config.dailyTargetHours;

    if (targetHours <= 0 || targetHours > 24) {
      return interaction.reply({
        content: '❌ Chỉ tiêu giờ/ngày phải nằm trong khoảng `0.5` đến `24` giờ!',
        ephemeral: true
      });
    }

    const guild = interaction.guild;
    const guildMember = guild ? await guild.members.fetch(targetUser.id).catch(() => null) : null;
    const displayName = guildMember?.displayName || targetUser.globalName || targetUser.username;

    await upsertStaffMember(targetUser.id, displayName, targetHours);

    let roleLine = '• **Role Discord:** Không cấu hình `TARGET_WORKER_ROLE_ID`.';
    let color = '#57F287';

    if (config.targetWorkerRoleId && guildMember) {
      if (guildMember.roles.cache.has(config.targetWorkerRoleId)) {
        roleLine = `• **Role Discord:** Đã có sẵn role <@&${config.targetWorkerRoleId}>.`;
      } else {
        try {
          await guildMember.roles.add(config.targetWorkerRoleId);
          roleLine = `• **Role Discord:** Đã cấp role <@&${config.targetWorkerRoleId}> thành công.`;
        } catch (err) {
          color = '#FEE75C';
          const isHierarchyOrPerm = err?.code === 50013;
          roleLine = isHierarchyOrPerm
            ? `• **Role Discord:** ⚠️ **Chưa cấp được** <@&${config.targetWorkerRoleId}> vì Role của Bot đang nằm thấp hơn Role này (lỗi 50013). Hãy vào **Server Settings → Roles** kéo role Bot lên trên rồi thử lại, hoặc tự gắn tay role.`
            : `• **Role Discord:** ⚠️ Không thể cấp role (${err.message}).`;
        }
      }
    } else if (config.targetWorkerRoleId && !guildMember) {
      color = '#FEE75C';
      roleLine = '• **Role Discord:** ⚠️ Thành viên chưa có mặt trong server Discord.';
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ ĐÃ THÊM / CẬP NHẬT NHÂN VIÊN | 직원 등록 완료')
      .setDescription(
        `• **Nhân sự / 직원:** <@${targetUser.id}> (**${displayName}**)\n` +
        `• **Chỉ tiêu ngày / 일일 목표:** \`${targetHours.toFixed(1)}h / ngày\`\n` +
        `• **Database:** Đã lưu vào hệ thống chấm công.\n` +
        `${roleLine}\n\n` +
        `-# 💡 Nhân sự có thể dùng \`/setup-panel\` để mở bảng chấm công cá nhân ngay.\n` +
        `-# 🇰🇷 직원이 시스템에 등록되었습니다.`
      )
      .setColor(color)
      .setFooter({ text: 'Gamefy Base Teams • Staff Management | 직원 관리' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (subcommand === 'remove') {
    const targetUser = interaction.options.getUser('user');
    const activeShift = await getActiveShift(targetUser.id);
    if (activeShift) {
      return interaction.reply({
        content: `❌ Không thể gỡ <@${targetUser.id}> vì nhân sự đang trong ca làm trên Nick \`[${activeShift.account_code}]\`.\n👉 Hãy dùng \`/force-checkout\` để chốt ca trước!`,
        ephemeral: true
      });
    }

    const guild = interaction.guild;
    const guildMember = guild ? await guild.members.fetch(targetUser.id).catch(() => null) : null;

    let roleLine = '• **Role Discord:** Không tìm thấy thành viên hoặc không cấu hình Role.';
    let color = '#ED4245';

    if (config.targetWorkerRoleId && guildMember) {
      if (!guildMember.roles.cache.has(config.targetWorkerRoleId)) {
        roleLine = `• **Role Discord:** Thành viên hiện không mang role <@&${config.targetWorkerRoleId}>.`;
      } else {
        try {
          await guildMember.roles.remove(config.targetWorkerRoleId);
          roleLine = `• **Role Discord:** Đã gỡ role <@&${config.targetWorkerRoleId}> thành công.`;
        } catch (err) {
          color = '#FEE75C';
          const isHierarchyOrPerm = err?.code === 50013;
          roleLine = isHierarchyOrPerm
            ? `• **Role Discord:** ⚠️ **Chưa gỡ được** <@&${config.targetWorkerRoleId}> vì Role của Bot đang nằm thấp hơn Role này (lỗi 50013). Hãy kéo role Bot lên cao hơn trong **Server Settings → Roles**.`
            : `• **Role Discord:** ⚠️ Không thể gỡ role (${err.message}).`;
        }
      }
    }

    const dbRes = await removeStaffRecordIfUnused(targetUser.id);
    const dbLine = dbRes.removedFromDb
      ? '• **Database:** Đã xóa hẳn hồ sơ khỏi bảng nhân viên (vì chưa có ca làm nào).'
      : dbRes.shiftCount > 0
        ? `• **Database:** 🛡️ Giữ lại hồ sơ và **${dbRes.shiftCount}** ca làm cũ để bảo toàn bảng lương & báo cáo Excel.`
        : '• **Database:** Không có hồ sơ trong DB.';

    const embed = new EmbedBuilder()
      .setTitle('🗑️ XỬ LÝ GỠ NHÂN VIÊN | 직원 해제 처리')
      .setDescription(
        `• **Nhân sự / 대상:** <@${targetUser.id}>\n` +
        `${roleLine}\n` +
        `${dbLine}\n\n` +
        `-# 🇰🇷 직원 역할 및 데이터베이스 상태가 업데이트되었습니다.`
      )
      .setColor(color)
      .setFooter({ text: 'Gamefy Base Teams • Staff Management | 직원 관리' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (subcommand === 'list') {
    await interaction.deferReply({ ephemeral: false });

    const dbStaff = await getAllStaffMembers();
    const dbMap = new Map(dbStaff.map(u => [u.discord_id, u]));

    const roleMemberIds = new Set();
    if (config.targetWorkerRoleId && interaction.guild) {
      try {
        await interaction.guild.members.fetch();
        const role = interaction.guild.roles.cache.get(config.targetWorkerRoleId);
        if (role) {
          role.members.forEach(m => roleMemberIds.add(m.id));
        }
      } catch {
        // Fallback nếu chưa có quyền fetch toàn bộ guild members
      }
    }

    const combinedIds = new Set([...dbMap.keys(), ...roleMemberIds]);
    if (combinedIds.size === 0) {
      return interaction.editReply({
        content: '📂 Danh sách nhân viên hiện đang trống. Dùng `/staff-manage add` để thêm nhân viên mới!'
      });
    }

    const rows = Array.from(combinedIds).map(id => {
      const dbRow = dbMap.get(id);
      const gm = interaction.guild?.members?.cache?.get(id);
      const hasRole = roleMemberIds.has(id);
      const name = gm?.displayName || dbRow?.display_name || id;
      const targetHours = dbRow ? Number(dbRow.daily_target_hours).toFixed(1) : config.dailyTargetHours.toFixed(1);
      const totalShifts = dbRow ? Number(dbRow.total_shifts || 0) : 0;
      const isActive = dbRow ? Number(dbRow.active_shifts || 0) > 0 : false;
      return { id, name, hasRole, inDb: !!dbRow, targetHours, totalShifts, isActive };
    });

    rows.sort((a, b) => {
      if (a.hasRole !== b.hasRole) return a.hasRole ? -1 : 1;
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const roleCount = rows.filter(r => r.hasRole).length;
    const lines = rows.slice(0, 35).map((r, i) => {
      const idx = String(i + 1).padStart(2, '0');
      const roleTag = r.hasRole ? '🟢 Member' : '⚪ Chưa có Role';
      const activeTag = r.isActive ? ' • ⚡ Đang cày' : '';
      return `\`${idx}.\` ${roleTag} <@${r.id}> (**${r.name}**) • Target: \`${r.targetHours}h\` • \`${r.totalShifts}\` ca${activeTag}`;
    });

    if (rows.length > 35) {
      lines.push(`*...và ${rows.length - 35} nhân sự khác.*`);
    }

    const embed = new EmbedBuilder()
      .setTitle('👥 DANH SÁCH NHÂN SỰ TEAM | 팀 직원 목록')
      .setDescription(
        `• **Tổng nhân sự ghi nhận / 총 인원:** \`${rows.length}\` (**${roleCount}** có role chấm công, **${dbStaff.length}** lưu trong DB)\n` +
        `• **Lệnh nhanh:** \`/staff-manage add\` để thêm | \`/staff-manage remove\` để gỡ\n\n` +
        lines.join('\n')
      )
      .setColor('#5865F2')
      .setFooter({ text: 'Gamefy Base Teams • Staff Management | 직원 관리' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
}
