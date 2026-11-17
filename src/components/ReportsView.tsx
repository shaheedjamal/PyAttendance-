import { useEffect, useState } from 'react';
import { FileText, FileSpreadsheet, FileDown } from 'lucide-react';
import { apiFetch, buildQueryString } from '../services/api';
import type { Department, Student, Subject } from '../types';

interface ReportRow {
  roll_number: string;
  student_name: string;
  department_code: string;
  subject_code: string;
  subject_name: string;
  total_sessions: number;
  present_count: number;
  late_count: number;
  excused_count: number;
  absent_count: number;
  attendance_percentage: number;
  shortage: boolean;
}

export function ReportsView({ role }: { role: 'admin' | 'faculty' | 'student' }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  const [preset, setPreset] = useState<'semester' | 'daily' | 'weekly' | 'monthly'>('semester');
  const [deptId, setDeptId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [meta, setMeta] = useState<Record<string, string | number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ departments: Department[]; subjects: Subject[] }>('/api/academic').then((acad) => {
      setDepartments(acad.departments);
      setSubjects(acad.subjects);
    });
    if (role !== 'student') {
      apiFetch<{ students: Student[] }>('/api/students').then((res) => setStudents(res.students));
    }
  }, [role]);

  const applyPreset = (next: 'semester' | 'daily' | 'weekly' | 'monthly') => {
    setPreset(next);
    const today = new Date();
    const toStr = today.toISOString().slice(0, 10);
    if (next === 'semester') {
      setDateFrom('');
      setDateTo('');
    } else if (next === 'daily') {
      setDateFrom(toStr);
      setDateTo(toStr);
    } else if (next === 'weekly') {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      setDateFrom(d.toISOString().slice(0, 10));
      setDateTo(toStr);
    } else if (next === 'monthly') {
      const d = new Date(today);
      d.setDate(d.getDate() - 30);
      setDateFrom(d.toISOString().slice(0, 10));
      setDateTo(toStr);
    }
  };

  const qs = buildQueryString({
    department_id: deptId,
    subject_id: subjectId,
    student_id: studentId,
    date_from: dateFrom,
    date_to: dateTo,
  });

  useEffect(() => {
    setLoading(true);
    apiFetch<{ rows: ReportRow[]; meta: Record<string, string | number> }>(
      `/api/reports/preview${qs}`
    )
      .then((res) => {
        setRows(res.rows);
        setMeta(res.meta);
      })
      .finally(() => setLoading(false));
  }, [qs]);

  return (
    <div className="space-y-6">
      {/* Filter & Export Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Institutional Attendance Reports</h2>
            <p className="text-xs text-slate-500">
              Filter by period, department, subject, or student and export official PDF, Excel, or CSV files.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href={`/api/reports/pdf${qs}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Export PDF</span>
            </a>
            <a
              href={`/api/reports/excel${qs}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-lg whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </a>
            <a
              href={`/api/reports/csv${qs}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg whitespace-nowrap"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </a>
          </div>
        </div>

        {/* Period segmented control + filters */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
          <div className="inline-flex p-1 bg-slate-100 rounded-lg border border-slate-200">
            {(['semester', 'monthly', 'weekly', 'daily'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                  preset === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {role !== 'student' && (
            <select
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.department_id} value={d.department_id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All Subjects</option>
            {subjects.map((s) => (
              <option key={s.subject_id} value={s.subject_id}>
                {s.code} — {s.subject_name}
              </option>
            ))}
          </select>

          {role !== 'student' && (
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">All Students</option>
              {students.map((st) => (
                <option key={st.student_id} value={st.student_id}>
                  {st.roll_number} — {st.name}
                </option>
              ))}
            </select>
          )}

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Date From"
            className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Date To"
            className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg"
          />
        </div>
      </div>

      {/* Preview Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>
            <strong className="text-slate-900">{String(meta.institutionName || '')}</strong> ·{' '}
            {String(meta.departmentLabel || '')} · {String(meta.subjectLabel || '')}
          </span>
          <span className="font-mono tabular-nums">{rows.length} aggregated record(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Roll No</th>
                <th className="py-2.5 px-4">Student Name</th>
                <th className="py-2.5 px-4">Subject</th>
                <th className="py-2.5 px-4 text-right">Conducted</th>
                <th className="py-2.5 px-4 text-right">Present</th>
                <th className="py-2.5 px-4 text-right">Late</th>
                <th className="py-2.5 px-4 text-right">Excused</th>
                <th className="py-2.5 px-4 text-right">Absent</th>
                <th className="py-2.5 px-4 text-right">Attendance %</th>
                <th className="py-2.5 px-4">Standing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-sm text-slate-500">
                    Generating report preview...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-sm text-slate-500">
                    No attendance records matched the selected report filters.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={`${r.roll_number}-${r.subject_code}-${i}`} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-700">{r.roll_number}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{r.student_name}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-700">
                      {r.subject_code} · {r.subject_name}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{r.total_sessions}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-teal-700">
                      {r.present_count}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-amber-700">
                      {r.late_count}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-blue-700">
                      {r.excused_count}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-600">
                      {r.absent_count}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums ${
                        r.shortage ? 'text-red-600' : 'text-slate-900'
                      }`}
                    >
                      {r.attendance_percentage.toFixed(1)}%
                    </td>
                    <td
                      className={`py-2.5 px-4 text-xs font-medium ${
                        r.shortage ? 'text-red-600' : 'text-teal-700'
                      }`}
                    >
                      {r.shortage ? 'Shortage' : 'Nominal'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
