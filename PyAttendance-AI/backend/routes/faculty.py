from flask import Blueprint, jsonify, request
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash
from backend.extensions import db
from backend.models.models import Faculty
from backend.utils.security import role_required, write_audit_log

faculty_bp = Blueprint("faculty", __name__, url_prefix="/api/faculty")


@faculty_bp.get("")
@role_required("admin", "faculty")
def list_faculty():
    rows = Faculty.query.order_by(Faculty.employee_code).all()
    return jsonify({
        "faculty": [
            {
                "faculty_id": f.faculty_id,
                "employee_code": f.employee_code,
                "name": f.name,
                "email": f.email,
                "department_id": f.department_id,
                "designation": f.designation,
                "is_active": f.is_active,
            }
            for f in rows
        ]
    })


@faculty_bp.post("")
@role_required("admin")
def create_faculty():
    data = request.get_json(silent=True) or {}
    for field in ("employee_code", "name", "email", "department_id"):
        if not data.get(field):
            return jsonify({"error": f"{field} is required."}), 400
    fac = Faculty(
        employee_code=str(data["employee_code"]).strip().upper(),
        name=str(data["name"]).strip(),
        email=str(data["email"]).strip().lower(),
        department_id=int(data["department_id"]),
        designation=str(data.get("designation", "Assistant Professor")),
        password_hash=generate_password_hash(str(data.get("password", "Faculty@123"))),
    )
    db.session.add(fac)
    try:
        db.session.flush()
        write_audit_log("CREATE_FACULTY", "faculty", fac.faculty_id)
        db.session.commit()
        return jsonify({"faculty_id": fac.faculty_id}), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Duplicate employee_code or email."}), 409


@faculty_bp.put("/<int:faculty_id>")
@role_required("admin")
def update_faculty(faculty_id: int):
    fac = db.session.get(Faculty, faculty_id)
    if not fac:
        return jsonify({"error": "Faculty not found."}), 404
    data = request.get_json(silent=True) or {}
    for attr in ("name", "designation"):
        if attr in data:
            setattr(fac, attr, data[attr])
    if "is_active" in data:
        fac.is_active = bool(data["is_active"])
    write_audit_log("UPDATE_FACULTY", "faculty", fac.faculty_id)
    db.session.commit()
    return jsonify({"ok": True})
