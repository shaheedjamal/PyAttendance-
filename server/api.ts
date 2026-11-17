import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, writeAuditLog } from './db.ts';
import {
  generateCsvBuffer,
  generateExcelBuffer,
  generatePdfBuffer,
  type ReportSummaryRow,
} from './reports.ts';
import {
  attachUser,
  cosineSimilarity,
  csrfOriginGuard,
  decryptEmbedding,
  encryptEmbedding,
  hashPassword,
  rateLimit,
  requireAuth,
  requireRole,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  signSessionToken,
  verifyPassword,
  type AuthenticatedRequest,
  type UserRole,
} from './security.ts';

export const apiRouter = express.Router();

apiRouter.use(attachUser);
apiRouter.use(csrfOriginGuard);

const loginLimiter = rateLimit(60_000, 30);
const recognitionLimiter = rateLimit(10_000, 120);

function getSettings() {
  return db
    .prepare('SELECT * FROM app_settings WHERE setting_id = 1')
    .get() as Record<string, unknown>;
}

function getClientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

// ============================================================
// 1. AUTHENTICATION ROUTES
// ============================================================
apiRouter.post('/login', loginLimiter, (req, res) => {
  const { email, password, role } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const preferredRole =
    role === 'admin' || role === 'faculty' || role === 'student'
      ? (role as UserRole)
      : null;

  let foundUser: {
    id: number;
    role: UserRole;
    email: string;
    name: string;
    password_hash: string;
    extra: Record<string, unknown>;
  } | null = null;

  const tryAdmin = () => {
    const row = db
      .prepare('SELECT * FROM admins WHERE LOWER(email) = ? OR LOWER(username) = ?')
      .get(normalizedEmail, normalizedEmail) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: Number(row.admin_id),
        role: 'admin' as UserRole,
        email: String(row.email),
        name: String(row.full_name),
        password_hash: String(row.password_hash),
        extra: { username: row.username },
      };
    }
    return null;
  };

  const tryFaculty = () => {
    const row = db
      .prepare(
        `SELECT f.*, d.name as department_name, d.code as department_code
         FROM faculty f
         JOIN departments d ON d.department_id = f.department_id
         WHERE LOWER(f.email) = ?`
      )
      .get(normalizedEmail) as Record<string, unknown> | undefined;
    if (row && Number(row.is_active) === 1) {
      return {
        id: Number(row.faculty_id),
        role: 'faculty' as UserRole,
        email: String(row.email),
        name: String(row.name),
        password_hash: String(row.password_hash),
        extra: {
          employee_code: row.employee_code,
          department_id: row.department_id,
          department_name: row.department_name,
          department_code: row.department_code,
          designation: row.designation,
        },
      };
    }
    return null;
  };

  const tryStudent = () => {
    const row = db
      .prepare(
        `SELECT s.*, d.name as department_name, d.code as department_code,
                c.name as course_name, c.code as course_code
         FROM students s
         JOIN departments d ON d.department_id = s.department_id
         JOIN courses c ON c.course_id = s.course_id
         WHERE LOWER(s.email) = ? OR LOWER(s.roll_number) = ?`
      )
      .get(normalizedEmail, normalizedEmail) as Record<string, unknown> | undefined;
    if (row && Number(row.is_active) === 1) {
      return {
        id: Number(row.student_id),
        role: 'student' as UserRole,
        email: String(row.email),
        name: String(row.name),
        password_hash: String(row.password_hash),
        extra: {
          student_code: row.student_code,
          roll_number: row.roll_number,
          department_id: row.department_id,
          department_name: row.department_name,
          course_name: row.course_name,
          semester: row.semester,
          section: row.section,
        },
      };
    }
    return null;
  };

  if (preferredRole === 'admin') foundUser = tryAdmin();
  else if (preferredRole === 'faculty') foundUser = tryFaculty();
  else if (preferredRole === 'student') foundUser = tryStudent();
  else foundUser = tryAdmin() || tryFaculty() || tryStudent();

  if (!foundUser || !verifyPassword(password, foundUser.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    return;
  }

  const token = signSessionToken({
    id: foundUser.id,
    role: foundUser.role,
    email: foundUser.email,
    name: foundUser.name,
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });

  writeAuditLog({
    userRole: foundUser.role,
    userId: foundUser.id,
    userEmail: foundUser.email,
    action: 'LOGIN',
    resourceType: 'session',
    details: `Logged in as ${foundUser.role}`,
    ipAddress: getClientIp(req),
  });

  res.json({
    user: {
      id: foundUser.id,
      role: foundUser.role,
      email: foundUser.email,
      name: foundUser.name,
      ...foundUser.extra,
    },
  });
});

apiRouter.post('/logout', (req: AuthenticatedRequest, res) => {
  if (req.user) {
    writeAuditLog({
      userRole: req.user.role,
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'LOGOUT',
      resourceType: 'session',
      ipAddress: getClientIp(req),
    });
  }
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

apiRouter.get('/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  if (user.role === 'admin') {
    const admin = db
      .prepare('SELECT admin_id, username, full_name, email, created_at FROM admins WHERE admin_id = ?')
      .get(user.id);
    res.json({ user: { ...user, details: admin }, settings: getSettings() });
    return;
  }
  if (user.role === 'faculty') {
    const fac = db
      .prepare(
        `SELECT f.faculty_id, f.employee_code, f.name, f.email, f.department_id, f.designation, f.created_at,
                d.name as department_name, d.code as department_code
         FROM faculty f
         JOIN departments d ON d.department_id = f.department_id
         WHERE f.faculty_id = ?`
      )
      .get(user.id);
    res.json({ user: { ...user, details: fac }, settings: getSettings() });
    return;
  }
  const stu = db
    .prepare(
      `SELECT s.student_id, s.student_code, s.roll_number, s.name, s.email, s.phone,
              s.department_id, s.course_id, s.semester, s.section, s.academic_year,
              s.enrollment_date, s.biometric_consent, s.consent_timestamp, s.non_biometric_opt_out,
              d.name as department_name, d.code as department_code,
              c.name as course_name, c.code as course_code,
              CASE WHEN ft.template_id IS NOT NULL THEN 1 ELSE 0 END as face_enrolled
       FROM students s
       JOIN departments d ON d.department_id = s.department_id
       JOIN courses c ON c.course_id = s.course_id
       LEFT JOIN face_templates ft ON ft.student_id = s.student_id
       WHERE s.student_id = ?`
    )
    .get(user.id);
  res.json({ user: { ...user, details: stu }, settings: getSettings() });
});

// ============================================================
// 2. ACADEMIC STRUCTURE & SETTINGS ROUTES
// ============================================================
apiRouter.get('/academic', requireAuth, (_req, res) => {
  const departments = db.prepare('SELECT * FROM departments ORDER BY code').all();
  const courses = db
    .prepare(
      `SELECT c.*, d.code as department_code, d.name as department_name
       FROM courses c
       JOIN departments d ON d.department_id = c.department_id
       ORDER BY c.code`
    )
    .all();
  const subjects = db
    .prepare(
      `SELECT sub.*, c.code as course_code, c.name as course_name,
              d.department_id, d.code as department_code, d.name as department_name,
              f.name as faculty_name, f.email as faculty_email
       FROM subjects sub
       JOIN courses c ON c.course_id = sub.course_id
       JOIN departments d ON d.department_id = c.department_id
       LEFT JOIN faculty f ON f.faculty_id = sub.faculty_id
       ORDER BY sub.code`
    )
    .all();
  res.json({
    departments,
    courses,
    subjects,
    settings: getSettings(),
  });
});

apiRouter.post('/departments', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const { code, name, head_name } = req.body ?? {};
  if (!code?.trim() || !name?.trim()) {
    res.status(400).json({ error: 'Department code and name are required.' });
    return;
  }
  try {
    const info = db
      .prepare('INSERT INTO departments (code, name, head_name) VALUES (?, ?, ?)')
      .run(code.trim().toUpperCase(), name.trim(), (head_name || '').trim());
    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'CREATE_DEPARTMENT',
      resourceType: 'department',
      resourceId: Number(info.lastInsertRowid),
      details: `${code.trim().toUpperCase()} - ${name.trim()}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ department_id: Number(info.lastInsertRowid) });
  } catch (err: unknown) {
    res.status(409).json({ error: 'Department code or name already exists.', details: String(err) });
  }
});

apiRouter.post('/courses', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const { code, name, department_id, total_semesters } = req.body ?? {};
  if (!code?.trim() || !name?.trim() || !department_id) {
    res.status(400).json({ error: 'Course code, name, and department are required.' });
    return;
  }
  try {
    const info = db
      .prepare('INSERT INTO courses (code, name, department_id, total_semesters) VALUES (?, ?, ?, ?)')
      .run(code.trim().toUpperCase(), name.trim(), Number(department_id), Number(total_semesters || 8));
    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'CREATE_COURSE',
      resourceType: 'course',
      resourceId: Number(info.lastInsertRowid),
      details: `${code.trim().toUpperCase()} - ${name.trim()}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ course_id: Number(info.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Course code already exists or invalid department.' });
  }
});

