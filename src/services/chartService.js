import QuickChart from 'quickchart-js';
import { getTeamTodaySummary } from './shiftService.js';

export async function generateDailyBarChartUrl(workDate, customTeamData = null, options = {}) {
  const teamData = customTeamData || await getTeamTodaySummary(workDate);
  if (teamData.length === 0) {
    return null;
  }

  const isRange = Boolean(options.isRange);
  const labels = teamData.map(m => m.displayName);
  const dataHours = teamData.map(m => Number((m.totalMinutes / 60).toFixed(1)));
  const targetHour = 8.0;

  const backgroundColors = teamData.map((m, idx) => {
    const h = dataHours[idx];
    if (isRange) {
      const avgDailyH = m.activeDays > 0 ? h / m.activeDays : 0;
      if (avgDailyH >= targetHour) return '#2ecc71';
      if (avgDailyH >= 4.0) return '#f1c40f';
      return '#e74c3c';
    }
    if (h >= targetHour) return '#2ecc71'; // Xanh lá
    if (h >= 4.0) return '#f1c40f';       // Vàng
    return '#e74c3c';                     // Đỏ
  });

  const maxDataHour = Math.max(0, ...dataHours);
  const suggestedMax = isRange ? Math.max(10, Math.ceil(maxDataHour * 1.15)) : 10;
  const chartTitle = isRange
    ? `XẾP HẠNG GIỜ LÀM / 기간별 근무 랭킹 (${options.rangeLabel || workDate})`
    : `BIỂU ĐỒ GIỜ LÀM / 일일 근무 현황 (${workDate})`;

  const chartOptions = {
    title: {
      display: true,
      text: chartTitle,
      fontColor: '#ffffff',
      fontSize: 16,
      padding: 18
    },
    legend: {
      labels: {
        fontColor: '#ffffff'
      }
    },
    scales: {
      yAxes: [
        {
          ticks: {
            beginAtZero: true,
            suggestedMax,
            fontColor: '#b5bac1',
            ...(isRange ? {} : { stepSize: 2 })
          },
          gridLines: {
            color: '#35363c'
          }
        }
      ],
      xAxes: [
        {
          ticks: {
            fontColor: '#ffffff',
            fontSize: 13
          },
          gridLines: {
            display: false
          }
        }
      ]
    }
  };

  if (!isRange) {
    chartOptions.annotation = {
      annotations: [
        {
          type: 'line',
          mode: 'horizontal',
          scaleID: 'y-axis-0',
          value: targetHour,
          borderColor: '#ff4757',
          borderWidth: 2,
          borderDash: [6, 6],
          label: {
            enabled: true,
            content: 'MỤC TIÊU / 목표 8.0H',
            backgroundColor: '#ff4757',
            fontColor: '#ffffff',
            position: 'right'
          }
        }
      ]
    };
  }

  const chart = new QuickChart();
  chart.setWidth(750);
  chart.setHeight(420);
  chart.setBackgroundColor('#1e1f22');

  chart.setConfig({
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Số giờ / 근무 시간 (h)',
          data: dataHours,
          backgroundColor: backgroundColors,
          borderWidth: 0,
          borderRadius: 6
        }
      ]
    },
    options: chartOptions
  });

  const url = chart.getUrl();
  if (url.length <= 2000) {
    return url;
  }

  // Fallback sang short URL nếu danh sách nhân sự quá dài vượt giới hạn 2048 ký tự của Discord Embed
  return await chart.getShortUrl();
}
