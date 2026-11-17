from datetime import date, datetime
from flask_login import UserMixin
from sqlalchemy import UniqueConstraint
from backend.extensions import db


class AppSettings(db.Model):
    __tablename__ = "app_settings"
    setting_id = db.Column(db.Integer, primary_key=True)
    institution_name = db.Column(db.String(160), nullable=False, default="Apex Institute of Technology")
    academic_year = db.Column(db.String(32), nullable=False, default="2026-27")
    shortage_threshold = db.Column(db.Float, nullable=False, default=75.0)
    recognition_threshold = db.Column(db.Float, nullable=False, default=0.62)
    uncertain_threshold = db.Column(db.Float, nullable=False, default=0.48)
    detector_backend = db.Column(db.String(32), nullable=False, default="haar")
    retention_days = db.Column(db.Integer, nullable=False, default=365)


class Admin(UserMixin, db.Model):
    __tablename__ = "admins"
    admin_id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    @property
    def role(self) -> str:
        return "admin"

    def get_id(self) -> str:
        return f"admin:{self.admin_id}"


class Department(db.Model):
    __tablename__ = "departments"
    department_id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(16), unique=True, nullable=False)
    name = db.Column(db.String(120), unique=True, nullable=False)
    head_name = db.Column(db.String(120), default="")
    courses = db.relationship("Course", backref="department", lazy=True)
    faculty = db.relationship("Faculty", backref="department", lazy=True)
    students = db.relationship("Student", backref="department", lazy=True)


class Course(db.Model):
    __tablename__ = "courses"
    course_id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(24), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    department_id = db.Column(db.Integer, db.ForeignKey("departments.department_id"), nullable=False, index=True)
    total_semesters = db.Column(db.Integer, default=8, nullable=False)
    subjects = db.relationship("Subject", backref="course", lazy=True)


class Faculty(UserMixin, db.Model):
    __tablename__ = "faculty"
    faculty_id = db.Column(db.Integer, primary_key=True)
    employee_code = db.Column(db.String(32), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    department_id = db.Column(db.Integer, db.ForeignKey("departments.department_id"), nullable=False, index=True)
    designation = db.Column(db.String(80), default="Assistant Professor")
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    subjects = db.relationship("Subject", backref="faculty", lazy=True)

    @property
    def role(self) -> str:
        return "faculty"

    def get_id(self) -> str:
        return f"faculty:{self.faculty_id}"


class Subject(db.Model):
    __tablename__ = "subjects"
    subject_id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(24), unique=True, nullable=False)
    subject_name = db.Column(db.String(140), nullable=False)
    course_id = db.Column(db.Integer, db.ForeignKey("courses.course_id"), nullable=False, index=True)
    semester = db.Column(db.Integer, default=5, nullable=False)
    faculty_id = db.Column(db.Integer, db.ForeignKey("faculty.faculty_id"), nullable=True, index=True)


class Student(UserMixin, db.Model):
    __tablename__ = "students"
    student_id = db.Column(db.Integer, primary_key=True)
    student_code = db.Column(db.String(32), unique=True, nullable=False)
    roll_number = db.Column(db.String(32), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    phone = db.Column(db.String(32), default="")
    department_id = db.Column(db.Integer, db.ForeignKey("departments.department_id"), nullable=False, index=True)
    course_id = db.Column(db.Integer, db.ForeignKey("courses.course_id"), nullable=False, index=True)
    semester = db.Column(db.Integer, default=5, nullable=False)
    section = db.Column(db.String(8), default="A", nullable=False)
    academic_year = db.Column(db.String(32), default="2026-27", nullable=False)
    enrollment_date = db.Column(db.Date, default=date.today, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    biometric_consent = db.Column(db.Boolean, default=False, nullable=False)
    consent_timestamp = db.Column(db.DateTime, nullable=True)
    non_biometric_opt_out = db.Column(db.Boolean, default=False, nullable=False)

    face_template = db.relationship("FaceTemplate", backref="student", uselist=False, cascade="all, delete-orphan")
    enrollments = db.relationship("Enrollment", backref="student", cascade="all, delete-orphan")

    @property
    def role(self) -> str:
        return "student"

    def get_id(self) -> str:
        return f"student:{self.student_id}"


class Enrollment(db.Model):
    __tablename__ = "enrollments"
    enrollment_id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("students.student_id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id = db.Column(db.Integer, db.ForeignKey("subjects.subject_id", ondelete="CASCADE"), nullable=False, index=True)
    __table_args__ = (UniqueConstraint("student_id", "subject_id", name="uq_enrollment_student_subject"),)


class FaceTemplate(db.Model):
    __tablename__ = "face_templates"
    template_id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("students.student_id", ondelete="CASCADE"), unique=True, nullable=False)
    encrypted_embedding = db.Column(db.LargeBinary, nullable=False)
    model_name = db.Column(db.String(80), default="facenet_inceptionresnet_v1", nullable=False)
    quality_score = db.Column(db.Float, default=0.0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class AttendanceSession(db.Model):
    __tablename__ = "attendance_sessions"
    session_id = db.Column(db.Integer, primary_key=True)
    subject_id = db.Column(db.Integer, db.ForeignKey("subjects.subject_id"), nullable=False, index=True)
    faculty_id = db.Column(db.Integer, db.ForeignKey("faculty.faculty_id"), nullable=False, index=True)
    section = db.Column(db.String(8), default="A", nullable=False)
    session_date = db.Column(db.Date, default=date.today, nullable=False, index=True)
    start_time = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    end_time = db.Column(db.DateTime, nullable=True)
    session_status = db.Column(db.String(20), default="active", nullable=False)
    subject = db.relationship("Subject", lazy="joined")
    faculty = db.relationship("Faculty", lazy="joined")


class Attendance(db.Model):
    __tablename__ = "attendance"
    attendance_id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("students.student_id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = db.Column(db.Integer, db.ForeignKey("attendance_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False)  # Present, Absent, Late, Excused
    confidence_score = db.Column(db.Float, nullable=True)
    verification_method = db.Column(db.String(40), nullable=False)  # AI_Proposal_Pending, AI_Face_Approved, Manual_Faculty, Corrected_Faculty
    reviewed_by = db.Column(db.String(120), nullable=True)
    notes = db.Column(db.String(255), default="")
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    student = db.relationship("Student", lazy="joined")
    session = db.relationship("AttendanceSession", lazy="joined")

    __table_args__ = (UniqueConstraint("student_id", "session_id", name="uq_attendance_student_session"),)


class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    log_id = db.Column(db.Integer, primary_key=True)
    user_role = db.Column(db.String(24), nullable=False)
    user_id = db.Column(db.Integer, nullable=False)
    user_email = db.Column(db.String(120), nullable=False)
    action = db.Column(db.String(64), nullable=False)
    resource_type = db.Column(db.String(64), nullable=False)
    resource_id = db.Column(db.String(64), default="")
    details = db.Column(db.Text, default="")
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