apiRouter.post('/subjects', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const { code, subject_name, course_id, semester, faculty_id, credits } = req.body ?? {};
  if (!code?.trim() || !subject_name?.trim() || !course_id) {
    res.status(400).json({ error: 'Subject code, name, and course are required.' });
    return;
  }
  try {
    const info = db
      .prepare(
        'INSERT INTO subjects (code, subject_name, course_id, semester, faculty_id, credits) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(
        code.trim().toUpperCase(),
        subject_name.trim(),
        Number(course_id),
        Number(semester || 1),
        faculty_id ? Number(faculty_id) : null,
        Number(credits || 4)
      );
    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'CREATE_SUBJECT',
      resourceType: 'subject',
      resourceId: Number(info.lastInsertRowid),
      details: `${code.trim().toUpperCase()} - ${subject_name.trim()}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ subject_id: Number(info.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Subject code already exists or invalid course/faculty.' });
  }
});

apiRouter.put('/subjects/:id', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const subjectId = Number(req.params.id);
  const { faculty_id, subject_name, semester, credits } = req.body ?? {};
  const existing = db.prepare('SELECT * FROM subjects WHERE subject_id = ?').get(subjectId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Subject not found.' });
    return;
  }
  db.prepare(
    `UPDATE subjects
     SET faculty_id = ?, subject_name = ?, semester = ?, credits = ?
     WHERE subject_id = ?`
  ).run(
    faculty_id !== undefined ? (faculty_id ? Number(faculty_id) : null) : existing.faculty_id,
    subject_name?.trim() || existing.subject_name,
    semester !== undefined ? Number(semester) : existing.semester,
    credits !== undefined ? Number(credits) : existing.credits,
    subjectId
  );
  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_SUBJECT',
    resourceType: 'subject',
    resourceId: subjectId,
    details: `Updated subject assignment/details`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

apiRouter.put('/settings', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const current = getSettings();
  const b = req.body ?? {};
  const recThresh = Number(b.recognition_threshold ?? current.recognition_threshold);
  const uncThresh = Number(b.uncertain_threshold ?? current.uncertain_threshold);
  const shortageThresh = Number(b.shortage_threshold ?? current.shortage_threshold);

  if (recThresh < 0.3 || recThresh > 0.95 || uncThresh < 0.2 || uncThresh >= recThresh) {
    res.status(400).json({
      error: 'Recognition threshold must be between 0.30 and 0.95, and greater than uncertain threshold.',
    });
    return;
  }

  db.prepare(
    `UPDATE app_settings SET
      institution_name = ?,
      institution_code = ?,
      academic_year = ?,
      current_semester = ?,
      shortage_threshold = ?,
      recognition_threshold = ?,
      uncertain_threshold = ?,
      detector_backend = ?,
      late_counts_as_attended = ?,
      retention_days = ?,
      updated_at = datetime('now')
     WHERE setting_id = 1`
  ).run(
    String(b.institution_name ?? current.institution_name).trim(),
    String(b.institution_code ?? current.institution_code).trim(),
    String(b.academic_year ?? current.academic_year).trim(),
    Number(b.current_semester ?? current.current_semester),
    shortageThresh,
    recThresh,
    uncThresh,
    b.detector_backend === 'tiny_face_detector' ? 'tiny_face_detector' : 'ssd_mobilenetv1',
    b.late_counts_as_attended === false || b.late_counts_as_attended === 0 ? 0 : 1,
    Number(b.retention_days ?? current.retention_days)
  );

  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'UPDATE_SETTINGS',
    resourceType: 'settings',
    resourceId: 1,
    details: `Threshold=${recThresh}, Shortage=${shortageThresh}%, Detector=${b.detector_backend ?? current.detector_backend}`,
    ipAddress: getClientIp(req),
  });

  res.json({ settings: getSettings() });
});

apiRouter.get('/audit-logs', requireRole('admin'), (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 250);
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY log_id DESC LIMIT ?')
    .all(limit);
  res.json({ logs: rows });
});

// ============================================================
// 3. STUDENTS & ENROLLMENT ROUTES
// ============================================================
apiRouter.get('/students', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.user!.role === 'student') {
    res.status(403).json({ error: 'Students may only access their own profile.' });
    return;
  }

  const { search, department_id, course_id, semester, subject_id } = req.query;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (typeof search === 'string' && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    conditions.push(
      '(LOWER(s.name) LIKE ? OR LOWER(s.roll_number) LIKE ? OR LOWER(s.student_code) LIKE ? OR LOWER(s.email) LIKE ?)'
    );
    params.push(q, q, q, q);
  }
  if (department_id) {
    conditions.push('s.department_id = ?');
    params.push(Number(department_id));
  }
  if (course_id) {
    conditions.push('s.course_id = ?');
    params.push(Number(course_id));
  }
  if (semester) {
    conditions.push('s.semester = ?');
    params.push(Number(semester));
  }
  if (subject_id) {
    conditions.push(
      'EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.student_id AND e.subject_id = ?)'
    );
    params.push(Number(subject_id));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const students = db
    .prepare(
      `SELECT s.student_id, s.student_code, s.roll_number, s.name, s.email, s.phone,
              s.department_id, s.course_id, s.semester, s.section, s.academic_year,
              s.enrollment_date, s.is_active, s.biometric_consent, s.consent_timestamp,
              s.non_biometric_opt_out, s.sample_image_url, s.created_at,
              d.code as department_code, d.name as department_name,
              c.code as course_code, c.name as course_name,
              CASE WHEN ft.template_id IS NOT NULL THEN 1 ELSE 0 END as face_enrolled,
              ft.quality_score as template_quality,
              ft.sample_count as template_samples,
              ft.updated_at as template_updated_at
       FROM students s
       JOIN departments d ON d.department_id = s.department_id
       JOIN courses c ON c.course_id = s.course_id
       LEFT JOIN face_templates ft ON ft.student_id = s.student_id
       ${where}
       ORDER BY s.roll_number ASC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const enrollmentRows = db
    .prepare(
      `SELECT e.student_id, sub.subject_id, sub.code, sub.subject_name
       FROM enrollments e
       JOIN subjects sub ON sub.subject_id = e.subject_id`
    )
    .all() as Array<{ student_id: number; subject_id: number; code: string; subject_name: string }>;

  const enrollMap = new Map<number, Array<{ subject_id: number; code: string; subject_name: string }>>();
  for (const row of enrollmentRows) {
    const list = enrollMap.get(row.student_id) || [];
    list.push({ subject_id: row.subject_id, code: row.code, subject_name: row.subject_name });
    enrollMap.set(row.student_id, list);
  }

  const enriched = students.map((s) => ({
    ...s,
    enrolled_subjects: enrollMap.get(Number(s.student_id)) || [],
  }));

  res.json({ students: enriched });
});

apiRouter.get('/students/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (req.user!.role === 'student' && req.user!.id !== id) {
    res.status(403).json({ error: 'Access denied. You may only view your own student profile.' });
    return;
  }
  const student = db
    .prepare(
      `SELECT s.student_id, s.student_code, s.roll_number, s.name, s.email, s.phone,
              s.department_id, s.course_id, s.semester, s.section, s.academic_year,
              s.enrollment_date, s.is_active, s.biometric_consent, s.consent_timestamp,
              s.non_biometric_opt_out, s.sample_image_url, s.created_at,
              d.code as department_code, d.name as department_name,
              c.code as course_code, c.name as course_name,
              CASE WHEN ft.template_id IS NOT NULL THEN 1 ELSE 0 END as face_enrolled,
              ft.quality_score as template_quality,
              ft.updated_at as template_updated_at
       FROM students s
       JOIN departments d ON d.department_id = s.department_id
       JOIN courses c ON c.course_id = s.course_id
       LEFT JOIN face_templates ft ON ft.student_id = s.student_id
       WHERE s.student_id = ?`
    )
    .get(id);
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }
  const subjects = db
    .prepare(
      `SELECT sub.* FROM enrollments e
       JOIN subjects sub ON sub.subject_id = e.subject_id
       WHERE e.student_id = ?`
    )
    .all(id);
  res.json({ student, subjects });
});

