"""PDF (ReportLab), Excel (OpenPyXL), and CSV (Pandas) institutional report generator."""
import io
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet


class ReportService:
    @staticmethod
    def generate_csv(rows: list[dict]) -> bytes:
        df = pd.DataFrame(rows)
        return df.to_csv(index=False).encode("utf-8")

    @staticmethod
    def generate_excel(rows: list[dict], meta: dict) -> bytes:
        wb = Workbook()
        ws = wb.active
        ws.title = "Attendance Summary"

        ws.append([meta.get("institution_name", "PyAttendance AI"), f"Academic Year: {meta.get('academic_year', '')}"])
        ws.append(["Department", meta.get("department", "All"), "Subject", meta.get("subject", "All")])
        ws.append([])

        headers = ["Roll Number", "Student Name", "Subject", "Conducted", "Present", "Late", "Excused", "Absent", "Percentage", "Status"]
        ws.append(headers)
        header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
        for cell in ws[4]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = header_fill

        for r in rows:
            ws.append([
                r["roll_number"],
                r["student_name"],
                r["subject"],
                r["total_sessions"],
                r["present_count"],
                r["late_count"],
                r["excused_count"],
                r["absent_count"],
                round(r["percentage"], 1),
                "Shortage" if r["shortage"] else "Nominal",
            ])

        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()

    @staticmethod
    def generate_pdf(rows: list[dict], meta: dict) -> bytes:
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=landscape(A4), topMargin=28, bottomMargin=28)
        styles = getSampleStyleSheet()
        elements = [
            Paragraph(f"<b>{meta.get('institution_name', 'PyAttendance AI')}</b> — Attendance Report", styles["Title"]),
            Paragraph(
                f"Department: {meta.get('department', 'All')} | Subject: {meta.get('subject', 'All')} | Academic Year: {meta.get('academic_year', '')}",
                styles["Normal"],
            ),
            Spacer(1, 14),
        ]

        table_data = [["Roll No", "Student Name", "Subject", "Conducted", "Present", "Late", "Absent", "Attend %", "Standing"]]
        for r in rows:
            table_data.append([
                r["roll_number"],
                r["student_name"],
                r["subject"],
                str(r["total_sessions"]),
                str(r["present_count"]),
                str(r["late_count"]),
                str(r["absent_count"]),
                f"{r['percentage']:.1f}%",
                "Shortage" if r["shortage"] else "Nominal",
            ])

        tbl = Table(table_data, repeatRows=1)
        tbl.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ])
        )
        elements.append(tbl)
        doc.build(elements)
        return buf.getvalue()
