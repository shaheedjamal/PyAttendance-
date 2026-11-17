import React, { useEffect, useState } from 'react';
import { Edit3, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch, buildQueryString } from '../services/api';
import { useToast } from './ToastContext';
import type { AttendanceRecord, Subject } from '../types';

const PAGE_SIZE = 12;

export function AttendanceRecordsView() {
  const { notify } = useToast();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const [subjectFilter, setSubjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [nextStatus, setNextStatus] = useState<'Present' | 'Absent' | 'Late' | 'Excused'>('Present');
  const [notes, setNotes] = useState('');

  const loadRecords = async () => {
    setLoading(true);
    try {
      const qs = buildQueryString({
        subject_id: subjectFilter,
        status: statusFilter,
        date: dateFilter,
      });
      const [attRes, acadRes] = await Promise.all([
        apiFetch<{ attendance: AttendanceRecord[] }>(`/api/attendance${qs}`),
        apiFetch<{ subjects: Subject[] }>('/api/academic'),
      ]);
      setRecords(attRes.attendance);
      setSubjects(acadRes.subjects);
      setPage(1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [subjectFilter, statusFilter, dateFilter]);

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await apiFetch(`/api/attendance/${editing.attendance_id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus, notes }),
      });
      notify('success', `Updated ${editing.roll_number} attendance to ${nextStatus}.`);
      setEditing(null);
      loadRecords();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to update attendance.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const paged = records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="">All Subjects</option>
          {subjects.map((s) => (
            <option key={s.subject_id} value={s.subject_id}>
              {s.code} — {s.subject_name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          <option value="">All Statuses</option>
          <option value="Present">Present</option>
          <option value="Late">Late</option>
          <option value="Excused">Excused</option>
          <option value="Absent">Absent</option>
        </select>

        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        />

        {(subjectFilter || statusFilter || dateFilter) && (
          <button
            type="button"
            onClick={() => {
              setSubjectFilter('');
              setStatusFilter('');
              setDateFilter('');
            }}
            className="text-xs font-medium text-blue-700 hover:underline px-2"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Roll No</th>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4">Subject</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Verification</th>
                <th className="py-3 px-4">Reviewed By</th>
                <th className="py-3 px-4 text-right">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                    Loading attendance records...
                  </td>
                </tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                    No attendance records found for these filters.
                  </td>
                </tr>
              ) : (
                paged.map((r) => (
                  <tr key={r.attendance_id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-slate-600">
                      {r.session_date}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-800">{r.roll_number}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{r.student_name}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-700">
                      {r.subject_code} · {r.subject_name}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-xs font-semibold ${
                        r.status === 'Present'
                          ? 'text-teal-700'
                          : r.status === 'Absent'
                          ? 'text-red-600'
                          : 'text-amber-700'
                      }`}
                    >
                      {r.status}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-500">
                      {r.verification_method.replaceAll('_', ' ')}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-500">{r.reviewed_by || 'Pending'}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(r);
                          setNextStatus(r.status);
                          setNotes(r.notes || '');
                        }}
                        className="p-1.5 text-slate-500 hover:text-blue-700 rounded hover:bg-slate-100"
                        title="Correct Attendance"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span className="tabular-nums">
            Showing {paged.length} of {records.length} records
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 border border-slate-300 rounded disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 border border-slate-300 rounded disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Correction Modal */}
      {editing && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Correct Attendance · {editing.roll_number}
              </h3>
              <button type="button" onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveCorrection} className="mt-4 space-y-4">
              <div className="text-xs text-slate-600">
                {editing.student_name} · {editing.subject_code} ({editing.session_date})
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Corrected Status</label>
                <select
                  value={nextStatus}
                  onChange={(e) =>
                    setNextStatus(e.target.value as 'Present' | 'Absent' | 'Late' | 'Excused')
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Present">Present</option>
                  <option value="Late">Late</option>
                  <option value="Excused">Excused</option>
                  <option value="Absent">Absent</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Correction Reason / Notes</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  placeholder="Medical excuse, camera occlusion, manual verification..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  Save Correction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
