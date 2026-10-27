import QuickChart from 'quickchart-js';
import { getTeamTodaySummary } from './shiftService.js';

export async function generateDailyBarChartUrl(workDate) {
  const teamData = getTeamTodaySummary(workDate);
  if (teamData.length === 0) {
    return null;
  }

  const labels = teamData.map(m => m.displayName);
  const dataHours = teamData.map(m => Number((m.totalMinutes / 60).toFixed(1)));
  const targetHour = 8.0;

  const backgroundColors = dataHours.map(h => {
    if (h >= targetHour) return 'rgba(46, 204, 113, 0.85)'; // Xanh lá
    if (h >= 4.0) return 'rgba(241, 196, 15, 0.85)';       // Vàng
    return 'rgba(231, 76, 60, 0.85)';                     // Đỏ
  });

  const borderColors = dataHours.map(h => {
    if (h >= targetHour) return 'rgb(39, 174, 96)';
    if (h >= 4.0) return 'rgb(212, 172, 13)';
    return 'rgb(192, 57, 43)';
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
          borderColor: borderColors,
          borderWidth: 2,
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

  return chart.getUrl();
}