apiRouter.post('/students', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const b = req.body ?? {};
  const required = ['student_code', 'roll_number', 'name', 'email', 'department_id', 'course_id'];
  for (const field of required) {
    if (!b[field] || String(b[field]).trim() === '') {
      res.status(400).json({ error: `Field "${field}" is required.` });
      return;
    }
  }
  const email = String(b.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Please provide a valid email address.' });
    return;
  }

  try {
    const insertTx = db.transaction(() => {
      const passwordHash = hashPassword(String(b.password || 'Student@123'));
      const info = db
        .prepare(
          `INSERT INTO students (
            student_code, roll_number, name, email, phone, department_id, course_id,
            semester, section, academic_year, enrollment_date, password_hash,
            non_biometric_opt_out
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(b.student_code).trim().toUpperCase(),
          String(b.roll_number).trim().toUpperCase(),
          String(b.name).trim(),
          email,
          String(b.phone || '').trim(),
          Number(b.department_id),
          Number(b.course_id),
          Number(b.semester || 5),
          String(b.section || 'A').trim().toUpperCase(),
          String(b.academic_year || '2026-27').trim(),
          String(b.enrollment_date || new Date().toISOString().slice(0, 10)),
          passwordHash,
          b.non_biometric_opt_out ? 1 : 0
        );
      const studentId = Number(info.lastInsertRowid);

      if (Array.isArray(b.subject_ids)) {
        const insEnr = db.prepare(
          'INSERT OR IGNORE INTO enrollments (student_id, subject_id) VALUES (?, ?)'
        );
        for (const subId of b.subject_ids) {
          insEnr.run(studentId, Number(subId));
        }
      }

      return studentId;
    });

    const studentId = insertTx();
    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'CREATE_STUDENT',
      resourceType: 'student',
      resourceId: studentId,
      details: `${String(b.roll_number).toUpperCase()} - ${b.name}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ student_id: studentId });
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('UNIQUE')) {
      res.status(409).json({
        error: 'Duplicate Student ID, Roll Number, or Email address already exists.',
      });
      return;
    }
    res.status(400).json({ error: 'Unable to create student record.' });
  }
});

apiRouter.put('/students/:id', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM students WHERE student_id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  const b = req.body ?? {};
  try {
    db.transaction(() => {
      db.prepare(
        `UPDATE students SET
          student_code = ?, roll_number = ?, name = ?, email = ?, phone = ?,
          department_id = ?, course_id = ?, semester = ?, section = ?,
          academic_year = ?, is_active = ?, non_biometric_opt_out = ?
         WHERE student_id = ?`
      ).run(
        String(b.student_code ?? existing.student_code).trim().toUpperCase(),
        String(b.roll_number ?? existing.roll_number).trim().toUpperCase(),
        String(b.name ?? existing.name).trim(),
        String(b.email ?? existing.email).trim().toLowerCase(),
        String(b.phone ?? existing.phone).trim(),
        Number(b.department_id ?? existing.department_id),
        Number(b.course_id ?? existing.course_id),
        Number(b.semester ?? existing.semester),
        String(b.section ?? existing.section).trim().toUpperCase(),
        String(b.academic_year ?? existing.academic_year).trim(),
        b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
        b.non_biometric_opt_out !== undefined
          ? b.non_biometric_opt_out
            ? 1
            : 0
          : existing.non_biometric_opt_out,
        id
      );

      if (Array.isArray(b.subject_ids)) {
        db.prepare('DELETE FROM enrollments WHERE student_id = ?').run(id);
        const insEnr = db.prepare(
          'INSERT OR IGNORE INTO enrollments (student_id, subject_id) VALUES (?, ?)'
        );
        for (const subId of b.subject_ids) {
          insEnr.run(id, Number(subId));
        }
      }
    })();

    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'UPDATE_STUDENT',
      resourceType: 'student',
      resourceId: id,
      details: `Updated student ${b.roll_number ?? existing.roll_number}`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    if (String(err).includes('UNIQUE')) {
      res.status(409).json({
        error: 'Duplicate Student ID, Roll Number, or Email conflict.',
      });
      return;
    }
    res.status(400).json({ error: 'Failed to update student.' });
  }
});

apiRouter.delete('/students/:id', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM students WHERE student_id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }
  const hard = req.query.hard === 'true';
  if (hard) {
    db.prepare('DELETE FROM students WHERE student_id = ?').run(id);
  } else {
    db.prepare('UPDATE students SET is_active = 0 WHERE student_id = ?').run(id);
  }
  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: hard ? 'DELETE_STUDENT' : 'DEACTIVATE_STUDENT',
    resourceType: 'student',
    resourceId: id,
    details: `${existing.roll_number} - ${existing.name}`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

