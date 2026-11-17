# PyAttendance AI — Face Recognition Classroom Attendance Management System

PyAttendance AI is a full-stack, role-based classroom attendance platform built with **Python 3.11/3.12**, **Flask**, **PostgreSQL** (with SQLite development fallback), **OpenCV**, **FaceNet (PyTorch)**, **ReportLab**, **OpenPyXL**, **Bootstrap 5**, and **Chart.js**.

## Key Principles & Governance
- **Human-in-the-Loop Verification**: AI recognition generates attendance *proposals*; faculty review and approve uncertain or proposed identities before finalizing records.
- **Manual Non-Biometric Fallback**: Manual attendance operates independently of AI recognition for opted-out students or camera unavailability.
- **Biometric Template Encryption**: Facial embeddings are encrypted at rest using Fernet (AES-128-CBC + HMAC-SHA256) and raw enrollment images are not retained unnecessarily.
- **Database Integrity**: Enforces a database-level `UNIQUE (student_id, session_id)` constraint to prevent duplicate session attendance.
- **DPDP Act 2023 Readiness**: Includes explicit student consent capture, withdrawal/deletion endpoints, retention policy configuration, and audit logging. Deployment in India requires institutional legal review under the Digital Personal Data Protection Act, 2023.

## Windows 10/11 Installation & Execution

### Step 1: Verify Python
```bash
python --version
```

### Step 2: Open Project Directory
```bash
cd PyAttendance-AI
```

### Step 3: Create Virtual Environment
```bash
python -m venv venv
```

### Step 4: Activate Virtual Environment
```bash
venv\Scripts\activate
```

### Step 5: Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 6: Configure Environment Variables
```bash
copy .env.example .env
```
Edit `.env` to set `SECRET_KEY`, `BIOMETRIC_ENCRYPTION_KEY`, and `DATABASE_URL` (PostgreSQL URI or default SQLite `sqlite:///pyattendance_dev.db`).

### Step 7: Initialize Database Migrations
```bash
flask db init
flask db migrate -m "Initial schema"
flask db upgrade
```
*(Or run `python seed.py`, which initializes tables and seeds development data.)*

### Step 8: Seed Sample Data
```bash
python seed.py
```

### Step 9: Run Application
```bash
python app.py
```

### Step 10: Open Browser
Visit `http://127.0.0.1:5000`

### Running Tests
```bash
pytest -v
```
