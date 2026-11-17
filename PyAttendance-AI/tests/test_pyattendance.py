"""Unit, integration, functional, and security pytest suite for PyAttendance AI."""
import pytest
from config import TestingConfig
from backend import create_app
from backend.extensions import db
from backend.models.models import AttendanceSession, Department, Subject
from backend.services.face_recognition import FaceRecognitionService
from backend.utils.security import decrypt_embedding, encrypt_embedding
from seed import seed_database


@pytest.fixture()
def client():
    app = create_app(TestingConfig)
    with app.app_context():
        db.create_all()
        seed_database()
        yield app.test_client()
        db.session.remove()
        db.drop_all()


def login_as(client, email, password, role):
    return client.post("/api/login", json={"email": email, "password": password, "role": role})


def test_role_based_login_and_permissions(client):
    # Invalid login rejected
    bad = login_as(client, "admin@pyattendance.edu", "WrongPass", "admin")
    assert bad.status_code == 401

    # Student cannot list all students
    stu_login = login_as(client, "aarav.verma@pyattendance.edu", "Student@123", "student")
    assert stu_login.status_code == 200
    assert client.get("/api/students").status_code == 403

    # Admin can list students
    admin_login = login_as(client, "admin@pyattendance.edu", "Admin@123", "admin")
    assert admin_login.status_code == 200
    res = client.get("/api/students")
    assert res.status_code == 200
    assert len(res.get_json()["students"]) == 10


def test_duplicate_student_validation(client):
    login_as(client, "admin@pyattendance.edu", "Admin@123", "admin")
    dept = Department.query.first()
    res = client.post(
        "/api/students",
        json={
            "student_code": "STU2026001",  # duplicate
            "roll_number": "CS2024001",
            "name": "Duplicate Test",
            "email": "aarav.verma@pyattendance.edu",
            "department_id": dept.department_id,
            "course_id": 1,
        },
    )
    assert res.status_code == 409


def test_biometric_encryption_and_recognition_thresholds(client):
    with client.application.app_context():
        vec = [0.1] * 128
        token = encrypt_embedding(vec)
        assert isinstance(token, bytes)
        decoded = decrypt_embedding(token)
        assert pytest.approx(decoded[0], rel=1e-5) == 0.1

        # Cosine matching logic
        templates = [(1, "CS2024001", "Aarav Verma", [1.0, 0.0, 0.0])]
        matched = FaceRecognitionService.match_against_templates([0.99, 0.05, 0.0], templates, 0.62, 0.48)
        assert matched["decision"] == "matched"
        uncertain = FaceRecognitionService.match_against_templates([0.55, 0.83, 0.0], templates, 0.62, 0.48)
        assert uncertain["decision"] == "uncertain"
        unknown = FaceRecognitionService.match_against_templates([0.0, 1.0, 0.0], templates, 0.62, 0.48)
        assert unknown["decision"] == "unknown"


def test_attendance_duplicate_prevention_and_reports(client):
    login_as(client, "ananya.sharma@pyattendance.edu", "Faculty@123", "faculty")
    sub = Subject.query.filter_by(code="CS501").first()
    start_res = client.post("/api/sessions/start", json={"subject_id": sub.subject_id, "section": "A"})
    assert start_res.status_code == 201
    session_id = start_res.get_json()["session"]["session_id"]

    # Manual attendance
    first = client.post("/api/attendance/manual", json={"session_id": session_id, "student_id": 1, "status": "Present"})
    assert first.status_code == 201

    # Duplicate prevented at DB constraint level
    dup = client.post("/api/attendance/manual", json={"session_id": session_id, "student_id": 1, "status": "Present"})
    assert dup.status_code == 409

    # Report downloads
    assert client.get("/api/reports/csv").status_code == 200
    assert client.get("/api/reports/excel").status_code == 200
    assert client.get("/api/reports/pdf").status_code == 200