apiRouter.post('/students/import-csv', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const { csvText } = req.body ?? {};
  if (typeof csvText !== 'string' || !csvText.trim()) {
    res.status(400).json({ error: 'CSV content is required.' });
    return;
  }

  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    res.status(400).json({ error: 'CSV must include a header row and at least one student row.' });
    return;
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const depts = db.prepare('SELECT department_id, code FROM departments').all() as Array<{
    department_id: number;
    code: string;
  }>;
  const courses = db.prepare('SELECT course_id, code FROM courses').all() as Array<{
    course_id: number;
    code: string;
  }>;
  const deptByCode = new Map(depts.map((d) => [d.code.toUpperCase(), d.department_id]));
  const courseByCode = new Map(courses.map((c) => [c.code.toUpperCase(), c.course_id]));

  const defaultPass = hashPassword('Student@123');
  const inserted: string[] = [];
  const errors: Array<{ row: number; error: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = cols[idx] || '';
    });

    const studentCode = (record.student_code || record.student_id || '').toUpperCase();
    const roll = (record.roll_number || '').toUpperCase();
    const name = record.name || record.student_name || '';
    const email = (record.email || '').toLowerCase();
    const deptCode = (record.department_code || record.department || 'CSE').toUpperCase();
    const courseCode = (record.course_code || record.course || 'BTECH-CSE').toUpperCase();

    if (!studentCode || !roll || !name || !email) {
      errors.push({ row: i + 1, error: 'Missing required student_code, roll_number, name, or email.' });
      continue;
    }

    const deptId = deptByCode.get(deptCode) || depts[0]?.department_id;
    const courseId = courseByCode.get(courseCode) || courses[0]?.course_id;
    if (!deptId || !courseId) {
      errors.push({ row: i + 1, error: `Unknown department (${deptCode}) or course (${courseCode}).` });
      continue;
    }

    try {
      const info = db
        .prepare(
          `INSERT INTO students (
            student_code, roll_number, name, email, phone, department_id, course_id,
            semester, section, academic_year, password_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          studentCode,
          roll,
          name,
          email,
          record.phone || '',
          deptId,
          courseId,
          Number(record.semester || 5),
          (record.section || 'A').toUpperCase(),
          record.academic_year || '2026-27',
          defaultPass
        );
      const newSid = Number(info.lastInsertRowid);
      const courseSubjects = db
        .prepare('SELECT subject_id FROM subjects WHERE course_id = ?')
        .all(courseId) as Array<{ subject_id: number }>;
      const insEnr = db.prepare(
        'INSERT OR IGNORE INTO enrollments (student_id, subject_id) VALUES (?, ?)'
      );
      for (const s of courseSubjects) insEnr.run(newSid, s.subject_id);
      inserted.push(roll);
    } catch {
      errors.push({ row: i + 1, error: `Duplicate student_code/roll_number/email (${roll}).` });
    }
  }

  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'IMPORT_STUDENTS_CSV',
    resourceType: 'student',
    details: `Imported ${inserted.length} students, ${errors.length} skipped`,
    ipAddress: getClientIp(req),
  });

  res.json({ inserted_count: inserted.length, inserted, errors });
});

// ============================================================
// 4. FACE ENROLLMENT & BIOMETRIC TEMPLATE PROTECTION
// ============================================================
apiRouter.post('/students/enroll', requireRole('admin', 'faculty'), (req: AuthenticatedRequest, res) => {
  const { student_id, embedding, quality_score, sample_count, consent_confirmed, model_name } =
    req.body ?? {};

  if (!student_id || !Array.isArray(embedding) || embedding.length < 64) {
    res.status(400).json({ error: 'Valid student_id and 128-D facial embedding array are required.' });
    return;
  }
  if (!consent_confirmed) {
    res.status(400).json({
      error: 'Explicit student authorization notice must be acknowledged before storing biometric templates.',
    });
    return;
  }

  const student = db
    .prepare('SELECT student_id, roll_number, name, non_biometric_opt_out FROM students WHERE student_id = ?')
    .get(Number(student_id)) as Record<string, unknown> | undefined;
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  const numericEmbedding = embedding.map(Number);
  if (numericEmbedding.some((v) => !Number.isFinite(v))) {
    res.status(400).json({ error: 'Invalid embedding vector values.' });
    return;
  }

  const qScore = Number(quality_score ?? 0.9);
  if (qScore < 0.5) {
    res.status(400).json({
      error: 'Image quality check failed (score below 0.50). Please recapture under even front lighting.',
    });
    return;
  }

  const { encrypted, iv, authTag } = encryptEmbedding(numericEmbedding);

  db.transaction(() => {
    db.prepare(
      `UPDATE students
       SET biometric_consent = 1, consent_timestamp = datetime('now'), non_biometric_opt_out = 0
       WHERE student_id = ?`
    ).run(Number(student_id));

    db.prepare(
      `INSERT INTO face_templates (
        student_id, encrypted_embedding, iv, auth_tag, model_name, quality_score, sample_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(student_id) DO UPDATE SET
        encrypted_embedding = excluded.encrypted_embedding,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        model_name = excluded.model_name,
        quality_score = excluded.quality_score,
        sample_count = excluded.sample_count,
        updated_at = datetime('now')`
    ).run(
      Number(student_id),
      encrypted,
      iv,
      authTag,
      String(model_name || 'face_recognition_resnet34_128d'),
      qScore,
      Number(sample_count || 1)
    );
  })();

  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'ENROLL_FACE_TEMPLATE',
    resourceType: 'face_template',
    resourceId: Number(student_id),
    details: `Encrypted AES-256-GCM template stored for ${student.roll_number} (quality=${qScore.toFixed(2)})`,
    ipAddress: getClientIp(req),
  });

  res.status(201).json({
    ok: true,
    message: `Encrypted biometric template enrolled for ${student.name} (${student.roll_number}). Raw image was not retained.`,
  });
});

apiRouter.delete('/students/:id/biometrics', requireAuth, (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (req.user!.role === 'student' && req.user!.id !== id) {
    res.status(403).json({ error: 'You may only withdraw your own biometric consent.' });
    return;
  }
  const student = db
    .prepare('SELECT student_id, roll_number, name FROM students WHERE student_id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!student) {
    res.status(404).json({ error: 'Student not found.' });
    return;
  }

  db.transaction(() => {
    db.prepare('DELETE FROM face_templates WHERE student_id = ?').run(id);
    db.prepare(
      `UPDATE students
       SET biometric_consent = 0, consent_timestamp = NULL, non_biometric_opt_out = 1
       WHERE student_id = ?`
    ).run(id);
  })();

  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'WITHDRAW_BIOMETRIC_CONSENT',
    resourceType: 'face_template',
    resourceId: id,
    details: `Deleted biometric template for ${student.roll_number}; opted into non-biometric attendance.`,
    ipAddress: getClientIp(req),
  });

  res.json({
    ok: true,
    message: 'Biometric template permanently deleted. Student switched to manual non-biometric attendance.',
  });
});

// ============================================================
// 5. FACULTY ROUTES
// ============================================================
apiRouter.get('/faculty', requireRole('admin', 'faculty'), (_req, res) => {
  const faculty = db
    .prepare(
      `SELECT f.faculty_id, f.employee_code, f.name, f.email, f.department_id,
              f.designation, f.is_active, f.created_at,
              d.code as department_code, d.name as department_name
       FROM faculty f
       JOIN departments d ON d.department_id = f.department_id
       ORDER BY f.employee_code`
    )
    .all() as Array<Record<string, unknown>>;

  const subjects = db
    .prepare('SELECT subject_id, code, subject_name, faculty_id, semester FROM subjects')
    .all() as Array<{ subject_id: number; code: string; subject_name: string; faculty_id: number | null; semester: number }>;

  const subMap = new Map<number, typeof subjects>();
  for (const s of subjects) {
    if (s.faculty_id) {
      const list = subMap.get(s.faculty_id) || [];
      list.push(s);
      subMap.set(s.faculty_id, list);
    }
  }

  res.json({
    faculty: faculty.map((f) => ({
      ...f,
      assigned_subjects: subMap.get(Number(f.faculty_id)) || [],
    })),
  });
});

apiRouter.post('/faculty', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const { employee_code, name, email, department_id, designation, password } = req.body ?? {};
  if (!employee_code?.trim() || !name?.trim() || !email?.trim() || !department_id) {
    res.status(400).json({ error: 'Employee code, name, email, and department are required.' });
    return;
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO faculty (employee_code, name, email, password_hash, department_id, designation)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        employee_code.trim().toUpperCase(),
        name.trim(),
        email.trim().toLowerCase(),
        hashPassword(String(password || 'Faculty@123')),
        Number(department_id),
        String(designation || 'Assistant Professor').trim()
      );
    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'CREATE_FACULTY',
      resourceType: 'faculty',
      resourceId: Number(info.lastInsertRowid),
      details: `${employee_code.trim().toUpperCase()} - ${name.trim()}`,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ faculty_id: Number(info.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Faculty employee code or email already exists.' });
  }
});

apiRouter.put('/faculty/:id', requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM faculty WHERE faculty_id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Faculty member not found.' });
    return;
  }
  const b = req.body ?? {};
  try {
    db.prepare(
      `UPDATE faculty SET
        employee_code = ?, name = ?, email = ?, department_id = ?, designation = ?, is_active = ?
       WHERE faculty_id = ?`
    ).run(
      String(b.employee_code ?? existing.employee_code).trim().toUpperCase(),
      String(b.name ?? existing.name).trim(),
      String(b.email ?? existing.email).trim().toLowerCase(),
      Number(b.department_id ?? existing.department_id),
      String(b.designation ?? existing.designation).trim(),
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
      id
    );
    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'UPDATE_FACULTY',
      resourceType: 'faculty',
      resourceId: id,
      details: `Updated faculty ${b.name ?? existing.name}`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'Duplicate faculty employee code or email.' });
  }
});

// ============================================================
// 6. ATTENDANCE SESSIONS ROUTES
// ============================================================
apiRouter.get('/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  let sql = `
    SELECT s.*, sub.code as subject_code, sub.subject_name, sub.semester,
           c.code as course_code, c.name as course_name,
           d.code as department_code, d.name as department_name,
           f.name as faculty_name,
           (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.session_id AND a.status IN ('Present', 'Late')) as present_count,
           (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.session_id AND a.status = 'Absent') as absent_count,
           (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.session_id AND a.verification_method = 'AI_Proposal_Pending') as pending_review_count
    FROM attendance_sessions s
    JOIN subjects sub ON sub.subject_id = s.subject_id
    JOIN courses c ON c.course_id = sub.course_id
    JOIN departments d ON d.department_id = c.department_id
    JOIN faculty f ON f.faculty_id = s.faculty_id
  `;
  const params: unknown[] = [];

  if (user.role === 'faculty') {
    sql += ' WHERE s.faculty_id = ?';
    params.push(user.id);
  } else if (user.role === 'student') {
    sql +=
      ' WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = ? AND e.subject_id = s.subject_id)';
    params.push(user.id);
  }

  sql += ' ORDER BY s.session_id DESC LIMIT 100';
  const sessions = db.prepare(sql).all(...params);
  res.json({ sessions });
});

function startSessionHandler(req: AuthenticatedRequest, res: express.Response) {
  const { subject_id, section, detector_used } = req.body ?? {};
  if (!subject_id) {
    res.status(400).json({ error: 'Subject ID is required to start a session.' });
    return;
  }

  const subject = db
    .prepare('SELECT * FROM subjects WHERE subject_id = ?')
    .get(Number(subject_id)) as Record<string, unknown> | undefined;
  if (!subject) {
    res.status(404).json({ error: 'Selected subject not found.' });
    return;
  }

  const facultyId =
    req.user!.role === 'faculty'
      ? req.user!.id
      : Number(req.body.faculty_id || subject.faculty_id);

  if (!facultyId) {
    res.status(400).json({ error: 'No faculty assigned to this subject.' });
    return;
  }

  const settings = getSettings();
  const detector =
    detector_used === 'tiny_face_detector' || detector_used === 'ssd_mobilenetv1'
      ? detector_used
      : String(settings.detector_backend);

  const info = db
    .prepare(
      `INSERT INTO attendance_sessions (
        subject_id, faculty_id, section, session_date, start_time,
        session_status, detector_used, threshold_used
      ) VALUES (?, ?, ?, date('now'), datetime('now'), 'active', ?, ?)`
    )
    .run(
      Number(subject_id),
      facultyId,
      String(section || 'A').toUpperCase(),
      detector,
      Number(settings.recognition_threshold)
    );

  const sessionId = Number(info.lastInsertRowid);
  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'START_ATTENDANCE_SESSION',
    resourceType: 'attendance_session',
    resourceId: sessionId,
    details: `Started session for ${subject.code} (Section ${String(section || 'A').toUpperCase()})`,
    ipAddress: getClientIp(req),
  });

  const session = db
    .prepare(
      `SELECT s.*, sub.code as subject_code, sub.subject_name, f.name as faculty_name
       FROM attendance_sessions s
       JOIN subjects sub ON sub.subject_id = s.subject_id
       JOIN faculty f ON f.faculty_id = s.faculty_id
       WHERE s.session_id = ?`
    )
    .get(sessionId);

  res.status(201).json({ session });
}

apiRouter.post('/sessions', requireRole('admin', 'faculty'), startSessionHandler);
apiRouter.post('/sessions/start', requireRole('admin', 'faculty'), startSessionHandler);

apiRouter.post('/sessions/:id/close', requireRole('admin', 'faculty'), (req: AuthenticatedRequest, res) => {
  const sessionId = Number(req.params.id);
  const session = db
    .prepare('SELECT * FROM attendance_sessions WHERE session_id = ?')
    .get(sessionId) as Record<string, unknown> | undefined;
  if (!session) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  if (req.user!.role === 'faculty' && Number(session.faculty_id) !== req.user!.id) {
    res.status(403).json({ error: 'You can only close your own attendance sessions.' });
    return;
  }

  const markUnmarkedAbsent = req.body?.mark_unmarked_absent !== false;

  db.transaction(() => {
    // Approve any remaining AI_Proposal_Pending only if explicitly requested, else mark unmarked enrolled students Absent
    if (markUnmarkedAbsent) {
      const enrolled = db
        .prepare(
          `SELECT s.student_id
           FROM enrollments e
           JOIN students s ON s.student_id = e.student_id
           WHERE e.subject_id = ? AND s.is_active = 1 AND s.section = ?`
        )
        .all(Number(session.subject_id), String(session.section)) as Array<{ student_id: number }>;

      const insAbsent = db.prepare(
        `INSERT OR IGNORE INTO attendance (
          student_id, session_id, status, verification_method, reviewed_by, notes
        ) VALUES (?, ?, 'Absent', 'Manual_Faculty', ?, 'Auto-finalized on session close')`
      );
      for (const stu of enrolled) {
        insAbsent.run(stu.student_id, sessionId, req.user!.name);
      }
    }

    db.prepare(
      `UPDATE attendance_sessions
       SET session_status = 'closed', end_time = datetime('now')
       WHERE session_id = ?`
    ).run(sessionId);
  })();

  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CLOSE_ATTENDANCE_SESSION',
    resourceType: 'attendance_session',
    resourceId: sessionId,
    details: `Closed session #${sessionId}`,
    ipAddress: getClientIp(req),
  });

  res.json({ ok: true });
});

