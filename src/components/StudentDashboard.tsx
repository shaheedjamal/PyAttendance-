import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, Download } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useToast } from './ToastContext';
import type { AuthUser } from '../types';

interface StudentDashboardProps {
  user: AuthUser;
}

interface StudentAnalyticsPayload {
  summary: {
    total_classes: number;
    classes_attended: number;
    classes_absent: number;
    attendance_percentage: number;
    shortage_threshold: number;
    has_shortage: boolean;
  };
  subjects: Array<{
    subject_id: number;
    code: string;
    subject_name: string;
    faculty_name: string;
    total_classes: number;
    present_count: number;
    late_count: number;
    excused_count: number;
    absent_count: number;
    attended_count: number;
    percentage: number;
    shortage: boolean;
  }>;
  history: Array<{
    attendance_id: number;
    session_date: string;
    subject_code: string;
    subject_name: string;
    status: string;
    verification_method: string;
    notes: string;
  }>;
}

export function StudentDashboard({ user }: StudentDashboardProps) {
  const { notify, confirm } = useToast();
  const [data, setData] = useState<StudentAnalyticsPayload | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    Promise.all([
      apiFetch<StudentAnalyticsPayload>(`/api/analytics/student/${user.id}`),
      apiFetch<{ user: { details: Record<string, unknown> } }>('/api/profile'),
    ])
      .then(([analytics, prof]) => {
        setData(analytics);
        setProfile(prof.user.details);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [user.id]);

  const handleWithdrawBiometrics = async () => {
    const ok = await confirm({
      title: 'Withdraw Biometric Consent',
      message:
        'This permanently deletes your encrypted facial template and switches your account to manual non-biometric attendance. You can re-enroll later with faculty assistance.',
      confirmLabel: 'Delete Biometric Template',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await apiFetch<{ message: string }>(`/api/students/${user.id}/biometrics`, {
        method: 'DELETE',
      });
      notify('success', res.message);
      loadData();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to withdraw consent.');
    }
  };

  if (loading || !data) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  const faceEnrolled = Number(profile?.face_enrolled || 0) === 1;
  const nonBiometric = Number(profile?.non_biometric_opt_out || 0) === 1;

  return (
    <div className="space-y-6">
      {/* Student Profile Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="text-xs font-mono text-slate-500">
            {String(profile?.roll_number || user.roll_number)} · {String(profile?.student_code || '')}
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold text-slate-900">
            {user.name}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {String(profile?.course_name || user.course_name)} · Semester {String(profile?.semester || user.semester)} · Section {String(profile?.section || user.section)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Biometric Status:{' '}
            {faceEnrolled ? (
              <span className="text-teal-700 font-medium">Encrypted facial template active</span>
            ) : nonBiometric ? (
              <span className="text-slate-700 font-medium">Non-biometric manual attendance active</span>
            ) : (
              <span className="text-slate-600">Not enrolled in facial recognition</span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <a
            href="/api/reports/pdf"
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download My PDF Report</span>
          </a>
          {faceEnrolled && (
            <button
              type="button"
              onClick={handleWithdrawBiometrics}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Withdraw Biometrics</span>
            </button>
          )}
        </div>
      </div>

      {/* Shortage notice */}
      {data.summary.has_shortage ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <span className="font-semibold">Attendance Shortage Warning:</span> Your overall attendance is{' '}
            <span className="font-mono font-semibold tabular-nums">
              {data.summary.attendance_percentage}%
            </span>
            , below the institutional threshold of{' '}
            <span className="font-mono tabular-nums">{data.summary.shortage_threshold}%</span>.
          </div>
        </div>
      ) : (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
          <div className="text-sm text-teal-900">
            Your cumulative attendance ({data.summary.attendance_percentage}%) satisfies the minimum{' '}
            {data.summary.shortage_threshold}% institutional requirement.
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Total Classes Conducted</div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {data.summary.total_classes}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Classes Attended</div>
          <div className="mt-2 font-display text-2xl font-semibold text-teal-700 tabular-nums">
            {data.summary.classes_attended}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Classes Absent</div>
          <div className="mt-2 font-display text-2xl font-semibold text-red-600 tabular-nums">
            {data.summary.classes_absent}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs text-slate-500">Overall Percentage</div>
          <div
            className={`mt-2 font-display text-2xl font-semibold tabular-nums ${
              data.summary.has_shortage ? 'text-red-600' : 'text-slate-900'
            }`}
          >
            {data.summary.attendance_percentage}%
          </div>
        </div>
      </div>

      {/* Subject-wise attendance table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Subject-wise Attendance Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Subject</th>
                <th className="py-2.5 px-4">Faculty</th>
                <th className="py-2.5 px-4 text-right">Conducted</th>
                <th className="py-2.5 px-4 text-right">Present</th>
                <th className="py-2.5 px-4 text-right">Late</th>
                <th className="py-2.5 px-4 text-right">Excused</th>
                <th className="py-2.5 px-4 text-right">Absent</th>
                <th className="py-2.5 px-4 text-right">Percentage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.subjects.map((sub) => (
                <tr key={sub.subject_id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-medium text-slate-900">
                    <span className="font-mono text-blue-700">{sub.code}</span> · {sub.subject_name}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">{sub.faculty_name || 'Assigned'}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{sub.total_classes}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-teal-700">
                    {sub.present_count}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700">
                    {sub.late_count}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-blue-700">
                    {sub.excused_count}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-600">
                    {sub.absent_count}
                  </td>
                  <td
                    className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums ${
                      sub.shortage ? 'text-red-600' : 'text-slate-900'
                    }`}
                  >
                    {sub.percentage}% {sub.shortage ? '· Shortage' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Attendance history */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Recent Session History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-4">Subject</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Verification Method</th>
                <th className="py-2.5 px-4">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.history.map((h) => (
                <tr key={h.attendance_id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">{h.session_date}</td>
                  <td className="py-2.5 px-4 text-slate-900">
                    {h.subject_code} · {h.subject_name}
                  </td>
                  <td
                    className={`py-2.5 px-4 font-medium ${
                      h.status === 'Present'
                        ? 'text-teal-700'
                        : h.status === 'Absent'
                        ? 'text-red-600'
                        : 'text-amber-700'
                    }`}
                  >
                    {h.status}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-500">
                    {h.verification_method.replaceAll('_', ' ')}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-500">{h.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
