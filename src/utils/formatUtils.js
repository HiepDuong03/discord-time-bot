/**
 * Format số phút (có thể âm với ca điều chỉnh) thành chuỗi đọc gọn hoặc song ngữ
 */
export function formatMinutes(minutes, { bilingualUnderHour = false } = {}) {
  const rounded = Math.round(minutes);
  const sign = rounded < 0 ? '-' : '';
  const absMins = Math.abs(rounded);
  const hours = Math.floor(absMins / 60);
  const remainingMins = absMins % 60;
  const decimalHours = (rounded / 60).toFixed(2);

  if (hours === 0) {
    return bilingualUnderHour
      ? `${sign}${remainingMins} phút / 분 (${decimalHours}h)`
      : `${sign}${remainingMins}p (${decimalHours}h)`;
  }
  return `${sign}${hours}h ${remainingMins}p (${decimalHours}h)`;
}

/**
 * Thanh tiến độ phần trăm cho Panel/Status (mặc định 12 ô)
 */
export function createProgressBar(percent, length = 12) {
  const filled = Math.min(length, Math.max(0, Math.round((percent / 100) * length)));
  const empty = length - filled;
  return `${'▰'.repeat(filled)}${'▱'.repeat(empty)}`;
}

/**
 * Thanh tiến độ mini theo số phút / target giờ (mặc định 5 ô)
 */
export function createMiniBar(completedMinutes, targetHours = 8.0, length = 5) {
  const targetMinutes = targetHours > 0 ? targetHours * 60 : 480;
  const ratio = Math.min(1, Math.max(0, completedMinutes / targetMinutes));
  const filled = Math.round(ratio * length);
  return `${'▰'.repeat(filled)}${'▱'.repeat(length - filled)}`;
}
