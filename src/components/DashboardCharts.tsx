import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export function MonthlyTrendChart({
  series,
}: {
  series: Array<{ date: string; attended: number; absent: number; rate: number }>;
}) {
  const data = {
    labels: series.map((s) => s.date.slice(5)),
    datasets: [
      {
        label: 'Attendance Rate (%)',
        data: series.map((s) => s.rate),
        borderColor: '#0f172a',
        backgroundColor: 'rgba(13, 148, 136, 0.12)',
        tension: 0.28,
        fill: true,
        pointRadius: 3,
        pointBackgroundColor: '#0d9488',
      },
    ],
  };

  return (
    <div className="h-64">
      <Line
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              ticks: { callback: (v) => `${v}%` },
              grid: { color: '#f1f5f9' },
            },
            x: {
              grid: { display: false },
            },
          },
        }}
      />
    </div>
  );
}

export function DepartmentBarChart({
  departments,
}: {
  departments: Array<{ code: string; name: string; rate: number; total: number }>;
}) {
  const data = {
    labels: departments.map((d) => `${d.code}`),
    datasets: [
      {
        label: 'Attendance %',
        data: departments.map((d) => d.rate),
        backgroundColor: ['#1e3a8a', '#0d9488', '#2563eb', '#475569'],
        borderRadius: 6,
        barThickness: 36,
      },
    ],
  };

  return (
    <div className="h-64">
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            y: {
              min: 0,
              max: 100,
              ticks: { callback: (v) => `${v}%` },
              grid: { color: '#f1f5f9' },
            },
            x: {
              grid: { display: false },
            },
          },
        }}
      />
    </div>
  );
}

export function StatusDoughnutChart({
  breakdown,
}: {
  breakdown: { Present: number; Late: number; Excused: number; Absent: number };
}) {
  const data = {
    labels: ['Present', 'Late', 'Excused', 'Absent'],
    datasets: [
      {
        data: [
          breakdown.Present,
          breakdown.Late,
          breakdown.Excused,
          breakdown.Absent,
        ],
        backgroundColor: ['#0d9488', '#d97706', '#2563eb', '#dc2626'],
        borderWidth: 0,
      },
    ],
  };

  return (
    <div className="h-56 flex items-center justify-center">
      <Doughnut
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          cutout: '66%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                boxWidth: 10,
                padding: 14,
                font: { size: 12 },
              },
            },
          },
        }}
      />
    </div>
  );
}
