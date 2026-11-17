from flask import Blueprint, jsonify
from flask_login import login_required
from sqlalchemy import case, func
from backend.extensions import db
from backend.models.models import Attendance, AttendanceSession, Course, Department, Faculty, Student, Subject

analytics_bp = Blueprint("analytics", __name__, url_prefix="/api/analytics")


@analytics_bp.get("/overview")
@login_required
def overview():
    return jsonify({
        "total_students": Student.query.filter_by(is_active=True).count(),
        "total_faculty": Faculty.query.filter_by(is_active=True).count(),
        "total_departments": Department.query.count(),
        "total_courses": Course.query.count(),
        "total_subjects": Subject.query.count(),
        "active_sessions": AttendanceSession.query.filter_by(session_status="active").count(),
    })


@analytics_bp.get("/monthly")
@login_required
def monthly():
    rows = (
        db.session.query(
            AttendanceSession.session_date,
            func.count(Attendance.attendance_id).label("total"),
            func.sum(case((Attendance.status.in_(["Present", "Late", "Excused"]), 1), else_=0)).label("attended"),
        )
        .join(Attendance, Attendance.session_id == AttendanceSession.session_id)
        .group_by(AttendanceSession.session_date)
        .order_by(AttendanceSession.session_date)
        .all()
    )
    return jsonify({
        "series": [
            {
                "date": r.session_date.isoformat(),
                "total": int(r.total or 0),
                "attended": int(r.attended or 0),
            }
            for r in rows
        ]
    })


@analytics_bp.get("/department")
@login_required
def department():
    rows = (
        db.session.query(
            Department.code,
            Department.name,
            func.count(Attendance.attendance_id).label("total"),
            func.sum(case((Attendance.status.in_(["Present", "Late", "Excused"]), 1), else_=0)).label("attended"),
        )
        .outerjoin(Student, Student.department_id == Department.department_id)
        .outerjoin(Attendance, Attendance.student_id == Student.student_id)
        .group_by(Department.department_id)
        .all()
    )
    return jsonify({
        "departments": [
            {
                "code": r.code,
                "name": r.name,
                "total": int(r.total or 0),
                "attended": int(r.attended or 0),
            }
            for r in rows
        ]
    })
