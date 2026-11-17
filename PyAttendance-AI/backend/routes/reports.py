from flask import Blueprint, Response, request
from flask_login import current_user, login_required
from sqlalchemy import case, func
from backend.extensions import db
from backend.models.models import AppSettings, Attendance, AttendanceSession, Student, Subject
from backend.services.report_service import ReportService

reports_bp = Blueprint("reports", __name__, url_prefix="/api/reports")


def _build_report_rows():
    settings = AppSettings.query.first()
    threshold = settings.shortage_threshold if settings else 75.0
    query = (
        db.session.query(
            Student.roll_number,
            Student.name.label("student_name"),
            Subject.code.label("subject_code"),
            Subject.subject_name,
            func.count(Attendance.attendance_id).label("total_sessions"),
            func.sum(case((Attendance.status == "Present", 1), else_=0)).label("present_count"),
            func.sum(case((Attendance.status == "Late", 1), else_=0)).label("late_count"),
            func.sum(case((Attendance.status == "Excused", 1), else_=0)).label("excused_count"),
            func.sum(case((Attendance.status == "Absent", 1), else_=0)).label("absent_count"),
        )
        .join(Attendance, Attendance.student_id == Student.student_id)
        .join(AttendanceSession, AttendanceSession.session_id == Attendance.session_id)
        .join(Subject, Subject.subject_id == AttendanceSession.subject_id)
    )
    if current_user.role == "student":
        query = query.filter(Student.student_id == int(current_user.get_id().split(":")[1]))
    if subject_id := request.args.get("subject_id", type=int):
        query = query.filter(Subject.subject_id == subject_id)

    grouped = query.group_by(Student.student_id, Subject.subject_id).all()
    rows = []
    for g in grouped:
        total = int(g.total_sessions or 0)
        attended = int((g.present_count or 0) + (g.late_count or 0) + (g.excused_count or 0))
        pct = (attended / total * 100.0) if total > 0 else 0.0
        rows.append({
            "roll_number": g.roll_number,
            "student_name": g.student_name,
            "subject": f"{g.subject_code} - {g.subject_name}",
            "total_sessions": total,
            "present_count": int(g.present_count or 0),
            "late_count": int(g.late_count or 0),
            "excused_count": int(g.excused_count or 0),
            "absent_count": int(g.absent_count or 0),
            "percentage": pct,
            "shortage": total > 0 and pct < threshold,
        })
    meta = {
        "institution_name": settings.institution_name if settings else "Apex Institute of Technology",
        "academic_year": settings.academic_year if settings else "2026-27",
    }
    return rows, meta


@reports_bp.get("/csv")
@login_required
def export_csv():
    rows, _ = _build_report_rows()
    data = ReportService.generate_csv(rows)
    return Response(
        data,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=pyattendance_report.csv"},
    )


@reports_bp.get("/excel")
@login_required
def export_excel():
    rows, meta = _build_report_rows()
    data = ReportService.generate_excel(rows, meta)
    return Response(
        data,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=pyattendance_report.xlsx"},
    )


@reports_bp.get("/pdf")
@login_required
def export_pdf():
    rows, meta = _build_report_rows()
    data = ReportService.generate_pdf(rows, meta)
    return Response(
        data,
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=pyattendance_report.pdf"},
    )
