import dotenv from 'dotenv';
dotenv.config();

export const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  onShiftRoleId: process.env.ON_SHIFT_ROLE_ID || '',
  targetWorkerRoleId: process.env.TARGET_WORKER_ROLE_ID || '',
  alertChannelId: process.env.ALERT_CHANNEL_ID || '',
  dailyTargetHours: parseFloat(process.env.DAILY_TARGET_HOURS || '8.0'),
  cutoffHour: parseInt(process.env.CUTOFF_HOUR || '6', 10),
  timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',
};

export function validateConfig() {
  const missing = [];
  if (!config.discordToken) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');
  
  if (missing.length > 0) {
    console.warn(`[CẢNH BÁO CẤU HÌNH] Thiếu biến môi trường: ${missing.join(', ')}`);
    return false;
  }
  return true;
}
