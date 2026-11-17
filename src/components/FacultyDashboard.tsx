import { useEffect, useState } from 'react';
import { Camera, BookOpen, ClipboardCheck, FileSpreadsheet, ArrowRight } from 'lucide-react';
import { apiFetch } from '../services/api';
import type { AttendanceSession, AuthUser, Subject } from '../types';

interface FacultyDashboardProps {
  user: AuthUser;
  onNavigate: (tab: string, payload?: { subjectId?: number; sessionId?: number }) => void;
}

export function FacultyDashboard({ user, onNavigate }: FacultyDashboardProps) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<{ subjects: Subject[] }>('/api/academic'),
      apiFetch<{ sessions: AttendanceSession[] }>('/api/sessions'),
    ])
      .then(([acad, sess]) => {
        if (!active) return;
        const mySubjects = acad.subjects.filter((s) => s.faculty_id === user.id);
        setSubjects(mySubjects);
        setSessions(sess.sessions);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user.id]);

  if (loading) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  const activeSession = sessions.find((s) => s.session_status === 'active');
  const pendingReviewTotal = sessions.reduce((sum, s) => sum + (s.pending_review_count || 0), 0);

  return (
    <div className="space-y-6">
      {/* Quick actions banner */}
      <div className="bg-slate-900 text-white rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p className="text-xs text-teal-400 font-medium">
            {user.department_name || 'Department Faculty Workspace'} · {user.employee_code}
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">
            Welcome, {user.name}
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            {activeSession
              ? `Active session running for ${activeSession.subject_code} (Section ${activeSession.section}).`
              : 'Launch a live AI camera attendance session or record manual classroom attendance.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('live-camera')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors whitespace-nowrap"
          >
            <Camera className="w-4 h-4" />
            <span>{activeSession ? 'Resume Live Session' : 'Start Live Camera Session'}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Download Reports</span>
          </button>
        </div>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Assigned Subjects</span>
            <BookOpen className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {subjects.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">Current academic semester</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Sessions Conducted</span>
            <Camera className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {sessions.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {activeSession ? '1 session currently active' : 'No active session'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Pending AI Proposals</span>
            <ClipboardCheck className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {pendingReviewTotal}
          </div>
          <div className="mt-1 text-xs text-slate-500">Awaiting faculty verification</div>
        </div>
      </div>

      {/* Assigned Subjects */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Assigned Subjects &amp; Classes</h3>
          <p className="text-xs text-slate-500">Start an attendance session directly for an assigned subject</p>
        </div>
        {subjects.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No subjects are currently assigned to your account.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {subjects.map((sub) => (
              <div
                key={sub.subject_id}
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-slate-50/70"
              >
                <div>
                  <div className="font-medium text-slate-900">
                    <span className="font-mono text-blue-700">{sub.code}</span>
                    <span className="mx-2 text-slate-300">·</span>
                    <span>{sub.subject_name}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {sub.course_name} · Semester {sub.semester} · {sub.credits} Credits
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigate('live-camera', { subjectId: sub.subject_id })}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap"
                  >
                    <span>Take Attendance</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent sessions table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Your Recent Sessions</h3>
            <p className="text-xs text-slate-500">Click History &amp; Corrections to review or edit student records</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('records')}
            className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
          >
            Manage Records
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Session</th>
                <th className="py-2.5 px-4">Subject</th>
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-4 text-right">Present</th>
                <th className="py-2.5 px-4 text-right">Absent</th>
                <th className="py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessions.slice(0, 8).map((s) => (
                <tr key={s.session_id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-600 tabular-nums">
                    #{s.session_id} · Sec {s.section}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-900">
                    {s.subject_code} · <span className="font-normal text-slate-600">{s.subject_name}</span>
                  </td>
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
    </div>
  );
}