apiRouter.post('/sessions/:id/cancel', requireRole('admin', 'faculty'), (req: AuthenticatedRequest, res) => {
  const sessionId = Number(req.params.id);
  db.prepare(
    `UPDATE attendance_sessions SET session_status = 'cancelled', end_time = datetime('now') WHERE session_id = ?`
  ).run(sessionId);
  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CANCEL_ATTENDANCE_SESSION',
    resourceType: 'attendance_session',
    resourceId: sessionId,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

// ============================================================
// 7. ATTENDANCE & AI RECOGNITION ENGINE ROUTES
// ============================================================
apiRouter.get('/attendance', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { session_id, subject_id, student_id, date, status } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (user.role === 'student') {
    conditions.push('a.student_id = ?');
    params.push(user.id);
  } else if (user.role === 'faculty') {
    conditions.push('sess.faculty_id = ?');
    params.push(user.id);
  }

  if (session_id) {
    conditions.push('a.session_id = ?');
    params.push(Number(session_id));
  }
  if (subject_id) {
    conditions.push('sess.subject_id = ?');
    params.push(Number(subject_id));
  }
  if (student_id && user.role !== 'student') {
    conditions.push('a.student_id = ?');
    params.push(Number(student_id));
  }
  if (date) {
    conditions.push('sess.session_date = ?');
    params.push(String(date));
  }
  if (status) {
    conditions.push('a.status = ?');
    params.push(String(status));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const records = db
    .prepare(
      `SELECT a.*, st.roll_number, st.name as student_name, st.section,
              d.code as department_code,
              sess.session_date, sess.session_status, sess.start_time,
              sub.subject_id, sub.code as subject_code, sub.subject_name,
              f.name as faculty_name
       FROM attendance a
       JOIN students st ON st.student_id = a.student_id
       JOIN departments d ON d.department_id = st.department_id
       JOIN attendance_sessions sess ON sess.session_id = a.session_id
       JOIN subjects sub ON sub.subject_id = sess.subject_id
       JOIN faculty f ON f.faculty_id = sess.faculty_id
       ${where}
       ORDER BY a.attendance_id DESC
       LIMIT 300`
    )
    .all(...params);

  res.json({ attendance: records });
});

apiRouter.post('/attendance/manual', requireRole('admin', 'faculty'), (req: AuthenticatedRequest, res) => {
  const { session_id, student_id, status, notes } = req.body ?? {};
  const validStatuses = ['Present', 'Absent', 'Late', 'Excused'];
  if (!session_id || !student_id || !validStatuses.includes(status)) {
    res.status(400).json({ error: 'Valid session_id, student_id, and status are required.' });
    return;
  }

  const session = db
    .prepare('SELECT * FROM attendance_sessions WHERE session_id = ?')
    .get(Number(session_id)) as Record<string, unknown> | undefined;
  if (!session) {
    res.status(404).json({ error: 'Attendance session not found.' });
    return;
  }

  const enrolled = db
    .prepare('SELECT 1 FROM enrollments WHERE student_id = ? AND subject_id = ?')
    .get(Number(student_id), Number(session.subject_id));
  if (!enrolled) {
    res.status(400).json({ error: 'Student is not enrolled in this subject.' });
    return;
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO attendance (student_id, session_id, status, verification_method, reviewed_by, notes)
         VALUES (?, ?, ?, 'Manual_Faculty', ?, ?)`
      )
      .run(
        Number(student_id),
        Number(session_id),
        status,
        req.user!.name,
        String(notes || '').trim()
      );

    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'MANUAL_ATTENDANCE',
      resourceType: 'attendance',
      resourceId: Number(info.lastInsertRowid),
      details: `Session #${session_id}, Student #${student_id} -> ${status}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ attendance_id: Number(info.lastInsertRowid) });
  } catch (err: unknown) {
    if (String(err).includes('UNIQUE')) {
      res.status(409).json({
        error: 'Duplicate attendance prevented: a record already exists for this student in this session. Use edit/correction instead.',
      });
      return;
    }
    res.status(400).json({ error: 'Failed to record manual attendance.' });
  }
});

apiRouter.post('/attendance/recognize', recognitionLimiter, requireRole('admin', 'faculty'), (req: AuthenticatedRequest, res) => {
  const { session_id, faces, detector_name } = req.body ?? {};
  if (!session_id || !Array.isArray(faces) || faces.length === 0) {
    res.status(400).json({ error: 'session_id and detected faces array are required.' });
    return;
  }

  const session = db
    .prepare('SELECT * FROM attendance_sessions WHERE session_id = ?')
    .get(Number(session_id)) as Record<string, unknown> | undefined;
  if (!session || session.session_status !== 'active') {
    res.status(400).json({ error: 'Attendance session is not active.' });
    return;
  }

  const settings = getSettings();
  const recognitionThreshold = Number(settings.recognition_threshold);
  const uncertainThreshold = Number(settings.uncertain_threshold);
  const detector = String(detector_name || session.detector_used || 'ssd_mobilenetv1');

  // Load authorized, enrolled students with active encrypted templates
  const candidateRows = db
    .prepare(
      `SELECT st.student_id, st.roll_number, st.name, st.section,
              ft.encrypted_embedding, ft.iv, ft.auth_tag
       FROM enrollments e
       JOIN students st ON st.student_id = e.student_id
       JOIN face_templates ft ON ft.student_id = st.student_id
       WHERE e.subject_id = ?
         AND st.is_active = 1
         AND st.biometric_consent = 1
         AND st.non_biometric_opt_out = 0`
    )
    .all(Number(session.subject_id)) as Array<{
    student_id: number;
    roll_number: string;
    name: string;
    section: string;
    encrypted_embedding: string;
    iv: string;
    auth_tag: string;
  }>;

  const decryptedTemplates = candidateRows.map((row) => ({
    student_id: row.student_id,
    roll_number: row.roll_number,
    name: row.name,
    section: row.section,
    embedding: decryptEmbedding(row.encrypted_embedding, row.iv, row.auth_tag),
  }));

  const results: Array<{
    face_index: number;
    decision: 'proposed' | 'duplicate' | 'uncertain' | 'unknown';
    student_id: number | null;
    roll_number: string | null;
    student_name: string | null;
    cosine_similarity: number;
    attendance_id: number | null;
    message: string;
  }> = [];

  let proposalsAdded = 0;
  let unknownsAdded = 0;

  const insertRecLog = db.prepare(
    `INSERT INTO recognition_logs (session_id, matched_student_id, cosine_similarity, decision, detector_name)
     VALUES (?, ?, ?, ?, ?)`
  );

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    if (!face || !Array.isArray(face.embedding) || face.embedding.length < 64) {
      continue;
    }
    const queryVec = face.embedding.map(Number);

    let bestMatch: (typeof decryptedTemplates)[number] | null = null;
    let bestSim = -1;

    for (const tpl of decryptedTemplates) {
      const sim = cosineSimilarity(queryVec, tpl.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = tpl;
      }
    }

    if (bestMatch && bestSim >= recognitionThreshold) {
      // Check database unique constraint before proposing
      const existingAtt = db
        .prepare('SELECT attendance_id, status, verification_method FROM attendance WHERE student_id = ? AND session_id = ?')
        .get(bestMatch.student_id, Number(session_id)) as
        | { attendance_id: number; status: string; verification_method: string }
        | undefined;

      if (existingAtt) {
        insertRecLog.run(Number(session_id), bestMatch.student_id, bestSim, 'duplicate_skipped', detector);
        results.push({
          face_index: i,
          decision: 'duplicate',
          student_id: bestMatch.student_id,
          roll_number: bestMatch.roll_number,
          student_name: bestMatch.name,
          cosine_similarity: Number(bestSim.toFixed(4)),
          attendance_id: existingAtt.attendance_id,
          message: `Already recorded (${existingAtt.status}) in this session — duplicate prevented.`,
        });
      } else {
        const info = db
          .prepare(
            `INSERT INTO attendance (
              student_id, session_id, status, confidence_score, verification_method, reviewed_by, notes
            ) VALUES (?, ?, 'Present', ?, 'AI_Proposal_Pending', NULL, 'Proposed by AI recognition; awaiting faculty confirmation')`
          )
          .run(bestMatch.student_id, Number(session_id), Number(bestSim.toFixed(4)));

        proposalsAdded += 1;
        insertRecLog.run(Number(session_id), bestMatch.student_id, bestSim, 'matched', detector);
        results.push({
          face_index: i,
          decision: 'proposed',
          student_id: bestMatch.student_id,
          roll_number: bestMatch.roll_number,
          student_name: bestMatch.name,
          cosine_similarity: Number(bestSim.toFixed(4)),
          attendance_id: Number(info.lastInsertRowid),
          message: `Matched ${bestMatch.name} (similarity ${bestSim.toFixed(2)}) — staged for faculty review.`,
        });
      }
    } else if (bestMatch && bestSim >= uncertainThreshold) {
      // Uncertain identity: NEVER auto-record! Route to faculty manual review.
      insertRecLog.run(Number(session_id), bestMatch.student_id, bestSim, 'uncertain', detector);
      results.push({
        face_index: i,
        decision: 'uncertain',
        student_id: bestMatch.student_id,
        roll_number: bestMatch.roll_number,
        student_name: bestMatch.name,
        cosine_similarity: Number(bestSim.toFixed(4)),
        attendance_id: null,
        message: `Uncertain match near ${bestMatch.name} (${bestSim.toFixed(2)} < ${recognitionThreshold}). Held for manual review.`,
      });
    } else {
      unknownsAdded += 1;
      insertRecLog.run(Number(session_id), null, Math.max(bestSim, 0), 'unknown', detector);
      results.push({
        face_index: i,
        decision: 'unknown',
        student_id: null,
        roll_number: null,
        student_name: null,
        cosine_similarity: Number(Math.max(bestSim, 0).toFixed(4)),
        attendance_id: null,
        message: 'Unknown identity or un-enrolled face rejected.',
      });
    }
  }

  db.prepare(
    `UPDATE attendance_sessions
     SET faces_detected_count = faces_detected_count + ?,
         proposals_count = proposals_count + ?,
         unknown_count = unknown_count + ?
     WHERE session_id = ?`
  ).run(faces.length, proposalsAdded, unknownsAdded, Number(session_id));

  res.json({
    session_id: Number(session_id),
    threshold_used: recognitionThreshold,
    uncertain_threshold: uncertainThreshold,
    enrolled_templates_checked: decryptedTemplates.length,
    results,
  });
});

apiRouter.post('/attendance/review', requireRole('admin', 'faculty'), (req: AuthenticatedRequest, res) => {
  const { attendance_id, action, status } = req.body ?? {};
  if (!attendance_id || !['approve', 'reject', 'approve_all'].includes(action)) {
    res.status(400).json({ error: 'Valid attendance_id and review action required.' });
    return;
  }

  if (action === 'approve_all') {
    const sessionId = Number(req.body.session_id);
    const info = db
      .prepare(
        `UPDATE attendance
         SET verification_method = 'AI_Face_Approved', reviewed_by = ?, notes = 'Batch approved by faculty'
         WHERE session_id = ? AND verification_method = 'AI_Proposal_Pending'`
      )
      .run(req.user!.name, sessionId);
    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'APPROVE_ALL_AI_PROPOSALS',
      resourceType: 'attendance_session',
      resourceId: sessionId,
      details: `Approved ${info.changes} AI proposals`,
      ipAddress: getClientIp(req),
    });
    res.json({ approved_count: info.changes });
    return;
  }

  if (action === 'reject') {
    db.prepare('DELETE FROM attendance WHERE attendance_id = ?').run(Number(attendance_id));
    writeAuditLog({
      userRole: req.user!.role,
      userId: req.user!.id,
      userEmail: req.user!.email,
      action: 'REJECT_AI_PROPOSAL',
      resourceType: 'attendance',
      resourceId: Number(attendance_id),
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
    return;
  }

  const nextStatus = ['Present', 'Late', 'Excused', 'Absent'].includes(status)
    ? status
    : 'Present';
  db.prepare(
    `UPDATE attendance
     SET status = ?, verification_method = 'AI_Face_Approved', reviewed_by = ?, notes = 'Verified by faculty'
     WHERE attendance_id = ?`
  ).run(nextStatus, req.user!.name, Number(attendance_id));

  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'APPROVE_AI_PROPOSAL',
    resourceType: 'attendance',
    resourceId: Number(attendance_id),
    details: `Confirmed as ${nextStatus}`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

apiRouter.put('/attendance/:id', requireRole('admin', 'faculty'), (req: AuthenticatedRequest, res) => {
  const attendanceId = Number(req.params.id);
  const { status, notes } = req.body ?? {};
  const validStatuses = ['Present', 'Absent', 'Late', 'Excused'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid attendance status.' });
    return;
  }
  const existing = db
    .prepare('SELECT * FROM attendance WHERE attendance_id = ?')
    .get(attendanceId) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Attendance record not found.' });
    return;
  }

  db.prepare(
    `UPDATE attendance
     SET status = ?, verification_method = 'Corrected_Faculty', reviewed_by = ?, notes = ?
     WHERE attendance_id = ?`
  ).run(status, req.user!.name, String(notes ?? existing.notes ?? ''), attendanceId);

  writeAuditLog({
    userRole: req.user!.role,
    userId: req.user!.id,
    userEmail: req.user!.email,
    action: 'CORRECT_ATTENDANCE',
    resourceType: 'attendance',
    resourceId: attendanceId,
    details: `Changed from ${existing.status} to ${status}`,
    ipAddress: getClientIp(req),
  });
  res.json({ ok: true });
});

// ============================================================
// 8. ANALYTICS ROUTES
// ============================================================
apiRouter.get('/analytics/overview', requireAuth, (req: AuthenticatedRequest, res) => {
  const settings = getSettings();
  const shortageThreshold = Number(settings.shortage_threshold || 75);
  const lateCounts = Number(settings.late_counts_as_attended) === 1;

  const totals = {
    total_students: (
      db.prepare('SELECT COUNT(*) as c FROM students WHERE is_active = 1').get() as { c: number }
    ).c,
    total_faculty: (
      db.prepare('SELECT COUNT(*) as c FROM faculty WHERE is_active = 1').get() as { c: number }
    ).c,
    total_departments: (
      db.prepare('SELECT COUNT(*) as c FROM departments').get() as { c: number }
    ).c,
    total_courses: (
      db.prepare('SELECT COUNT(*) as c FROM courses').get() as { c: number }
    ).c,
    total_subjects: (
      db.prepare('SELECT COUNT(*) as c FROM subjects').get() as { c: number }
    ).c,
    enrolled_templates: (
      db.prepare('SELECT COUNT(*) as c FROM face_templates').get() as { c: number }
    ).c,
    active_sessions: (
      db
        .prepare("SELECT COUNT(*) as c FROM attendance_sessions WHERE session_status = 'active'")
        .get() as { c: number }
    ).c,
  };

  const todayStats = db
    .prepare(
      `SELECT
        COUNT(*) as total_records,
        SUM(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE 0 END) as present_count,
        SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count
       FROM attendance a
       JOIN attendance_sessions s ON s.session_id = a.session_id
       WHERE s.session_date = date('now') AND s.session_status != 'cancelled'`
    )
    .get() as { total_records: number; present_count: number | null; absent_count: number | null };

  const overallStats = db
    .prepare(
      `SELECT
        COUNT(*) as total_records,
        SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_count,
        SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) as late_count,
        SUM(CASE WHEN a.status = 'Excused' THEN 1 ELSE 0 END) as excused_count,
        SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count
       FROM attendance a
       JOIN attendance_sessions s ON s.session_id = a.session_id
       WHERE s.session_status != 'cancelled'`
    )
    .get() as Record<string, number | null>;

  const totalRec = overallStats.total_records || 0;
  const attendedRec =
    (overallStats.present_count || 0) +
    (lateCounts ? overallStats.late_count || 0 : 0) +
    (overallStats.excused_count || 0);
  const overallRate = totalRec > 0 ? Number(((attendedRec / totalRec) * 100).toFixed(1)) : 0;

  // Shortage count across active students
  const studentRates = db
    .prepare(
      `SELECT st.student_id, st.roll_number, st.name,
              COUNT(a.attendance_id) as total,
              SUM(CASE WHEN a.status = 'Present' OR a.status = 'Excused' OR (? = 1 AND a.status = 'Late') THEN 1 ELSE 0 END) as attended
       FROM students st
       LEFT JOIN attendance a ON a.student_id = st.student_id
       LEFT JOIN attendance_sessions sess ON sess.session_id = a.session_id AND sess.session_status != 'cancelled'
       WHERE st.is_active = 1
       GROUP BY st.student_id`
    )
    .all(lateCounts ? 1 : 0) as Array<{
    student_id: number;
    roll_number: string;
    name: string;
    total: number;
    attended: number | null;
  }>;

  const shortageStudents = studentRates
    .filter((r) => r.total > 0 && ((r.attended || 0) / r.total) * 100 < shortageThreshold)
    .map((r) => ({
      ...r,
      percentage: Number((((r.attended || 0) / r.total) * 100).toFixed(1)),
    }));

  const recentLogs =
    req.user!.role === 'admin'
      ? db.prepare('SELECT * FROM audit_logs ORDER BY log_id DESC LIMIT 8').all()
      : [];

  res.json({
    totals,
    today: {
      total_records: todayStats.total_records || 0,
      present_students: todayStats.present_count || 0,
      absent_students: todayStats.absent_count || 0,
    },
    overall_rate: overallRate,
    status_breakdown: {
      Present: overallStats.present_count || 0,
      Late: overallStats.late_count || 0,
      Excused: overallStats.excused_count || 0,
      Absent: overallStats.absent_count || 0,
    },
    shortage_students: shortageStudents,
    recent_activities: recentLogs,
  });
});

apiRouter.get('/analytics/monthly', requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT sess.session_date as label,
              COUNT(a.attendance_id) as total,
              SUM(CASE WHEN a.status IN ('Present', 'Late', 'Excused') THEN 1 ELSE 0 END) as attended,
              SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent
       FROM attendance_sessions sess
       LEFT JOIN attendance a ON a.session_id = sess.session_id
       WHERE sess.session_status != 'cancelled'
       GROUP BY sess.session_date
       ORDER BY sess.session_date ASC
       LIMIT 30`
    )
    .all() as Array<{ label: string; total: number; attended: number | null; absent: number | null }>;

  const series = rows.map((r) => ({
    date: r.label,
    total: r.total,
    attended: r.attended || 0,
    absent: r.absent || 0,
    rate: r.total > 0 ? Number((((r.attended || 0) / r.total) * 100).toFixed(1)) : 0,
  }));

  res.json({ series });
});

apiRouter.get('/analytics/department', requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT d.code, d.name,
              COUNT(a.attendance_id) as total,
              SUM(CASE WHEN a.status IN ('Present', 'Late', 'Excused') THEN 1 ELSE 0 END) as attended
       FROM departments d
       LEFT JOIN students st ON st.department_id = d.department_id AND st.is_active = 1
       LEFT JOIN attendance a ON a.student_id = st.student_id
       LEFT JOIN attendance_sessions sess ON sess.session_id = a.session_id AND sess.session_status != 'cancelled'
       GROUP BY d.department_id
       ORDER BY d.code`
    )
    .all() as Array<{ code: string; name: string; total: number; attended: number | null }>;

  res.json({
    departments: rows.map((r) => ({
      code: r.code,
      name: r.name,
      total: r.total,
      attended: r.attended || 0,
      rate: r.total > 0 ? Number((((r.attended || 0) / r.total) * 100).toFixed(1)) : 0,
    })),
  });
});

