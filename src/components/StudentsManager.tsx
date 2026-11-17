import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  UserPlus,
  Upload,
  Edit3,
  Trash2,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { apiFetch, buildQueryString } from '../services/api';
import { useToast } from './ToastContext';
import type { Course, Department, Student, Subject } from '../types';

interface StudentsManagerProps {
  role: 'admin' | 'faculty';
  onGoToEnroll?: (studentId: number) => void;
}

const PAGE_SIZE = 8;

export function StudentsManager({ role, onGoToEnroll }: StudentsManagerProps) {
  const { notify, confirm } = useToast();
  const [students, setStudents] = useState<Student[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('');
  const [page, setPage] = useState(1);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState(
    'student_code,roll_number,name,email,phone,department_code,course_code,semester,section\nSTU2026011,CS2024011,Ishaan Gupta,ishaan.gupta@pyattendance.edu,+91-98401-11011,CSE,BTECH-CSE,5,A'
  );

  // Form fields
  const [formState, setFormState] = useState({
    student_code: '',
    roll_number: '',
    name: '',
    email: '',
    phone: '',
    department_id: '',
    course_id: '',
    semester: '5',
    section: 'A',
    academic_year: '2026-27',
    non_biometric_opt_out: false,
    subject_ids: [] as number[],
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const qs = buildQueryString({
        search,
        department_id: deptFilter,
        course_id: courseFilter,
        semester: semesterFilter,
      });
      const [stuRes, acadRes] = await Promise.all([
        apiFetch<{ students: Student[] }>(`/api/students${qs}`),
        apiFetch<{ departments: Department[]; courses: Course[]; subjects: Subject[] }>('/api/academic'),
      ]);
      setStudents(stuRes.students);
      setDepartments(acadRes.departments);
      setCourses(acadRes.courses);
      setSubjects(acadRes.subjects);
      setPage(1);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Failed to load students.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [deptFilter, courseFilter, semesterFilter]);

  const filteredStudents = useMemo(() => {
    if (!search.trim()) return students;
    const q = search.trim().toLowerCase();
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.roll_number.toLowerCase().includes(q) ||
        s.student_code.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
    );
  }, [students, search]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / PAGE_SIZE));
  const pagedStudents = filteredStudents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openAddModal = () => {
    setEditingStudent(null);
    const defaultDept = departments[0]?.department_id ? String(departments[0].department_id) : '';
    const defaultCourse = courses[0]?.course_id ? String(courses[0].course_id) : '';
    setFormState({
      student_code: `STU2026${String(students.length + 1).padStart(3, '0')}`,
      roll_number: '',
      name: '',
      email: '',
      phone: '',
      department_id: defaultDept,
      course_id: defaultCourse,
      semester: '5',
      section: 'A',
      academic_year: '2026-27',
      non_biometric_opt_out: false,
      subject_ids: subjects
        .filter((s) => String(s.course_id) === defaultCourse)
        .map((s) => s.subject_id),
    });
    setFormOpen(true);
  };

  const openEditModal = (s: Student) => {
    setEditingStudent(s);
    setFormState({
      student_code: s.student_code,
      roll_number: s.roll_number,
      name: s.name,
      email: s.email,
      phone: s.phone,
      department_id: String(s.department_id),
      course_id: String(s.course_id),
      semester: String(s.semester),
      section: s.section,
      academic_year: s.academic_year,
      non_biometric_opt_out: s.non_biometric_opt_out === 1,
      subject_ids: s.enrolled_subjects.map((sub) => sub.subject_id),
    });
    setFormOpen(true);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        ...formState,
        department_id: Number(formState.department_id),
        course_id: Number(formState.course_id),
        semester: Number(formState.semester),
      };
      if (editingStudent) {
        await apiFetch(`/api/students/${editingStudent.student_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify('success', `Updated student ${formState.name}.`);
      } else {
        await apiFetch('/api/students', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify('success', `Registered student ${formState.name}.`);
      }
      setFormOpen(false);
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to save student.');
    }
  };

  const handleDeactivate = async (s: Student) => {
    const ok = await confirm({
      title: 'Deactivate Student Record',
      message: `Deactivate ${s.name} (${s.roll_number})? Attendance history will be retained for institutional audit, while active enrollment is paused.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/students/${s.student_id}`, { method: 'DELETE' });
      notify('success', `${s.name} deactivated.`);
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to deactivate student.');
    }
  };

  const handleCsvImport = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{
        inserted_count: number;
        errors: Array<{ row: number; error: string }>;
      }>('/api/students/import-csv', {
        method: 'POST',
        body: JSON.stringify({ csvText }),
      });
      notify(
        res.inserted_count > 0 ? 'success' : 'info',
        `Imported ${res.inserted_count} student(s). ${res.errors.length > 0 ? `${res.errors.length} skipped.` : ''}`
      );
      setCsvOpen(false);
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'CSV import failed.');
    }
  };

  const toggleSubjectId = (subId: number) => {
    setFormState((prev) => ({
      ...prev,
      subject_ids: prev.subject_ids.includes(subId)
        ? prev.subject_ids.filter((x) => x !== subId)
        : [...prev.subject_ids, subId],
    }));
  };

  return (
    <div className="space-y-5">
      {/* Action & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search roll no, name, or email..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter by Department"
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d.department_id} value={d.department_id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>

          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            aria-label="Filter by Course"
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All Courses</option>
            {courses.map((c) => (
              <option key={c.course_id} value={c.course_id}>
                {c.code}
              </option>
            ))}
          </select>

          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value)}
            aria-label="Filter by Semester"
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="">All Semesters</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => (
              <option key={sem} value={sem}>
                Semester {sem}
              </option>
            ))}
          </select>
        </div>

        {role === 'admin' && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setCsvOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import CSV</span>
            </button>
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Student</span>
            </button>
          </div>
        )}
      </div>

      {/* Students Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Roll No</th>
                <th className="py-3 px-4">Student Name</th>
                <th className="py-3 px-4">Program</th>
                <th className="py-3 px-4">Biometric Template</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                    Loading student directory...
                  </td>
                </tr>
              ) : pagedStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-sm text-slate-500">
                    No students matched your current filters.
                  </td>
                </tr>
              ) : (
                pagedStudents.map((s) => (
                  <tr key={s.student_id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs text-slate-800 tabular-nums">
                      {s.roll_number}
                      <div className="text-slate-400">{s.student_code}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.email}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      <div>
                        {s.department_code} · {s.course_code}
                      </div>
                      <div className="text-slate-400">
                        Sem {s.semester} · Sec {s.section}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {s.face_enrolled === 1 ? (
                        <span className="text-teal-700 font-medium">
                          Encrypted (Q: {Number(s.template_quality || 0).toFixed(2)})
                        </span>
                      ) : s.non_biometric_opt_out === 1 ? (
                        <span className="text-slate-600">Non-Biometric Manual</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onGoToEnroll?.(s.student_id)}
                          className="text-blue-700 hover:underline font-medium"
                        >
                          Pending Enrollment →
                        </button>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {s.is_active === 1 ? (
                        <span className="text-teal-700 font-medium">Active</span>
                      ) : (
                        <span className="text-slate-400">Inactive</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setProfileStudent(s)}
                          title="View Profile"
                          className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {role === 'admin' && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(s)}
                              title="Edit Student"
                              className="p-1.5 text-slate-500 hover:text-blue-700 rounded hover:bg-slate-100"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            {s.is_active === 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeactivate(s)}
                                title="Deactivate Student"
                                className="p-1.5 text-slate-500 hover:text-red-600 rounded hover:bg-slate-100"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span className="tabular-nums">
            Showing {pagedStudents.length} of {filteredStudents.length} students
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 border border-slate-300 rounded-md disabled:opacity-40 hover:bg-slate-50"
              aria-label="Previous page"
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
              className="p-1.5 border border-slate-300 rounded-md disabled:opacity-40 hover:bg-slate-50"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Add/Edit Student Modal */}
      {formOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                {editingStudent ? `Edit Student · ${editingStudent.roll_number}` : 'Register New Student'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStudent} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Student ID *</label>
                  <input
                    required
                    value={formState.student_code}
                    onChange={(e) => setFormState({ ...formState, student_code: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="STU2026012"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Roll Number *</label>
                  <input
                    required
                    value={formState.roll_number}
                    onChange={(e) => setFormState({ ...formState, roll_number: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    placeholder="CS2024012"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name *</label>
                  <input
                    required
                    value={formState.name}
                    onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={formState.email}
                    onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone Number</label>
                  <input
                    value={formState.phone}
                    onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department *</label>
                  <select
                    required
                    value={formState.department_id}
                    onChange={(e) => setFormState({ ...formState, department_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {departments.map((d) => (
                      <option key={d.department_id} value={d.department_id}>
                        {d.code} — {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Course *</label>
                  <select
                    required
                    value={formState.course_id}
                    onChange={(e) => setFormState({ ...formState, course_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {courses.map((c) => (
                      <option key={c.course_id} value={c.course_id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Semester</label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={formState.semester}
                      onChange={(e) => setFormState({ ...formState, semester: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Section</label>
                    <input
                      value={formState.section}
                      onChange={(e) => setFormState({ ...formState, section: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Enrolled Subjects
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto p-3 border border-slate-200 rounded-lg bg-slate-50">
                  {subjects.map((sub) => (
                    <label key={sub.subject_id} className="flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={formState.subject_ids.includes(sub.subject_id)}
                        onChange={() => toggleSubjectId(sub.subject_id)}
                      />
                      <span>
                        <span className="font-mono font-medium">{sub.code}</span> · {sub.subject_name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={formState.non_biometric_opt_out}
                  onChange={(e) =>
                    setFormState({ ...formState, non_biometric_opt_out: e.target.checked })
                  }
                />
                <span>Use non-biometric manual attendance only (opt out of face recognition)</span>
              </label>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  {editingStudent ? 'Save Changes' : 'Register Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Profile Drawer/Modal */}
      {profileStudent && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <div className="text-xs font-mono text-slate-500">
                  {profileStudent.roll_number} · {profileStudent.student_code}
                </div>
                <h3 className="text-base font-semibold text-slate-900">{profileStudent.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setProfileStudent(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <dl className="mt-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Email</dt>
                <dd className="text-slate-900">{profileStudent.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Phone</dt>
                <dd className="text-slate-900 tabular-nums">{profileStudent.phone || '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Department</dt>
                <dd className="text-slate-900">{profileStudent.department_name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Course / Semester</dt>
                <dd className="text-slate-900">
                  {profileStudent.course_code} · Sem {profileStudent.semester} (Sec {profileStudent.section})
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Enrolled Subjects</dt>
                <dd className="text-slate-900 text-right">
                  {profileStudent.enrolled_subjects.map((e) => e.code).join(', ') || 'None'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Biometric Consent</dt>
                <dd className="text-slate-900">
                  {profileStudent.biometric_consent === 1 ? 'Authorized & Encrypted' : 'Not Enrolled'}
                </dd>
              </div>
            </dl>
            <div className="mt-6 flex justify-end gap-2">
              {onGoToEnroll && (
                <button
                  type="button"
                  onClick={() => {
                    const id = profileStudent.student_id;
                    setProfileStudent(null);
                    onGoToEnroll(id);
                  }}
                  className="px-4 py-2 text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg"
                >
                  Open Face Enrollment
                </button>
              )}
              <button
                type="button"
                onClick={() => setProfileStudent(null)}
                className="px-4 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {csvOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">Bulk Import Students via CSV</h3>
              <button
                type="button"
                onClick={() => setCsvOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCsvImport} className="mt-4 space-y-4">
              <p className="text-xs text-slate-600">
                Paste CSV rows with headers: <code className="font-mono">student_code,roll_number,name,email,phone,department_code,course_code,semester,section</code>.
              </p>
              <textarea
                rows={7}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full p-3 font-mono text-xs border border-slate-300 rounded-lg"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCsvOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  Import Records
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
