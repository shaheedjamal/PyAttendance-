import base64
from datetime import datetime
import cv2
import numpy as np
from flask import Blueprint, current_app, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash
from backend.extensions import db
from backend.models.models import Enrollment, FaceTemplate, Student
from backend.services.face_detection import FaceDetectionService
from backend.services.face_recognition import FaceRecognitionService
from backend.utils.security import encrypt_embedding, role_required, write_audit_log

students_bp = Blueprint("students", __name__, url_prefix="/api/students")


@students_bp.get("")
@role_required("admin", "faculty")
def list_students():
    query = Student.query
    if dept_id := request.args.get("department_id", type=int):
        query = query.filter_by(department_id=dept_id)
    if course_id := request.args.get("course_id", type=int):
        query = query.filter_by(course_id=course_id)
    if semester := request.args.get("semester", type=int):
        query = query.filter_by(semester=semester)
    students = query.order_by(Student.roll_number).all()
    return jsonify({
        "students": [
            {
                "student_id": s.student_id,
                "student_code": s.student_code,
                "roll_number": s.roll_number,
                "name": s.name,
                "email": s.email,
                "department_id": s.department_id,
                "course_id": s.course_id,
                "semester": s.semester,
                "section": s.section,
                "biometric_consent": s.biometric_consent,
                "face_enrolled": s.face_template is not None,
            }
            for s in students
        ]
    })


@students_bp.post("")
@role_required("admin")
def create_student():
    data = request.get_json(silent=True) or {}
    for field in ("student_code", "roll_number", "name", "email", "department_id", "course_id"):
        if not data.get(field):
            return jsonify({"error": f"{field} is required."}), 400

    st = Student(
        student_code=str(data["student_code"]).strip().upper(),
        roll_number=str(data["roll_number"]).strip().upper(),
        name=str(data["name"]).strip(),
        email=str(data["email"]).strip().lower(),
        phone=str(data.get("phone", "")),
        department_id=int(data["department_id"]),
        course_id=int(data["course_id"]),
        semester=int(data.get("semester", 5)),
        section=str(data.get("section", "A")).upper(),
        password_hash=generate_password_hash(str(data.get("password", "Student@123"))),
    )
    db.session.add(st)
    try:
        db.session.flush()
        for sub_id in data.get("subject_ids", []):
            db.session.add(Enrollment(student_id=st.student_id, subject_id=int(sub_id)))
        write_audit_log("CREATE_STUDENT", "student", st.student_id, st.roll_number)
        db.session.commit()
        return jsonify({"student_id": st.student_id}), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Duplicate student_code, roll_number, or email."}), 409


@students_bp.get("/<int:student_id>")
@login_required
def get_student(student_id: int):
    if current_user.role == "student" and int(current_user.get_id().split(":")[1]) != student_id:
        return jsonify({"error": "Forbidden."}), 403
    st = db.session.get(Student, student_id)
    if not st:
        return jsonify({"error": "Student not found."}), 404
    return jsonify({
        "student_id": st.student_id,
        "student_code": st.student_code,
        "roll_number": st.roll_number,
        "name": st.name,
        "email": st.email,
        "semester": st.semester,
        "section": st.section,
        "biometric_consent": st.biometric_consent,
        "face_enrolled": st.face_template is not None,
    })


@students_bp.put("/<int:student_id>")
@role_required("admin")
def update_student(student_id: int):
    st = db.session.get(Student, student_id)
    if not st:
        return jsonify({"error": "Student not found."}), 404
    data = request.get_json(silent=True) or {}
    for attr in ("name", "phone", "section"):
        if attr in data:
            setattr(st, attr, data[attr])
    if "semester" in data:
        st.semester = int(data["semester"])
    if "is_active" in data:
        st.is_active = bool(data["is_active"])
    write_audit_log("UPDATE_STUDENT", "student", st.student_id)
    db.session.commit()
    return jsonify({"ok": True})


@students_bp.delete("/<int:student_id>")
@role_required("admin")
def delete_student(student_id: int):
    st = db.session.get(Student, student_id)
    if not st:
        return jsonify({"error": "Student not found."}), 404
    st.is_active = False
    write_audit_log("DEACTIVATE_STUDENT", "student", st.student_id)
    db.session.commit()
    return jsonify({"ok": True})


@students_bp.post("/enroll")
@role_required("admin", "faculty")
def enroll_face():
    data = request.get_json(silent=True) or {}
    student_id = data.get("student_id")
    consent = data.get("consent_confirmed")
    if not student_id or not consent:
        return jsonify({"error": "student_id and explicit consent_confirmed are required."}), 400

    st = db.session.get(Student, int(student_id))
    if not st:
        return jsonify({"error": "Student not found."}), 404

    embedding = data.get("embedding")
    quality_score = float(data.get("quality_score", 0.9))

    # Optional server-side OpenCV + FaceNet extraction when base64 image is sent
    if embedding is None and data.get("image_base64"):
        raw = base64.b64decode(data["image_base64"].split(",")[-1])
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        detector = FaceDetectionService(current_app.config.get("FACE_DETECTOR_BACKEND", "haar"))
        faces = detector.detect_faces(img)
        if len(faces) != 1:
            return jsonify({"error": f"Expected 1 face for enrollment, detected {len(faces)}."}), 400
        quality_score = faces[0].quality_score
        embedding = FaceRecognitionService().extract_embedding(faces[0].aligned_rgb)

    if not isinstance(embedding, list) or len(embedding) < 64:
        return jsonify({"error": "Valid facial embedding or image_base64 is required."}), 400

    token = encrypt_embedding(embedding)
    st.biometric_consent = True
    st.consent_timestamp = datetime.utcnow()
    st.non_biometric_opt_out = False

    if st.face_template:
        st.face_template.encrypted_embedding = token
        st.face_template.quality_score = quality_score
    else:
        db.session.add(FaceTemplate(student_id=st.student_id, encrypted_embedding=token, quality_score=quality_score))

    write_audit_log("ENROLL_FACE_TEMPLATE", "face_template", st.student_id)
    db.session.commit()
    return jsonify({"ok": True, "quality_score": quality_score}), 201


@students_bp.delete("/<int:student_id>/biometrics")
@login_required
def withdraw_biometrics(student_id: int):
    if current_user.role == "student" and int(current_user.get_id().split(":")[1]) != student_id:
        return jsonify({"error": "Forbidden."}), 403
    st = db.session.get(Student, student_id)
    if not st:
        return jsonify({"error": "Student not found."}), 404
    if st.face_template:
        db.session.delete(st.face_template)
    st.biometric_consent = False
    st.consent_timestamp = None
    st.non_biometric_opt_out = True
    write_audit_log("WITHDRAW_BIOMETRIC_CONSENT", "face_template", st.student_id)
    db.session.commit()
    return jsonify({"ok": True})
