"""Database seed script for PyAttendance AI development data."""
from datetime import date, datetime, timedelta
from werkzeug.security import generate_password_hash
from backend import create_app
from backend.extensions import db
from backend.models.models import (
    Admin,
    AppSettings,
    Attendance,
    AttendanceSession,
    AuditLog,
    Course,
    Department,
    Enrollment,
    Faculty,
    Student,
    Subject,
)


def seed_database():
    if Admin.query.first() is not None:
        print("Database already seeded. Skipping.")
        return

    settings = AppSettings(
        institution_name="Apex Institute of Technology",
        academic_year="2026-27",
        shortage_threshold=75.0,
        recognition_threshold=0.62,
        uncertain_threshold=0.48,
        detector_backend="haar",
    )
    db.session.add(settings)

    admin = Admin(
        username="sysadmin",
        full_name="Dr. Rajeshwari Menon",
        email="admin@pyattendance.edu",
        password_hash=generate_password_hash("Admin@123"),
    )
    db.session.add(admin)

    cse = Department(code="CSE", name="Computer Science & Engineering", head_name="Dr. Arvind Rao")
    ece = Department(code="ECE", name="Electronics & Communication Engineering", head_name="Dr. Meenakshi Iyer")
    db.session.add_all([cse, ece])
    db.session.flush()

    btech_cse = Course(code="BTECH-CSE", name="B.Tech Computer Science", department_id=cse.department_id, total_semesters=8)
    btech_ece = Course(code="BTECH-ECE", name="B.Tech Electronics", department_id=ece.department_id, total_semesters=8)
    db.session.add_all([btech_cse, btech_ece])
    db.session.flush()

    fac1 = Faculty(
        employee_code="FAC-101",
        name="Prof. Ananya Sharma",
        email="ananya.sharma@pyattendance.edu",
        password_hash=generate_password_hash("Faculty@123"),
        department_id=cse.department_id,
        designation="Associate Professor",
    )
    fac2 = Faculty(
        employee_code="FAC-102",
        name="Dr. Vikram Patel",
        email="vikram.patel@pyattendance.edu",
        password_hash=generate_password_hash("Faculty@123"),
        department_id=ece.department_id,
        designation="Professor",
    )
    db.session.add_all([fac1, fac2])
    db.session.flush()

    sub1 = Subject(code="CS501", subject_name="Machine Learning", course_id=btech_cse.course_id, semester=5, faculty_id=fac1.faculty_id)
    sub2 = Subject(code="CS502", subject_name="Computer Vision & AI", course_id=btech_cse.course_id, semester=5, faculty_id=fac1.faculty_id)
    sub3 = Subject(code="CS503", subject_name="Database Management Systems", course_id=btech_cse.course_id, semester=5, faculty_id=fac1.faculty_id)
    sub4 = Subject(code="EC501", subject_name="Embedded Systems & DSP", course_id=btech_ece.course_id, semester=5, faculty_id=fac2.faculty_id)
    db.session.add_all([sub1, sub2, sub3, sub4])
    db.session.flush()

    cse_names = [
        ("CS2024001", "Aarav Verma", "aarav.verma@pyattendance.edu"),
        ("CS2024002", "Priya Nair", "priya.nair@pyattendance.edu"),
        ("CS2024003", "Rohan Kulkarni", "rohan.kulkarni@pyattendance.edu"),
        ("CS2024004", "Sneha Reddy", "sneha.reddy@pyattendance.edu"),
        ("CS2024005", "Karthik Subramanian", "karthik.s@pyattendance.edu"),
        ("CS2024006", "Divya Krishnan", "divya.krishnan@pyattendance.edu"),
        ("CS2024007", "Siddharth Joshi", "siddharth.joshi@pyattendance.edu"),
    ]
    ece_names = [
        ("EC2024001", "Meera Deshmukh", "meera.deshmukh@pyattendance.edu"),
        ("EC2024002", "Aditya Malhotra", "aditya.malhotra@pyattendance.edu"),
        ("EC2024003", "Nandini Bose", "nandini.bose@pyattendance.edu"),
    ]

    stu_pw = generate_password_hash("Student@123")
    cse_students = []
    for idx, (roll, name, email) in enumerate(cse_names, start=1):
        st = Student(
            student_code=f"STU2026{idx:03d}",
            roll_number=roll,
            name=name,
            email=email,
            phone=f"+91-98401-110{idx:02d}",
            department_id=cse.department_id,
            course_id=btech_cse.course_id,
            semester=5,
            section="A",
            academic_year="2026-27",
            enrollment_date=date(2024, 8, 1),
            password_hash=stu_pw,
            non_biometric_opt_out=(roll == "CS2024007"),
        )
        db.session.add(st)
        cse_students.append(st)

    ece_students = []
    for idx, (roll, name, email) in enumerate(ece_names, start=8):
        st = Student(
            student_code=f"STU2026{idx:03d}",
            roll_number=roll,
            name=name,
            email=email,
            phone=f"+91-98401-110{idx:02d}",
            department_id=ece.department_id,
            course_id=btech_ece.course_id,
            semester=5,
            section="A",
            academic_year="2026-27",
            enrollment_date=date(2024, 8, 1),
            password_hash=stu_pw,
        )
        db.session.add(st)
        ece_students.append(st)

    db.session.flush()

    for st in cse_students:
        for sub in [sub1, sub2, sub3]:
            db.session.add(Enrollment(student_id=st.student_id, subject_id=sub.subject_id))
    for st in ece_students:
        db.session.add(Enrollment(student_id=st.student_id, subject_id=sub4.subject_id))

    # Baseline session
    session = AttendanceSession(
        subject_id=sub1.subject_id,
        faculty_id=fac1.faculty_id,
        section="A",
        session_date=date.today() - timedelta(days=1),
        start_time=datetime.utcnow() - timedelta(days=1),
        end_time=datetime.utcnow() - timedelta(days=1) + timedelta(minutes=55),
        session_status="closed",
    )
    db.session.add(session)
    db.session.flush()

    for idx, st in enumerate(cse_students):
        status = "Absent" if idx == 4 else "Present"
        db.session.add(
            Attendance(
                student_id=st.student_id,
                session_id=session.session_id,
                status=status,
                verification_method="Manual_Faculty",
                reviewed_by=fac1.name,
            )
        )

    db.session.add(
        AuditLog(
            user_role="admin",
            user_id=admin.admin_id,
            user_email=admin.email,
            action="SYSTEM_SEED",
            resource_type="database",
            details="Seeded initial departments, courses, faculty, subjects, and 10 students.",
        )
    )
    db.session.commit()
    print("PyAttendance AI database seeded successfully.")


if __name__ == "__main__":
    app = create_app()
    with app.app_context():
        db.create_all()
        seed_database()
