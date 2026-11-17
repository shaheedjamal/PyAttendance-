from flask import Blueprint, redirect, render_template, url_for
from flask_login import current_user, login_required

views_bp = Blueprint("views", __name__)


@views_bp.get("/")
def index():
    if not current_user.is_authenticated:
        return redirect(url_for("views.login_page"))
    if current_user.role == "admin":
        return render_template("admin_dashboard.html")
    if current_user.role == "faculty":
        return render_template("faculty_dashboard.html")
    return render_template("student_dashboard.html")


@views_bp.get("/login")
def login_page():
    return render_template("login.html")


@views_bp.get("/students")
@login_required
def students_page():
    return render_template("students.html")


@views_bp.get("/faculty")
@login_required
def faculty_page():
    return render_template("faculty.html")


@views_bp.get("/face-enrollment")
@login_required
def face_enrollment_page():
    return render_template("face_enrollment.html")


@views_bp.get("/attendance/camera")
@login_required
def attendance_camera_page():
    return render_template("attendance_camera.html")


@views_bp.get("/attendance/records")
@login_required
def attendance_records_page():
    return render_template("attendance_records.html")


@views_bp.get("/reports")
@login_required
def reports_page():
    return render_template("reports.html")


@views_bp.get("/settings")
@login_required
def settings_page():
    return render_template("settings.html")
