import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-change-in-production-pyattendance")
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL",
        f"sqlite:///{os.path.join(BASE_DIR, 'instance', 'pyattendance_dev.db')}",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    PERMANENT_SESSION_LIFETIME = timedelta(hours=12)
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("FLASK_ENV") == "production"
    WTF_CSRF_ENABLED = True

    BIOMETRIC_ENCRYPTION_KEY = os.environ.get("BIOMETRIC_ENCRYPTION_KEY", "")
    FACE_DETECTOR_BACKEND = os.environ.get("FACE_DETECTOR_BACKEND", "haar")
    RECOGNITION_COSINE_THRESHOLD = float(
        os.environ.get("RECOGNITION_COSINE_THRESHOLD", "0.62")
    )
    UNCERTAIN_LOWER_THRESHOLD = float(
        os.environ.get("UNCERTAIN_LOWER_THRESHOLD", "0.48")
    )
    SHORTAGE_THRESHOLD_PERCENT = float(
        os.environ.get("SHORTAGE_THRESHOLD_PERCENT", "75.0")
    )
    BIOMETRIC_RETENTION_DAYS = int(
        os.environ.get("BIOMETRIC_RETENTION_DAYS", "365")
    )
    REPORTS_DIR = os.path.join(BASE_DIR, "reports")


class TestingConfig(Config):
    TESTING = True
    WTF_CSRF_ENABLED = False
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
