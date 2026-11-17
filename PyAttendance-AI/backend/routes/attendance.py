import base64
import cv2
import numpy as np
from flask import Blueprint, current_app, jsonify, request
from flask_login import current_user, login_required
from backend.extensions import db
from backend.models.models import AppSettings, Attendance, AttendanceSession, Enrollment, FaceTemplate, Student
from backend.services.attendance_service import AttendanceService
from backend.services.face_detection import FaceDetectionService
from backend.services.face_recognition import FaceRecognitionService
from backend.utils.security import decrypt_embedding, role_required, write_audit_log

attendance_bp = Blueprint("attendance", __name__, url_prefix="/api/attendance")


@attendance_bp.get("")
@login_required
def list_attendance():
    query = Attendance.query
    if current_user.role == "student":
        sid = int(current_user.get_id().split(":")[1])
        query = query.filter_by(student_id=sid)
    if session_id := request.args.get("session_id", type=int):
        query = query.filter_by(session_id=session_id)
    rows = query.order_by(Attendance.attendance_id.desc()).limit(300).all()
    return jsonify({
        "attendance": [
            {
                "attendance_id": a.attendance_id,
                "student_id": a.student_id,
                "session_id": a.session_id,
                "roll_number": a.student.roll_number if a.student else "",
                "student_name": a.student.name if a.student else "",
                "status": a.status,
                "confidence_score": a.confidence_score,
                "verification_method": a.verification_method,
                "reviewed_by": a.reviewed_by,
                "timestamp": a.timestamp.isoformat(),
            }
            for a in rows
        ]
    })


@attendance_bp.post("/manual")
@role_required("admin", "faculty")
def manual_attendance():
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id")
    student_id = data.get("student_id")
    status = data.get("status")
    if not session_id or not student_id or status not in ("Present", "Absent", "Late", "Excused"):
        return jsonify({"error": "Valid session_id, student_id, and status required."}), 400

    record, err = AttendanceService.record_attendance(
        student_id=int(student_id),
        session_id=int(session_id),
        status=status,
        verification_method="Manual_Faculty",
        reviewed_by=getattr(current_user, "name", "Faculty"),
        notes=str(data.get("notes", "")),
    )
    if err:
        return jsonify({"error": err}), 409 if "Duplicate" in err else 400

    write_audit_log("MANUAL_ATTENDANCE", "attendance", record.attendance_id)
    db.session.commit()
    return jsonify({"attendance_id": record.attendance_id}), 201


@attendance_bp.post("/recognize")
@role_required("admin", "faculty")
def recognize_attendance():
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id")
    sess = db.session.get(AttendanceSession, int(session_id)) if session_id else None
    if not sess or sess.session_status != "active":
        return jsonify({"error": "Active attendance session required."}), 400

    settings = AppSettings.query.first()
    rec_thresh = settings.recognition_threshold if settings else current_app.config["RECOGNITION_COSINE_THRESHOLD"]
    unc_thresh = settings.uncertain_threshold if settings else current_app.config["UNCERTAIN_LOWER_THRESHOLD"]

    # Extract embeddings either from provided vectors or uploaded frame image
    embeddings: list[list[float]] = []
    if isinstance(data.get("embeddings"), list):
        embeddings = data["embeddings"]
    elif data.get("image_base64"):
        raw = base64.b64decode(data["image_base64"].split(",")[-1])
        img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        faces = FaceDetectionService(current_app.config.get("FACE_DETECTOR_BACKEND", "haar")).detect_faces(img)
        recognizer = FaceRecognitionService()
        embeddings = [recognizer.extract_embedding(f.aligned_rgb) for f in faces]

    enrolled_templates = (
        db.session.query(Student.student_id, Student.roll_number, Student.name, FaceTemplate.encrypted_embedding)
        .join(Enrollment, Enrollment.student_id == Student.student_id)
        .join(FaceTemplate, FaceTemplate.student_id == Student.student_id)
        .filter(
            Enrollment.subject_id == sess.subject_id,
            Student.is_active.is_(True),
            Student.biometric_consent.is_(True),
            Student.non_biometric_opt_out.is_(False),
        )
        .all()
    )
    templates = [
        (sid, roll, name, decrypt_embedding(enc))
        for sid, roll, name, enc in enrolled_templates
    ]

    results = []
    for emb in embeddings:
        match = FaceRecognitionService.match_against_templates(emb, templates, rec_thresh, unc_thresh)
        if match["decision"] == "matched":
            rec, err = AttendanceService.record_attendance(
                student_id=match["student_id"],
                session_id=sess.session_id,
                status="Present",
                verification_method="AI_Proposal_Pending",
                confidence_score=match["cosine_similarity"],
                notes="AI proposal awaiting faculty confirmation",
            )
            match["attendance_id"] = rec.attendance_id if rec else None
            if err:
                match["decision"] = "duplicate"
        results.append(match)

    return jsonify({"results": results, "threshold_used": rec_thresh})


@attendance_bp.put("/<int:attendance_id>")
@role_required("admin", "faculty")
def correct_attendance(attendance_id: int):
    rec = db.session.get(Attendance, attendance_id)
    if not rec:
        return jsonify({"error": "Attendance record not found."}), 404
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    if status not in ("Present", "Absent", "Late", "Excused"):
        return jsonify({"error": "Invalid attendance status."}), 400
    rec.status = status
    rec.verification_method = "Corrected_Faculty"
    rec.reviewed_by = getattr(current_user, "name", "Faculty")
    rec.notes = str(data.get("notes", rec.notes))
    write_audit_log("CORRECT_ATTENDANCE", "attendance", rec.attendance_id, f"Status -> {status}")
    db.session.commit()
    return jsonify({"ok": True})
