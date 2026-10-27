import cron from 'node-cron';
import { config } from '../config/env.js';
import { getTeamTodaySummary } from './shiftService.js';

export function getHoursUntilCutoff(now = new Date()) {
  const cutoff = new Date(now);
  if (now.getHours() >= config.cutoffHour) {
    cutoff.setDate(cutoff.getDate() + 1);
  }
  cutoff.setHours(config.cutoffHour, 0, 0, 0);
  const diffMs = cutoff.getTime() - now.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60));
}

/**
 * Gửi cảnh báo song ngữ (Việt - Hàn) vào cả Kênh Chung và Tin Nhắn Riêng (DM)
 */
export async function sendDailyReminders(client, alertType = '18_PM') {
  if (!config.alertChannelId) {
    console.log('[REMINDER] Bỏ qua vì chưa cấu hình ALERT_CHANNEL_ID');
    return;
  }

  try {
    const channel = await client.channels.fetch(config.alertChannelId);
    if (!channel) {
      console.error('[REMINDER] Không tìm thấy kênh với ID:', config.alertChannelId);
      return;
    }

    const guild = channel.guild;
    const teamSummary = getTeamTodaySummary();
    if (teamSummary.length === 0) return;

    const now = new Date();
    const hoursRemainingInDay = getHoursUntilCutoff(now);

    const channelWarnings = [];

    for (const member of teamSummary) {
      // 1. Kiểm tra lọc theo Role (Nếu có TARGET_WORKER_ROLE_ID thì người đó phải có role Member)
      if (config.targetWorkerRoleId && guild) {
        try {
          const guildMember = await guild.members.fetch(member.discordId).catch(() => null);
          if (!guildMember || !guildMember.roles.cache.has(config.targetWorkerRoleId)) {
            // Người này không mang role Worker/Member (ví dụ Leader/Manager) -> Bỏ qua không nhắc
            continue;
          }
        } catch {
          // Bỏ qua lỗi fetch member
        }
      }

      if (member.isAchieved) continue; // Đã xong 8h, không nhắc

      const completedHours = (member.totalMinutes / 60).toFixed(1);
      const neededHours = (member.remainingMinutes / 60).toFixed(1);
      const safetyMarginHours = hoursRemainingInDay - (member.remainingMinutes / 60);

      let shouldAlert = false;
      let alertContentVi = '';
      let alertContentKo = '';

      if (alertType === '18_PM') {
        if (member.totalMinutes < 240) { // Dưới 4 tiếng
          shouldAlert = true;
          alertContentVi = `Mới làm **${completedHours}h/${member.targetHours}h** (Còn thiếu **${neededHours}h**). Tranh thủ vào ca nhé!`;
          alertContentKo = `현재 **${completedHours}시간/${member.targetHours}시간** 근무 (남은 시간: **${neededHours}시간**). 근무를 진행해주세요!`;
        }
      } else if (alertType === '22_PM') {
        shouldAlert = true;
        if (safetyMarginHours < 0) {
          alertContentVi = `🚨 **ĐIỂM NGUY CẤP!** Thiếu **${neededHours}h** nhưng quỹ thời gian đến 06:00 chỉ còn **${hoursRemainingInDay.toFixed(1)}h**!`;
          alertContentKo = `🚨 **긴급 위험!** 남은 근무: **${neededHours}시간**, 마감까지 남은 시간: **${hoursRemainingInDay.toFixed(1)}시간**!`;
        } else {
          alertContentVi = `⚠️ Còn thiếu **${neededHours}h**, thời gian đến 06:00 chỉ còn **${hoursRemainingInDay.toFixed(1)}h**!`;
          alertContentKo = `⚠️ 남은 근무: **${neededHours}시간**, 마감까지 남은 시간: **${hoursRemainingInDay.toFixed(1)}시간**!`;
        }
      }

      if (shouldAlert) {
        // Dòng tin nhắn gửi lên kênh chung
        channelWarnings.push(
          `• <@${member.discordId}>: ${alertContentVi}\n  └ 🇰🇷 *${alertContentKo}*`
        );

        // 2. Gửi Tin Nhắn Riêng (DM) trực tiếp cho nhân viên
        try {
          const discordUser = await client.users.fetch(member.discordId);
          if (discordUser) {
            const dmTitle = alertType === '18_PM'
              ? '⏰ **[NHẮC NHỞ TIẾN ĐỘ / 근무 알림]**'
              : '🚨 **[CẢNH BÁO KHẨN CẤP / 긴급 근무 경고]**';

            await discordUser.send(
              `${dmTitle}\n\n` +
              `👋 Chào **${member.displayName}**!\n` +
              `• ${alertContentVi}\n` +
              `• ${alertContentKo}\n\n` +
              `⏱️ Chu kỳ ngày chốt lúc **06:00 AM** sáng mai. Nhớ bấm "Vào ca" khi bắt đầu nhé!\n` +
              `*(일일 마감은 익일 06:00 AM입니다. 작업 시 출근 버튼을 꼭 눌러주세요!)*`
            );
            console.log(`[DM SUCCESS] Đã gửi DM nhắc nhở tới ${member.displayName}`);
          }
        } catch (dmErr) {
          console.warn(`[DM BLOCKED] Không thể gửi DM tới ${member.displayName} (có thể chặn DM người lạ)`);
        }
      }
    }

    // 3. Đăng thông báo tổng hợp lên Kênh chung để Quản lý nắm
    if (channelWarnings.length > 0) {
      const channelTitle = alertType === '18_PM'
        ? '⏰ **[NHẮC NHỞ TIẾN ĐỘ 18:00 / 18:00 일일 근무 진행 알림]**'
        : '🚨 **[CẢNH BÁO KHẨN CẤP 22:00 / 22:00 긴급 마감 경고]**';

      const fullMessage = 
        `${channelTitle}\n\n` +
        `${channelWarnings.join('\n\n')}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 *Chu kỳ chốt ngày: 06:00 sáng mai / 일일 마감 시간: 익일 06:00 AM*`;

      await channel.send(fullMessage);
      console.log(`[REMINDER] Đã gửi cảnh báo ${alertType} lên kênh chung cho ${channelWarnings.length} thành viên.`);
    }
  } catch (error) {
    console.error('[REMINDER ERROR] Lỗi gửi nhắc nhở:', error);
  }
}

export function initReminderCron(client) {
  // 18:00 mỗi ngày
  cron.schedule('0 18 * * *', () => {
    console.log('[CRON] Chạy quét nhắc nhở 18:00 (Kênh + DM)...');
    sendDailyReminders(client, '18_PM');
  }, { timezone: config.timezone });

  // 22:00 mỗi ngày
  cron.schedule('0 22 * * *', () => {
    console.log('[CRON] Chạy quét cảnh báo 22:00 (Kênh + DM)...');
    sendDailyReminders(client, '22_PM');
  }, { timezone: config.timezone });

  console.log('[CRON] Đã kích hoạt lịch nhắc nhở tự động 18:00 & 22:00 (Song ngữ + Gửi Kênh & DM).');
}