apiRouter.get('/analytics/student/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const studentId = Number(req.params.id);
  if (req.user!.role === 'student' && req.user!.id !== studentId) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const settings = getSettings();
  const shortageThreshold = Number(settings.shortage_threshold || 75);
  const lateCounts = Number(settings.late_counts_as_attended) === 1;

  const subjectWise = db
    .prepare(
      `SELECT sub.subject_id, sub.code, sub.subject_name, f.name as faculty_name,
              COUNT(a.attendance_id) as total_classes,
              SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_count,
              SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) as late_count,
              SUM(CASE WHEN a.status = 'Excused' THEN 1 ELSE 0 END) as excused_count,
              SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count
       FROM enrollments e
       JOIN subjects sub ON sub.subject_id = e.subject_id
       LEFT JOIN faculty f ON f.faculty_id = sub.faculty_id
       LEFT JOIN attendance_sessions sess ON sess.subject_id = sub.subject_id AND sess.session_status != 'cancelled'
       LEFT JOIN attendance a ON a.session_id = sess.session_id AND a.student_id = e.student_id
       WHERE e.student_id = ?
       GROUP BY sub.subject_id
       ORDER BY sub.code`
    )
    .all(studentId) as Array<Record<string, unknown>>;

  let totalClasses = 0;
  let totalAttended = 0;
  let totalAbsent = 0;

  const subjects = subjectWise.map((row) => {
    const total = Number(row.total_classes || 0);
    const present = Number(row.present_count || 0);
    const late = Number(row.late_count || 0);
    const excused = Number(row.excused_count || 0);
    const absent = Number(row.absent_count || 0);
    const attended = present + (lateCounts ? late : 0) + excused;
    const pct = total > 0 ? Number(((attended / total) * 100).toFixed(1)) : 100;

    totalClasses += total;
    totalAttended += attended;
    totalAbsent += absent;

    return {
      ...row,
      attended_count: attended,
      percentage: pct,
      shortage: total > 0 && pct < shortageThreshold,
    };
  });

  const overallPercentage =
    totalClasses > 0 ? Number(((totalAttended / totalClasses) * 100).toFixed(1)) : 100;

  const history = db
    .prepare(
      `SELECT a.*, sess.session_date, sess.start_time, sub.code as subject_code, sub.subject_name
       FROM attendance a
       JOIN attendance_sessions sess ON sess.session_id = a.session_id
       JOIN subjects sub ON sub.subject_id = sess.subject_id
       WHERE a.student_id = ? AND sess.session_status != 'cancelled'
       ORDER BY sess.session_date DESC, a.attendance_id DESC
       LIMIT 50`
    )
    .all(studentId);

  res.json({
    summary: {
      total_classes: totalClasses,
      classes_attended: totalAttended,
      classes_absent: totalAbsent,
      attendance_percentage: overallPercentage,
      shortage_threshold: shortageThreshold,
      has_shortage: totalClasses > 0 && overallPercentage < shortageThreshold,
    },
    subjects,
    history,
  });
});

