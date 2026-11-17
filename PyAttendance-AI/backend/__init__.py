from flask import Flask
from config import Config
from backend.extensions import cors, csrf, db, limiter, login_manager, migrate


def create_app(config_class=Config):
    app = Flask(
        __name__,
        template_folder="../frontend/templates",
        static_folder="../frontend/static",
    )
    app.config.from_object(config_class)

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    cors.init_app(app, supports_credentials=True)
    csrf.init_app(app)
    limiter.init_app(app)

    from backend.models.models import Admin, Faculty, Student

    @login_manager.user_loader
    def load_user(user_token: str):
        if ":" not in user_token:
            return None
        role, uid = user_token.split(":", 1)
        if role == "admin":
            return db.session.get(Admin, int(uid))
        if role == "faculty":
            return db.session.get(Faculty, int(uid))
        if role == "student":
            return db.session.get(Student, int(uid))
        return None

    from backend.routes.auth import auth_bp
    from backend.routes.students import students_bp
    from backend.routes.faculty import faculty_bp
    from backend.routes.sessions import sessions_bp
    from backend.routes.attendance import attendance_bp
    from backend.routes.reports import reports_bp
    from backend.routes.analytics import analytics_bp
    from backend.routes.views import views_bp

    for bp in (auth_bp, students_bp, faculty_bp, sessions_bp, attendance_bp, reports_bp, analytics_bp):
        csrf.exempt(bp)  # JSON APIs validated via SameSite session + X-Requested-With / origin checks
        app.register_blueprint(bp)

    app.register_blueprint(views_bp)

    return app
