import QuickChart from 'quickchart-js';
import { getTeamTodaySummary } from './shiftService.js';

export async function generateDailyBarChartUrl(workDate, customTeamData = null) {
  const teamData = customTeamData || await getTeamTodaySummary(workDate);
  if (teamData.length === 0) {
    return null;
  }

  const labels = teamData.map(m => m.displayName);
  const dataHours = teamData.map(m => Number((m.totalMinutes / 60).toFixed(1)));
  const targetHour = 8.0;

  const backgroundColors = dataHours.map(h => {
    if (h >= targetHour) return '#2ecc71'; // Xanh lá
    if (h >= 4.0) return '#f1c40f';       // Vàng
    return '#e74c3c';                     // Đỏ
  });

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
    options: {
      title: {
        display: true,
        text: `BIỂU ĐỒ GIỜ LÀM / 일일 근무 현황 (${workDate})`,
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
              suggestedMax: 10,
              fontColor: '#b5bac1',
              stepSize: 2
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
      },
      annotation: {
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
      }
    }
  });

  const url = chart.getUrl();
  if (url.length <= 2000) {
    return url;
  }

  // Fallback sang short URL nếu danh sách nhân sự quá dài vượt giới hạn 2048 ký tự của Discord Embed
  return await chart.getShortUrl();
}