// ============================================================
// 9. REPORT GENERATION ROUTES (PDF / EXCEL / CSV)
// ============================================================
function queryReportData(req: AuthenticatedRequest): {
  rows: ReportSummaryRow[];
  meta: {
    institutionName: string;
    academicYear: string;
    departmentLabel: string;
    subjectLabel: string;
    facultyName: string;
    dateRangeLabel: string;
    shortageThreshold: number;
  };
} {
  const settings = getSettings();
  const shortageThreshold = Number(settings.shortage_threshold || 75);
  const lateCounts = Number(settings.late_counts_as_attended) === 1;

  const { department_id, subject_id, student_id, date_from, date_to, section } = req.query;

  const conditions: string[] = ["sess.session_status != 'cancelled'"];
  const params: unknown[] = [];

  if (req.user!.role === 'student') {
    conditions.push('st.student_id = ?');
    params.push(req.user!.id);
  } else if (req.user!.role === 'faculty') {
    conditions.push('sess.faculty_id = ?');
    params.push(req.user!.id);
  }

  if (department_id) {
    conditions.push('st.department_id = ?');
    params.push(Number(department_id));
  }
  if (subject_id) {
    conditions.push('sub.subject_id = ?');
    params.push(Number(subject_id));
  }
  if (student_id && req.user!.role !== 'student') {
    conditions.push('st.student_id = ?');
    params.push(Number(student_id));
  }
  if (section) {
    conditions.push('st.section = ?');
    params.push(String(section).toUpperCase());
  }
  if (date_from) {
    conditions.push('sess.session_date >= ?');
    params.push(String(date_from));
  }
  if (date_to) {
    conditions.push('sess.session_date <= ?');
    params.push(String(date_to));
  }

  const rawRows = db
    .prepare(
      `SELECT st.roll_number, st.name as student_name, d.code as department_code,
              sub.code as subject_code, sub.subject_name,
              COUNT(a.attendance_id) as total_sessions,
              SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_count,
              SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) as late_count,
              SUM(CASE WHEN a.status = 'Excused' THEN 1 ELSE 0 END) as excused_count,
              SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count
       FROM attendance a
       JOIN students st ON st.student_id = a.student_id
       JOIN departments d ON d.department_id = st.department_id
       JOIN attendance_sessions sess ON sess.session_id = a.session_id
       JOIN subjects sub ON sub.subject_id = sess.subject_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY st.student_id, sub.subject_id
       ORDER BY sub.code ASC, st.roll_number ASC`
    )
    .all(...params) as Array<Record<string, unknown>>;

  const rows: ReportSummaryRow[] = rawRows.map((r) => {
    const total = Number(r.total_sessions || 0);
    const present = Number(r.present_count || 0);
    const late = Number(r.late_count || 0);
    const excused = Number(r.excused_count || 0);
    const absent = Number(r.absent_count || 0);
    const attended = present + (lateCounts ? late : 0) + excused;
    const pct = total > 0 ? (attended / total) * 100 : 0;
    return {
      roll_number: String(r.roll_number),
      student_name: String(r.student_name),
      department_code: String(r.department_code),
      subject_code: String(r.subject_code),
      subject_name: String(r.subject_name),
      total_sessions: total,
      present_count: present,
      late_count: late,
      excused_count: excused,
      absent_count: absent,
      attendance_percentage: pct,
      shortage: total > 0 && pct < shortageThreshold,
    };
  });

  const deptObj = department_id
    ? (db.prepare('SELECT code, name FROM departments WHERE department_id = ?').get(Number(department_id)) as
        | { code: string; name: string }
        | undefined)
    : undefined;
  const subObj = subject_id
    ? (db
        .prepare(
          `SELECT sub.code, sub.subject_name, f.name as faculty_name
           FROM subjects sub LEFT JOIN faculty f ON f.faculty_id = sub.faculty_id
           WHERE sub.subject_id = ?`
        )
        .get(Number(subject_id)) as { code: string; subject_name: string; faculty_name: string } | undefined)
    : undefined;

  return {
    rows,
    meta: {
      institutionName: String(settings.institution_name),
      academicYear: String(settings.academic_year),
      departmentLabel: deptObj ? `${deptObj.code} — ${deptObj.name}` : 'All Departments',
      subjectLabel: subObj ? `${subObj.code} — ${subObj.subject_name}` : 'All Subjects',
      facultyName: subObj?.faculty_name || (req.user!.role === 'faculty' ? req.user!.name : 'All Assigned Faculty'),
      dateRangeLabel:
        date_from || date_to ? `${date_from || 'Start'} to ${date_to || 'Today'}` : 'Current Academic Term',
      shortageThreshold,
    },
  };
}

