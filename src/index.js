import { 
  Client, 
  GatewayIntentBits, 
  Collection, 
  REST, 
  Routes 
} from 'discord.js';
import http from 'node:http';
import { config, validateConfig } from './config/env.js';
import db, { initDatabase } from './database/db.js';
import { handleButtonInteraction, handleModalInteraction, handleSelectMenuInteraction } from './interactions/buttonHandler.js';
import { initReminderCron } from './services/reminderService.js';

// Import các lệnh Slash
import * as panelCommand from './commands/panel.js';
import * as exportCommand from './commands/export.js';
import * as reportCommand from './commands/report.js';
import * as adjustCommand from './commands/adjust.js';
import * as teamStatusCommand from './commands/teamStatus.js';
import * as checkUserCommand from './commands/checkUser.js';
import * as accStatusCommand from './commands/accStatus.js';
import * as forceCheckoutCommand from './commands/forceCheckout.js';

console.log('====================================================');
console.log('🤖 KHỞI ĐỘNG DISCORD BOT CHẤM CÔNG & QUẢN LÝ TEAM');
console.log('====================================================');

const isConfigValid = validateConfig();
if (!isConfigValid) {
  console.log('\n👉 Vui lòng tạo file .env trong thư mục dự án và điền DISCORD_TOKEN để bắt đầu.');
  console.log('Xem hướng dẫn chi tiết tại README.md\n');
}

// Khởi tạo Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

// Khởi tạo HTTP Health Check Server (Dành cho Cloud Hosting / UptimeRobot)
const PORT = process.env.PORT || 8080;
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('AURA Time Tracking Discord Bot is Online 24/7!');
});
httpServer.listen(PORT, () => {
  console.log(`[HTTP] Health check server đang lắng nghe tại cổng: ${PORT}`);
});

// Bộ sưu tập lệnh
client.commands = new Collection();
const commandList = [
  panelCommand, 
  exportCommand, 
  reportCommand, 
  adjustCommand, 
  teamStatusCommand, 
  checkUserCommand,
  accStatusCommand,
  forceCheckoutCommand
];

for (const cmd of commandList) {
  client.commands.set(cmd.data.name, cmd);
}

/**
 * Đăng ký Slash Commands với Discord API
 */
async function registerSlashCommands() {
  if (!config.discordToken || !config.clientId) return;

  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const commandsData = commandList.map(cmd => cmd.data.toJSON());

  try {
    console.log(`[SLASH COMMANDS] Đang đồng bộ ${commandsData.length} lệnh lên Discord...`);
    
    if (config.guildId) {
      // Cập nhật tức thì cho Guild cụ thể
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commandsData }
      );
      console.log(`[SLASH COMMANDS] Đã kích hoạt lệnh tức thì trên Guild: ${config.guildId}`);
    } else {
      // Cập nhật Global (có thể mất 15-30 phút để lan truyền)
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commandsData }
      );
      console.log('[SLASH COMMANDS] Đã đăng ký lệnh toàn cục (Global)');
    }
  } catch (error) {
    console.error('[SLASH COMMANDS ERROR] Lỗi đăng ký lệnh:', error);
  }
}

// Sự kiện khi Bot online
client.once('ready', async () => {
  console.log(`\n✅ Bot đã đăng nhập thành công với tên: ${client.user.tag}`);
  console.log(`⚡ Mốc chốt ngày: ${config.cutoffHour}:00 sáng | Chỉ tiêu: ${config.dailyTargetHours}h/ngày`);
  
  // Khởi tạo và đồng bộ Database Cloud
  await initDatabase();

  // Đăng ký slash commands
  await registerSlashCommands();

  // Kích hoạt Cron nhắc nhở tự động
  initReminderCron(client);

  console.log('🚀 BOT ĐÃ SẴN SÀNG HOẠT ĐỘNG 24/7!\n');
});

// Sự kiện bắt tương tác (Commands & Buttons)
client.on('interactionCreate', async (interaction) => {
  try {
    // 1. Xử lý nút bấm Chấm công
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      return;
    }

    // 2. Xử lý nộp form Modal (Chọn Nick game)
    if (interaction.isModalSubmit()) {
      await handleModalInteraction(interaction);
      return;
    }

    // 3. Xử lý chọn mục từ Menu (Select Menu)
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenuInteraction(interaction);
      return;
    }

    // 4. Xử lý Slash Commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      await command.execute(interaction);
    }
  } catch (error) {
    console.error(`[INTERACTION ERROR] Lỗi tại tương tác ${interaction.id}:`, error);
    const replyContent = { content: '❌ Đã xảy ra lỗi nội bộ khi xử lý thao tác này!', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyContent).catch(() => {});
    } else {
      await interaction.reply(replyContent).catch(() => {});
    }
  }
});

// Đăng nhập bot nếu có token
if (config.discordToken) {
  client.login(config.discordToken).catch(err => {
    console.error('❌ Không thể đăng nhập Discord Bot:', err.message);
  });
}

// Xử lý tắt bot an toàn
process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Đang đóng kết nối an toàn...');
  db.close();
  client.destroy();
  process.exit(0);
});
