import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { 
  addOfficialAccount, 
  removeOfficialAccount, 
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
      .setDescription('Gỡ/Xóa nick game khỏi danh mục hoạt động / 계정 삭제')
      .addStringOption(opt =>
        opt.setName('code')
          .setDescription('Mã Nick Game cần gỡ')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('Xem toàn bộ danh sách nick game đang quản lý / 계정 목록')
  );

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
        `> **Mã Nick:** \`[${result.accountCode}]\`\n` +
        `> **Chỉ tiêu:** \`${result.targetHours.toFixed(1)}h / ngày\`\n\n` +
        `🎮 Nick này đã được kích hoạt và xuất hiện ngay trong menu **Vào Ca** của nhân sự!\n` +
        `-# 🇰🇷 해당 계정이 등록되어 작업자 출근 메뉴에 추가되었습니다.`
      )
      .setColor('#57F287')
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
        `> **Mã Nick đã gỡ:** \`[${result.accountCode}]\`\n\n` +
        `🛡️ Nick này đã được ẩn khỏi danh mục chọn ca cày của nhân sự. Toàn bộ lịch sử ca làm và bảng lương trước đây vẫn được bảo lưu an toàn!\n` +
        `-# 🇰🇷 해당 계정은 출근 목록에서 제외되었으며 기존 근무 기록은 안전하게 보존됩니다.`
      )
      .setColor('#ED4245')
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // 3. XEM DANH SÁCH NICK
  if (subcommand === 'list') {
    const accounts = await getAllOfficialAccounts();

    if (accounts.length === 0) {
      return interaction.reply({
        content: 'ℹ️ Chưa có Nick game nào trong danh mục. Dùng `/acc-manage add code:<tên>` để thêm!',
        ephemeral: true
      });
    }

    const activeList = accounts.filter(a => a.is_active === 1);
    const inactiveList = accounts.filter(a => a.is_active === 0);

    const embed = new EmbedBuilder()
      .setTitle('📋 DANH MỤC NICK GAME QUẢN LÝ | 계정 관리 목록')
      .setDescription(
        `• **Tổng số Nick:** \`${accounts.length}\` (${activeList.length} đang hoạt động, ${inactiveList.length} đã tắt)\n` +
        `• **Chỉ tiêu chuẩn:** \`8.0h / ngày / nick\`\n\n` +
        `-# 💡 Dùng lệnh \`/acc-manage add\` để thêm mới hoặc \`/acc-manage remove\` để gỡ.`
      )
      .setColor('#5865F2')
      .setTimestamp();

    if (activeList.length > 0) {
      const lines = activeList.map((a, i) => 
        `\`${String(i + 1).padStart(2, '0')}.\` 🟢 \`[${a.account_code}]\` • Target: **${Number(a.daily_target_hours).toFixed(1)}h**`
      );
      embed.addFields({
        name: `🟢 ĐANG HOẠT ĐỘNG (${activeList.length} Nick)`,
        value: lines.join('\n')
      });
    }

    if (inactiveList.length > 0) {
      const lines = inactiveList.map((a, i) => 
        `\`${String(i + 1).padStart(2, '0')}.\` ⚪ \`[${a.account_code}]\` • *(Đã tắt)*`
      );
      embed.addFields({
        name: `⚪ ĐÃ TẮT / KHÔNG HOẠT ĐỘNG (${inactiveList.length} Nick)`,
        value: lines.join('\n')
      });
    }

    return interaction.reply({ embeds: [embed] });
  }
}