apiRouter.get('/reports/preview', requireAuth, (req: AuthenticatedRequest, res) => {
  const data = queryReportData(req);
  res.json(data);
});

apiRouter.get('/reports/csv', requireAuth, (req: AuthenticatedRequest, res) => {
  const { rows } = queryReportData(req);
  const buffer = generateCsvBuffer(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pyattendance_report.csv"');
  res.send(buffer);
});

apiRouter.get('/reports/excel', requireAuth, (req: AuthenticatedRequest, res) => {
  const { rows, meta } = queryReportData(req);
  const buffer = generateExcelBuffer(rows, meta);
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="pyattendance_report.xlsx"');
  res.send(buffer);
});

apiRouter.get('/reports/pdf', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { rows, meta } = queryReportData(req);
    const buffer = await generatePdfBuffer(rows, meta);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="pyattendance_report.pdf"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate PDF report.', details: String(err) });
  }
});

// ============================================================
// 10. PYTHON/FLASK REPOSITORY VIEWER (PyAttendance-AI/)
// ============================================================
apiRouter.get('/python-project/files', requireAuth, (_req, res) => {
  const baseDir = path.resolve(process.cwd(), 'PyAttendance-AI');
  if (!fs.existsSync(baseDir)) {
    res.json({ files: [] });
    return;
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(baseDir, full).replaceAll('\\', '/'));
    }
  };
  walk(baseDir);
  files.sort();
  res.json({ files });
});

apiRouter.get('/python-project/file', requireAuth, (req, res) => {
  const rel = String(req.query.path || '');
  const baseDir = path.resolve(process.cwd(), 'PyAttendance-AI');
  const resolved = path.resolve(baseDir, rel);
  if (!resolved.startsWith(baseDir) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.status(404).json({ error: 'File not found in PyAttendance-AI project.' });
    return;
  }
  res.json({ path: rel, content: fs.readFileSync(resolved, 'utf8') });
});
