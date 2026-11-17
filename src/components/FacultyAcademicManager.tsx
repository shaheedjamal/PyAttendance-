import React, { useEffect, useState } from 'react';
import { UserPlus, BookOpen, Building2, Plus } from 'lucide-react';
import { apiFetch } from '../services/api';
import { useToast } from './ToastContext';
import type { Course, Department, Faculty, Subject } from '../types';

export function FacultyAcademicManager() {
  const { notify } = useToast();
  const [facultyList, setFacultyList] = useState<Faculty[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  const [newFaculty, setNewFaculty] = useState({
    employee_code: '',
    name: '',
    email: '',
    department_id: '',
    designation: 'Assistant Professor',
  });

  const [newDept, setNewDept] = useState({ code: '', name: '', head_name: '' });
  const [newCourse, setNewCourse] = useState({ code: '', name: '', department_id: '', total_semesters: '8' });
  const [newSubject, setNewSubject] = useState({
    code: '',
    subject_name: '',
    course_id: '',
    semester: '5',
    faculty_id: '',
    credits: '4',
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [facRes, acadRes] = await Promise.all([
        apiFetch<{ faculty: Faculty[] }>('/api/faculty'),
        apiFetch<{ departments: Department[]; courses: Course[]; subjects: Subject[] }>('/api/academic'),
      ]);
      setFacultyList(facRes.faculty);
      setDepartments(acadRes.departments);
      setCourses(acadRes.courses);
      setSubjects(acadRes.subjects);
      if (!newFaculty.department_id && acadRes.departments[0]) {
        setNewFaculty((f) => ({ ...f, department_id: String(acadRes.departments[0].department_id) }));
        setNewCourse((c) => ({ ...c, department_id: String(acadRes.departments[0].department_id) }));
      }
      if (!newSubject.course_id && acadRes.courses[0]) {
        setNewSubject((s) => ({ ...s, course_id: String(acadRes.courses[0].course_id) }));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleAddFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/faculty', {
        method: 'POST',
        body: JSON.stringify({ ...newFaculty, department_id: Number(newFaculty.department_id) }),
      });
      notify('success', `Added faculty member ${newFaculty.name}.`);
      setNewFaculty({ ...newFaculty, employee_code: '', name: '', email: '' });
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to add faculty.');
    }
  };

  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/departments', { method: 'POST', body: JSON.stringify(newDept) });
      notify('success', `Added department ${newDept.code}.`);
      setNewDept({ code: '', name: '', head_name: '' });
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to add department.');
    }
  };

  const handleAddCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/courses', {
        method: 'POST',
        body: JSON.stringify({
          ...newCourse,
          department_id: Number(newCourse.department_id),
          total_semesters: Number(newCourse.total_semesters),
        }),
      });
      notify('success', `Added course ${newCourse.code}.`);
      setNewCourse({ ...newCourse, code: '', name: '' });
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to add course.');
    }
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({
          ...newSubject,
          course_id: Number(newSubject.course_id),
          semester: Number(newSubject.semester),
          faculty_id: newSubject.faculty_id ? Number(newSubject.faculty_id) : null,
          credits: Number(newSubject.credits),
        }),
      });
      notify('success', `Added subject ${newSubject.code}.`);
      setNewSubject({ ...newSubject, code: '', subject_name: '' });
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Unable to add subject.');
    }
  };

  const handleAssignFaculty = async (subjectId: number, facultyId: string) => {
    try {
      await apiFetch(`/api/subjects/${subjectId}`, {
        method: 'PUT',
        body: JSON.stringify({ faculty_id: facultyId ? Number(facultyId) : null }),
      });
      notify('success', 'Updated subject faculty assignment.');
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Assignment update failed.');
    }
  };

  if (loading) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      {/* Faculty Directory & Quick Create */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Faculty Directory</h2>
            <p className="text-xs text-slate-500">Institutional teaching staff and assigned subjects</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Code</th>
                  <th className="py-2.5 px-4">Faculty Name</th>
                  <th className="py-2.5 px-4">Department</th>
                  <th className="py-2.5 px-4">Assigned Subjects</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {facultyList.map((f) => (
                  <tr key={f.faculty_id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-700">{f.employee_code}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{f.name}</div>
                      <div className="text-xs text-slate-500">
                        {f.designation} · {f.email}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">{f.department_code}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-700">
                      {f.assigned_subjects.length > 0
                        ? f.assigned_subjects.map((s) => s.code).join(', ')
                        : 'Unassigned'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-900">Add Faculty Account</h3>
          </div>
          <form onSubmit={handleAddFaculty} className="space-y-3">
            <input
              required
              placeholder="Employee Code (e.g., FAC-103)"
              value={newFaculty.employee_code}
              onChange={(e) => setNewFaculty({ ...newFaculty, employee_code: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              required
              placeholder="Full Name"
              value={newFaculty.name}
              onChange={(e) => setNewFaculty({ ...newFaculty, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              required
              type="email"
              placeholder="Institutional Email"
              value={newFaculty.email}
              onChange={(e) => setNewFaculty({ ...newFaculty, email: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <select
              value={newFaculty.department_id}
              onChange={(e) => setNewFaculty({ ...newFaculty, department_id: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {departments.map((d) => (
                <option key={d.department_id} value={d.department_id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Designation"
              value={newFaculty.designation}
              onChange={(e) => setNewFaculty({ ...newFaculty, designation: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              className="w-full py-2 px-4 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
            >
              Create Faculty Account
            </button>
          </form>
        </div>
      </div>

      {/* Subjects & Assignment Matrix */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-900">Subjects &amp; Faculty Assignment</h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-4">Code</th>
                <th className="py-2.5 px-4">Subject Name</th>
                <th className="py-2.5 px-4">Course / Sem</th>
                <th className="py-2.5 px-4">Assigned Faculty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subjects.map((sub) => (
                <tr key={sub.subject_id}>
                  <td className="py-2.5 px-4 font-mono text-xs text-blue-700">{sub.code}</td>
                  <td className="py-2.5 px-4 font-medium text-slate-900">{sub.subject_name}</td>
                  <td className="py-2.5 px-4 text-xs text-slate-600">
                    {sub.course_code} · Sem {sub.semester}
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      value={sub.faculty_id ?? ''}
                      onChange={(e) => handleAssignFaculty(sub.subject_id, e.target.value)}
                      className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                    >
                      <option value="">Unassigned</option>
                      {facultyList.map((f) => (
                        <option key={f.faculty_id} value={f.faculty_id}>
                          {f.name} ({f.department_code})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Departments, Courses, Subjects Creation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4 text-slate-700" />
            <h4 className="text-sm font-semibold text-slate-900">Add Department</h4>
          </div>
          <form onSubmit={handleAddDepartment} className="space-y-2.5">
            <input
              required
              placeholder="Code (e.g., MECH)"
              value={newDept.code}
              onChange={(e) => setNewDept({ ...newDept, code: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              required
              placeholder="Department Name"
              value={newDept.name}
              onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              placeholder="Department Head"
              value={newDept.head_name}
              onChange={(e) => setNewDept({ ...newDept, head_name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Department</span>
            </button>
          </form>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h4 className="text-sm font-semibold text-slate-900 mb-3">Add Course</h4>
          <form onSubmit={handleAddCourse} className="space-y-2.5">
            <input
              required
              placeholder="Course Code (e.g., MTECH-AI)"
              value={newCourse.code}
              onChange={(e) => setNewCourse({ ...newCourse, code: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              required
              placeholder="Course Name"
              value={newCourse.name}
              onChange={(e) => setNewCourse({ ...newCourse, name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <select
              value={newCourse.department_id}
              onChange={(e) => setNewCourse({ ...newCourse, department_id: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {departments.map((d) => (
                <option key={d.department_id} value={d.department_id}>
                  {d.code}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Course</span>
            </button>
          </form>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h4 className="text-sm font-semibold text-slate-900 mb-3">Add Subject</h4>
          <form onSubmit={handleAddSubject} className="space-y-2.5">
            <input
              required
              placeholder="Subject Code (e.g., CS504)"
              value={newSubject.code}
              onChange={(e) => setNewSubject({ ...newSubject, code: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              required
              placeholder="Subject Name"
              value={newSubject.subject_name}
              onChange={(e) => setNewSubject({ ...newSubject, subject_name: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newSubject.course_id}
                onChange={(e) => setNewSubject({ ...newSubject, course_id: e.target.value })}
                className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                {courses.map((c) => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.code}
                  </option>
                ))}
              </select>
              <select
                value={newSubject.faculty_id}
                onChange={(e) => setNewSubject({ ...newSubject, faculty_id: e.target.value })}
                className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Assign Faculty</option>
                {facultyList.map((f) => (
                  <option key={f.faculty_id} value={f.faculty_id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Subject</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
