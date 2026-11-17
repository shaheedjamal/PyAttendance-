import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath =
  process.env.DATABASE_PATH ||
  path.resolve(process.cwd(), 'data', 'pyattendance.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_id INTEGER PRIMARY KEY CHECK (setting_id = 1),
      institution_name TEXT NOT NULL DEFAULT 'Apex Institute of Technology',
      institution_code TEXT NOT NULL DEFAULT 'AIT-2026',
      academic_year TEXT NOT NULL DEFAULT '2026-27',
      current_semester INTEGER NOT NULL DEFAULT 5,
      shortage_threshold REAL NOT NULL DEFAULT 75.0,
      recognition_threshold REAL NOT NULL DEFAULT 0.62,
      uncertain_threshold REAL NOT NULL DEFAULT 0.48,
      detector_backend TEXT NOT NULL DEFAULT 'ssd_mobilenetv1',
      late_counts_as_attended INTEGER NOT NULL DEFAULT 1,
      retention_days INTEGER NOT NULL DEFAULT 365,
      dpdp_notice TEXT NOT NULL DEFAULT 'Biometric templates are encrypted with AES-256-GCM and processed only with explicit student authorization under institutional retention policies and the Digital Personal Data Protection Act, 2023. Non-biometric manual attendance is always available.',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admins (
      admin_id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS departments (
      department_id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      head_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS courses (
      course_id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      department_id INTEGER NOT NULL,
      total_semesters INTEGER NOT NULL DEFAULT 8,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS faculty (
      faculty_id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      department_id INTEGER NOT NULL,
      designation TEXT NOT NULL DEFAULT 'Assistant Professor',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS subjects (
      subject_id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      subject_name TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      semester INTEGER NOT NULL DEFAULT 5,
      faculty_id INTEGER,
      credits INTEGER NOT NULL DEFAULT 4,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE RESTRICT,
      FOREIGN KEY (faculty_id) REFERENCES faculty(faculty_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      student_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_code TEXT NOT NULL UNIQUE,
      roll_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      department_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      semester INTEGER NOT NULL DEFAULT 5,
      section TEXT NOT NULL DEFAULT 'A',
      academic_year TEXT NOT NULL DEFAULT '2026-27',
      enrollment_date TEXT NOT NULL DEFAULT (date('now')),
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      biometric_consent INTEGER NOT NULL DEFAULT 0,
      consent_timestamp TEXT,
      non_biometric_opt_out INTEGER NOT NULL DEFAULT 0,
      sample_image_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE RESTRICT,
      FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS enrollments (
      enrollment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (student_id, subject_id),
      FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS face_templates (
      template_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL UNIQUE,
      encrypted_embedding TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      model_name TEXT NOT NULL DEFAULT 'face_recognition_resnet34_128d',
      quality_score REAL NOT NULL DEFAULT 0.0,
      sample_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attendance_sessions (
      session_id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      faculty_id INTEGER NOT NULL,
      section TEXT NOT NULL DEFAULT 'A',
      session_date TEXT NOT NULL DEFAULT (date('now')),
      start_time TEXT NOT NULL DEFAULT (datetime('now')),
      end_time TEXT,
      session_status TEXT NOT NULL DEFAULT 'active' CHECK (session_status IN ('active', 'closed', 'cancelled')),
      detector_used TEXT NOT NULL DEFAULT 'ssd_mobilenetv1',
      threshold_used REAL NOT NULL DEFAULT 0.62,
      faces_detected_count INTEGER NOT NULL DEFAULT 0,
      proposals_count INTEGER NOT NULL DEFAULT 0,
      unknown_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (subject_id) REFERENCES subjects(subject_id) ON DELETE RESTRICT,
      FOREIGN KEY (faculty_id) REFERENCES faculty(faculty_id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS attendance (
      attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Present', 'Absent', 'Late', 'Excused')),
      confidence_score REAL,
      verification_method TEXT NOT NULL CHECK (
        verification_method IN (
          'AI_Proposal_Pending',
          'AI_Face_Approved',
          'Manual_Faculty',
          'Corrected_Faculty'
        )
      ),
      reviewed_by TEXT,
      notes TEXT DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (student_id, session_id),
      FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES attendance_sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recognition_logs (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      matched_student_id INTEGER,
      cosine_similarity REAL NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('matched', 'uncertain', 'unknown', 'duplicate_skipped', 'rejected_unenrolled')),
      detector_name TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES attendance_sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY (matched_student_id) REFERENCES students(student_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_role TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT DEFAULT '',
      details TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_students_dept_course ON students(department_id, course_id, semester);
    CREATE INDEX IF NOT EXISTS idx_enrollments_subject ON enrollments(subject_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_subject_date ON attendance_sessions(subject_id, session_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
  `);
}

export function writeAuditLog(params: {
  userRole: string;
  userId: number;
  userEmail: string;
  action: string;
  resourceType: string;
  resourceId?: string | number;
  details?: string;
  ipAddress?: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (user_role, user_id, user_email, action, resource_type, resource_id, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.userRole,
    params.userId,
    params.userEmail,
    params.action,
    params.resourceType,
    String(params.resourceId ?? ''),
    params.details ?? '',
    params.ipAddress ?? ''
  );
}
