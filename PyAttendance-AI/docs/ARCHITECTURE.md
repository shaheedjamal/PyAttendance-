# PyAttendance AI — System Architecture

## 1. Layered Architecture
1. **Presentation Layer (`frontend/templates`, `frontend/static`)**: Bootstrap 5 responsive UI, Chart.js analytics, HTML5 `getUserMedia` webcam capture, and AJAX/REST API client.
2. **Application & API Layer (`backend/routes`)**: Flask Blueprints enforcing session auth, RBAC decorators (`@role_required`), CSRF protection, rate limiting, and input validation.
3. **AI & Domain Services (`backend/services`)**:
   - `face_detection.py`: Configurable OpenCV Haar Cascade / DNN / MTCNN multi-face detector, quality check (blur/size/luminance), and eye-alignment cropping.
   - `face_recognition.py`: FaceNet (InceptionResnetV1 pretrained on VGGFace2) 512-D L2-normalized embedding extractor + cosine similarity comparator with configurable recognition and uncertain thresholds.
   - `attendance_service.py`: Session lifecycle, enrollment eligibility check, database unique constraint enforcement, and faculty review state transitions.
   - `report_service.py`: ReportLab PDF generator, OpenPyXL Excel workbook builder, and Pandas CSV exporter.
4. **Persistence Layer (`backend/models`)**: SQLAlchemy ORM mapped to PostgreSQL (or SQLite in local development).

## 2. Recognition Workflow
`Camera Frame -> Face Detection -> Quality Check & Alignment -> Embedding Extraction -> Cosine Similarity vs. Encrypted Templates -> (>= threshold: AI Proposal | uncertain band: Manual Review Queue | < lower bound: Unknown Rejected)`
