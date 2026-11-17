"""Transactional attendance service enforcing eligibility and duplicate prevention."""
from datetime import datetime
from sqlalchemy.exc import IntegrityError
from backend.extensions import db
from backend.models.models import Attendance, AttendanceSession, Enrollment


class AttendanceService:
    @staticmethod
    def record_attendance(
        student_id: int,
        session_id: int,
        status: str,
        verification_method: str,
        reviewed_by: str | None = None,
        confidence_score: float | None = None,
        notes: str = "",
    ) -> tuple[Attendance | None, str | None]:
        session = db.session.get(AttendanceSession, session_id)
        if not session:
            return None, "Attendance session not found."

        enrolled = Enrollment.query.filter_by(
            student_id=student_id, subject_id=session.subject_id
        ).first()
        if not enrolled:
            return None, "Student is not enrolled in this subject."

        record = Attendance(
            student_id=student_id,
            session_id=session_id,
            status=status,
            verification_method=verification_method,
            reviewed_by=reviewed_by,
            confidence_score=confidence_score,
            notes=notes,
            timestamp=datetime.utcnow(),
        )
        db.session.add(record)
        try:
            db.session.commit()
            return record, None
        except IntegrityError:
            db.session.rollback()
            return None, "Duplicate attendance prevented for this student and session."
