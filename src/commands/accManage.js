import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { 
  addOfficialAccount, 
  removeOfficialAccount,
  deleteOfficialAccount,
  getAllOfficialAccounts 
} from '../services/shiftService.js';

export const data = new SlashCommandBuilder()
  .setName('acc-manage')
  .setDescription('Quản lý danh mục Nick Game chính thức của team (Admin) / 계정 관리')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName('add')
      .setDescription('Thêm nick game mới vào danh mục hoạt động / 계정 추가')
      .addStringOption(opt =>
        opt.setName('code')
          .setDescription('Mã hoặc Tên Nick Game (Ví dụ: Acc_01, Acc_02, Nam_01)')
          .setRequired(true)
      )
      .addNumberOption(opt =>
        opt.setName('target')
          .setDescription('Chỉ tiêu giờ cày/ngày (Mặc định: 8.0 giờ)')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Tắt tạm thời nick game (vẫn giữ bảng lương cũ) / 계정 비활성화')
      .addStringOption(opt =>
        opt.setName('code')
          .setDescription('Chọn hoặc nhập mã Nick Game cần tắt')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('delete')
      .setDescription('Xóa vĩnh viễn nick game khỏi Database / DB에서 계정 영구 삭제')
      .addStringOption(opt =>
        opt.setName('code')
          .setDescription('Chọn hoặc nhập mã Nick Game cần xóa hẳn')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addBooleanOption(opt =>
        opt.setName('delete_shifts')
          .setDescription('Xóa luôn lịch sử ca cũ của nick này? (Mặc định: Không, để giữ bảng lương)')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('Xem toàn bộ danh sách nick game đang quản lý / 계정 목록')
  );

/**
 * Gợi ý danh sách Nick Game từ Database cho subcommand remove / delete
 */
export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'code') return;

  const sub = interaction.options.getSubcommand(false);
  const query = focused.value.trim().toLowerCase();
  const accounts = await getAllOfficialAccounts();

  const filtered = accounts
    .filter(a => (sub === 'remove' ? a.is_active === 1 : true))
    .filter(a => !query || a.account_code.toLowerCase().includes(query))
    .slice(0, 25)
    .map(a => {
      const statusLabel = a.is_active === 1 ? '🟢 Đang bật' : '⚪ Đã tắt';
      const label = `${statusLabel} • ${a.account_code} (${Number(a.daily_target_hours).toFixed(1)}h)`;
      return {
        name: label.slice(0, 100),
        value: a.account_code.slice(0, 100)
      };
    });

  await interaction.respond(filtered).catch(() => {});
}

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  // 1. THÊM NICK MỚI
  if (subcommand === 'add') {
    const code = interaction.options.getString('code').trim();
    const targetHours = interaction.options.getNumber('target') || 8.0;

    const result = await addOfficialAccount(code, targetHours);
    if (!result.success) {
      return interaction.reply({
        content: `❌ ${result.message}`,
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ THÊM NICK GAME THÀNH CÔNG | 계정 등록 완료')
      .setDescription(
        `> **Mã Nick / 계정 코드:** \`[${result.accountCode}]\`\n` +
        `> **Chỉ tiêu / 일일 목표:** \`${result.targetHours.toFixed(1)}h / ngày (일)\`\n\n` +
        `🎮 Nick này đã được kích hoạt và xuất hiện ngay trong menu **Vào Ca** của nhân sự!\n` +
        `-# 🇰🇷 해당 계정이 등록되어 작업자 출근 메뉴에 추가되었습니다.`
      )
      .setColor('#57F287')
      .setFooter({ text: 'Gamefy Base Teams • Account Management | 계정 관리' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // 2. GỠ / XÓA NICK
  if (subcommand === 'remove') {
    const code = interaction.options.getString('code').trim();
    const result = await removeOfficialAccount(code);

    if (!result.success) {
      return interaction.reply({
        content: `❌ ${result.message}`,
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🗑️ ĐÃ GỠ NICK GAME KHỎI HOẠT ĐỘNG | 계정 비활성화')
      .setDescription(
        `> **Mã Nick đã gỡ / 비활성화 계정:** \`[${result.accountCode}]\`\n\n` +
        `🛡️ Nick này đã được ẩn khỏi danh mục chọn ca cày của nhân sự. Toàn bộ lịch sử ca làm và bảng lương trước đây vẫn được bảo lưu an toàn!\n` +
        `-# 🇰🇷 해당 계정은 출근 목록에서 제외되었으며 기존 근무 기록은 안전하게 보존됩니다.`
      )
      .setColor('#ED4245')
      .setFooter({ text: 'Gamefy Base Teams • Account Management | 계정 관리' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // 3. XÓA VĨNH VIỄN NICK KHỎI DB (HARD DELETE)
  if (subcommand === 'delete') {
    const code = interaction.options.getString('code').trim();
    const deleteShifts = interaction.options.getBoolean('delete_shifts') || false;
    const result = await deleteOfficialAccount(code, deleteShifts);

    if (!result.success) {
      return interaction.reply({
        content: `❌ ${result.message}`,
        ephemeral: true
      });
    }

    const shiftHistoryNote = deleteShifts
      ? `🧹 Đã xóa luôn **${result.deletedShifts}** ca làm lịch sử của nick này.`
      : `🛡️ Đã giữ lại **${result.preservedShifts}** ca làm cũ để không ảnh hưởng bảng lương đã chốt.`;

    const embed = new EmbedBuilder()
      .setTitle('💥 ĐÃ XÓA VĨNH VIỄN NICK GAME KHỎI DB | 계정 영구 삭제 완료')
      .setDescription(
        `> **Mã Nick đã xóa / 삭제된 계정:** \`[${result.accountCode}]\`\n\n` +
        `${shiftHistoryNote}\n` +
        `-# 🇰🇷 계정이 데이터베이스에서 영구 삭제되었습니다.`
      )
      .setColor('#ED4245')
      .setFooter({ text: 'Gamefy Base Teams • Account Management | 계정 관리' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // 4. XEM DANH SÁCH NICK
  if (subcommand === 'list') {
    const accounts = await getAllOfficialAccounts();

    if (accounts.length === 0) {
      return interaction.reply({
        content: 'ℹ️ Chưa có Nick game nào trong danh mục. Dùng `/acc-manage add code:Acc_01` để thêm!\n*(등록된 계정이 없습니다. /acc-manage add 명령어로 추가하세요.)*',
        ephemeral: true
      });
    }

    const activeList = accounts.filter(a => a.is_active === 1);
    const inactiveList = accounts.filter(a => a.is_active === 0);

    const embed = new EmbedBuilder()
      .setTitle('📋 DANH MỤC NICK GAME QUẢN LÝ | 계정 관리 목록')
      .setDescription(
        `• **Tổng số Nick / 총 계정 수:** \`${accounts.length}\` (${activeList.length} đang bật 활성, ${inactiveList.length} đã tắt 비활성)\n` +
        `• **Chỉ tiêu chuẩn / 기본 목표:** \`8.0h / ngày / nick (일일 8시간)\`\n\n` +
        `-# 💡 Dùng \`/acc-manage add\` (thêm), \`remove\` (tắt tạm) hoặc \`delete\` (xóa hẳn khỏi DB).\n` +
        `-# 🇰🇷 /acc-manage add (추가), remove (비활성화), delete (영구 삭제)`
      )
      .setColor('#5865F2')
      .setFooter({ text: 'Gamefy Base Teams • Account Management | 계정 관리' })
      .setTimestamp();

    if (activeList.length > 0) {
      const lines = activeList.map((a, i) => 
        `\`${String(i + 1).padStart(2, '0')}.\` 🟢 \`[${a.account_code}]\` • Target / 목표: **${Number(a.daily_target_hours).toFixed(1)}h**`
      );
      embed.addFields({
        name: `🟢 ĐANG HOẠT ĐỘNG / 활성 계정 (${activeList.length} Nick / 개)`,
        value: lines.join('\n')
      });
    }

    if (inactiveList.length > 0) {
      const lines = inactiveList.map((a, i) => 
        `\`${String(i + 1).padStart(2, '0')}.\` ⚪ \`[${a.account_code}]\` • *(Đã tắt / 비활성)*`
      );
      embed.addFields({
        name: `⚪ ĐÃ TẮT / 비활성 계정 (${inactiveList.length} Nick / 개)`,
        value: lines.join('\n')
      });
    }

    return interaction.reply({ embeds: [embed] });
  }
}
