from datetime import datetime
from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from backend.extensions import db
from backend.models.models import Attendance, AttendanceSession, Enrollment, Subject
from backend.utils.security import role_required, write_audit_log

sessions_bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")


@sessions_bp.get("")
@login_required
def list_sessions():
    query = AttendanceSession.query
    if current_user.role == "faculty":
        fid = int(current_user.get_id().split(":")[1])
        query = query.filter_by(faculty_id=fid)
    rows = query.order_by(AttendanceSession.session_id.desc()).limit(100).all()
    return jsonify({
        "sessions": [
            {
                "session_id": s.session_id,
                "subject_id": s.subject_id,
                "subject_code": s.subject.code if s.subject else "",
                "faculty_id": s.faculty_id,
                "section": s.section,
                "session_date": s.session_date.isoformat(),
                "session_status": s.session_status,
            }
            for s in rows
        ]
    })


@sessions_bp.post("")
@sessions_bp.post("/start")
@role_required("admin", "faculty")
def start_session():
    data = request.get_json(silent=True) or {}
    subject_id = data.get("subject_id")
    if not subject_id:
        return jsonify({"error": "subject_id is required."}), 400
    sub = db.session.get(Subject, int(subject_id))
    if not sub:
        return jsonify({"error": "Subject not found."}), 404

    faculty_id = (
        int(current_user.get_id().split(":")[1])
        if current_user.role == "faculty"
        else int(data.get("faculty_id") or sub.faculty_id)
    )
    sess = AttendanceSession(
        subject_id=sub.subject_id,
        faculty_id=faculty_id,
        section=str(data.get("section", "A")).upper(),
        session_status="active",
    )
    db.session.add(sess)
    db.session.flush()
    write_audit_log("START_SESSION", "attendance_session", sess.session_id)
    db.session.commit()
    return jsonify({"session": {"session_id": sess.session_id, "session_status": sess.session_status}}), 201


@sessions_bp.post("/<int:session_id>/close")
@role_required("admin", "faculty")
def close_session(session_id: int):
    sess = db.session.get(AttendanceSession, session_id)
    if not sess:
        return jsonify({"error": "Session not found."}), 404
    enrolled = Enrollment.query.filter_by(subject_id=sess.subject_id).all()
    existing = {a.student_id for a in Attendance.query.filter_by(session_id=session_id).all()}
    for enr in enrolled:
        if enr.student_id not in existing:
            db.session.add(
                Attendance(
                    student_id=enr.student_id,
                    session_id=session_id,
                    status="Absent",
                    verification_method="Manual_Faculty",
                    reviewed_by=getattr(current_user, "name", "Faculty"),
                )
            )
    sess.session_status = "closed"
    sess.end_time = datetime.utcnow()
    write_audit_log("CLOSE_SESSION", "attendance_session", sess.session_id)
    db.session.commit()
    return jsonify({"ok": True})
