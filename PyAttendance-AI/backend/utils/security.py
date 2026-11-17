import base64
import hashlib
import json
from functools import wraps
from cryptography.fernet import Fernet
from flask import current_app, jsonify
from flask_login import current_user
from backend.extensions import db
from backend.models.models import AuditLog


def _get_fernet() -> Fernet:
    raw_key = current_app.config.get("BIOMETRIC_ENCRYPTION_KEY", "")
    if raw_key:
        return Fernet(raw_key.encode("utf-8"))
    # Deterministic dev key derived from SECRET_KEY when BIOMETRIC_ENCRYPTION_KEY is unset
    digest = hashlib.sha256(current_app.config["SECRET_KEY"].encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_embedding(embedding: list[float]) -> bytes:
    payload = json.dumps([float(x) for x in embedding]).encode("utf-8")
    return _get_fernet().encrypt(payload)


def decrypt_embedding(token: bytes) -> list[float]:
    raw = _get_fernet().decrypt(token)
    return [float(x) for x in json.loads(raw.decode("utf-8"))]


def role_required(*roles: str):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not current_user.is_authenticated:
                return jsonify({"error": "Authentication required."}), 401
            if getattr(current_user, "role", None) not in roles:
                return jsonify({"error": "Forbidden: insufficient role permissions."}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def write_audit_log(action: str, resource_type: str, resource_id="", details=""):
    role = getattr(current_user, "role", "system") if current_user.is_authenticated else "system"
    uid = 0
    email = "system"
    if current_user.is_authenticated:
        email = getattr(current_user, "email", "unknown")
        uid = int(current_user.get_id().split(":")[1])
    db.session.add(
        AuditLog(
            user_role=role,
            user_id=uid,
            user_email=email,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id),
            details=details,
        )
    )
