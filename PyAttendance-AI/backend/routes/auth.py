from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required, login_user, logout_user
from werkzeug.security import check_password_hash
from backend.extensions import db, limiter
from backend.models.models import Admin, Faculty, Student
from backend.utils.security import write_audit_log

auth_bp = Blueprint("auth", __name__, url_prefix="/api")


@auth_bp.post("/login")
@limiter.limit("30 per minute")
def api_login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    role = data.get("role")

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    user = None
    if role == "admin":
        user = Admin.query.filter((Admin.email == email) | (Admin.username == email)).first()
    elif role == "faculty":
        user = Faculty.query.filter_by(email=email, is_active=True).first()
    elif role == "student":
        user = Student.query.filter(
            ((Student.email == email) | (Student.roll_number == email.upper())) & (Student.is_active.is_(True))
        ).first()
    else:
        user = (
            Admin.query.filter_by(email=email).first()
            or Faculty.query.filter_by(email=email, is_active=True).first()
            or Student.query.filter_by(email=email, is_active=True).first()
        )

    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid credentials."}), 401

    login_user(user, remember=True)
    write_audit_log("LOGIN", "session", details=f"Logged in as {user.role}")
    db.session.commit()
    return jsonify({
        "user": {
            "id": int(user.get_id().split(":")[1]),
            "role": user.role,
            "email": user.email,
            "name": getattr(user, "full_name", getattr(user, "name", "")),
        }
    })


@auth_bp.post("/logout")
@login_required
def api_logout():
    write_audit_log("LOGOUT", "session")
    db.session.commit()
    logout_user()
    return jsonify({"ok": True})


@auth_bp.get("/profile")
@login_required
def api_profile():
    return jsonify({
        "user": {
            "id": int(current_user.get_id().split(":")[1]),
            "role": current_user.role,
            "email": current_user.email,
            "name": getattr(current_user, "full_name", getattr(current_user, "name", "")),
        }
    })
