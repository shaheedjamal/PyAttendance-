import { useEffect, useState } from 'react';
import { Users, GraduationCap, BookOpen, Camera, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { apiFetch } from '../services/api';
import type { AttendanceSession, AuditLog } from '../types';
import {
  DepartmentBarChart,
  MonthlyTrendChart,
  StatusDoughnutChart,
} from './DashboardCharts';

interface AdminDashboardProps {
  onNavigate: (tab: string) => void;
}

interface OverviewPayload {
  totals: {
    total_students: number;
    total_faculty: number;
    total_departments: number;
    total_courses: number;
    total_subjects: number;
    enrolled_templates: number;
    active_sessions: number;
  };
  today: {
    total_records: number;
    present_students: number;
    absent_students: number;
  };
  overall_rate: number;
  status_breakdown: { Present: number; Late: number; Excused: number; Absent: number };
  shortage_students: Array<{
    student_id: number;
    roll_number: string;
    name: string;
    total: number;
    attended: number;
    percentage: number;
  }>;
  recent_activities: AuditLog[];
}

export function AdminDashboard({ onNavigate }: AdminDashboardProps) {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [monthly, setMonthly] = useState<Array<{ date: string; attended: number; absent: number; rate: number }>>([]);
  const [departments, setDepartments] = useState<Array<{ code: string; name: string; rate: number; total: number }>>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<OverviewPayload>('/api/analytics/overview'),
      apiFetch<{ series: Array<{ date: string; attended: number; absent: number; rate: number }> }>('/api/analytics/monthly'),
      apiFetch<{ departments: Array<{ code: string; name: string; rate: number; total: number }> }>('/api/analytics/department'),
      apiFetch<{ sessions: AttendanceSession[] }>('/api/sessions'),
    ])
      .then(([ov, mo, dp, ss]) => {
        if (!active) return;
        setOverview(ov);
        setMonthly(mo.series);
        setDepartments(dp.departments);
        setSessions(ss.sessions.slice(0, 6));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading || !overview) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  const kpis = [
    {
      label: 'Enrolled Students',
      value: overview.totals.total_students,
      meta: `${overview.totals.enrolled_templates} face templates encrypted`,
      icon: GraduationCap,
      action: () => onNavigate('students'),
    },
    {
      label: 'Faculty Members',
      value: overview.totals.total_faculty,
      meta: `${overview.totals.total_departments} departments · ${overview.totals.total_courses} courses`,
      icon: Users,
      action: () => onNavigate('faculty'),
    },
    {
      label: 'Active Subjects',
      value: overview.totals.total_subjects,
      meta: `${overview.totals.active_sessions} live attendance sessions`,
      icon: BookOpen,
      action: () => onNavigate('faculty'),
    },
    {
      label: 'Overall Attendance',
      value: `${overview.overall_rate.toFixed(1)}%`,
      meta: `Today: ${overview.today.present_students} present · ${overview.today.absent_students} absent`,
      icon: Camera,
      action: () => onNavigate('records'),
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors group"
          >
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-xs font-medium">{item.label}</span>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition-colors" />
            </div>
            <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
              {item.value}
            </div>
            <div className="mt-1.5 text-xs text-slate-500 tabular-nums">{item.meta}</div>
          </button>
        ))}
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Session Attendance Trend</h2>
              <p className="text-xs text-slate-500">Daily verified attendance rate across active terms</p>
            </div>
          </div>
          {monthly.length > 0 ? (
            <MonthlyTrendChart series={monthly} />
          ) : (
            <p className="text-sm text-slate-500 py-16 text-center">No session trend data available yet.</p>
          )}
        </div>

        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Department Comparison</h2>
            <p className="text-xs text-slate-500">Attendance percentage by academic department</p>
          </div>
          {departments.length > 0 ? (
            <DepartmentBarChart departments={departments} />
          ) : (
            <p className="text-sm text-slate-500 py-16 text-center">No department metrics available.</p>
          )}
        </div>

        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Status Distribution</h2>
            <p className="text-xs text-slate-500">Cumulative attendance statuses</p>
          </div>
          <StatusDoughnutChart breakdown={overview.status_breakdown} />
        </div>
      </div>

      {/* Bottom grid: Recent Sessions + Shortage Alerts + Audit Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Recent Attendance Sessions</h2>
              <p className="text-xs text-slate-500">Session verification status and headcounts</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('records')}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
            >
              View All Records
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Subject</th>
                  <th className="py-2.5 px-4">Faculty</th>
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4 text-right">Present</th>
                  <th className="py-2.5 px-4 text-right">Absent</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((s) => (
                  <tr key={s.session_id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-medium text-slate-900">
                      {s.subject_code} <span className="text-slate-400">·</span>{' '}
                      <span className="font-normal text-slate-600">{s.subject_name}</span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{s.faculty_name}</td>
                    <td className="py-2.5 px-4 text-slate-600 tabular-nums">{s.session_date}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-teal-700">
                      {s.present_count}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-600">
                      {s.absent_count}
                    </td>
                    <td className="py-2.5 px-4 text-xs font-medium capitalize text-slate-700">
                      {s.session_status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-6">
          {/* Shortage alerts */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <h2 className="text-sm font-semibold text-slate-900">Attendance Shortage Watchlist</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
              >
                Export Report
              </button>
            </div>
            {overview.shortage_students.length === 0 ? (
              <p className="text-xs text-slate-500">All students meet minimum institutional attendance requirements.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {overview.shortage_students.map((st) => (
                  <div key={st.student_id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono text-slate-700">{st.roll_number}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span className="font-medium text-slate-900">{st.name}</span>
                    </div>
                    <div className="font-mono tabular-nums text-red-600 font-semibold">
                      {st.percentage}% ({st.attended}/{st.total})
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent audit activity */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">Recent System Activity</h2>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
              >
                Audit Log
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {overview.recent_activities.slice(0, 5).map((log) => (
                <div key={log.log_id} className="py-2 text-xs">
                  <div className="flex items-center justify-between text-slate-900 font-medium">
                    <span>{log.action}</span>
                    <span className="text-slate-400 font-mono tabular-nums">
                      {log.timestamp.slice(0, 16)}
                    </span>
                  </div>
                  <p className="text-slate-500 mt-0.5 truncate">
                    {log.user_email} · {log.details || log.resource_type}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
