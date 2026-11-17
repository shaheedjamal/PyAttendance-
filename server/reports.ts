import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';

export interface ReportSummaryRow {
  roll_number: string;
  student_name: string;
  department_code: string;
  subject_code: string;
  subject_name: string;
  total_sessions: number;
  present_count: number;
  late_count: number;
  excused_count: number;
  absent_count: number;
  attendance_percentage: number;
  shortage: boolean;
}

export interface ReportMetadata {
  institutionName: string;
  academicYear: string;
  departmentLabel: string;
  subjectLabel: string;
  facultyName: string;
  dateRangeLabel: string;
  shortageThreshold: number;
}

export function generateCsvBuffer(rows: ReportSummaryRow[]): Buffer {
  const headers = [
    'Roll Number',
    'Student Name',
    'Department',
    'Subject Code',
    'Subject Name',
    'Sessions Conducted',
    'Present',
    'Late',
    'Excused',
    'Absent',
    'Attendance %',
    'Status',
  ];

  const escapeCsv = (val: string | number | boolean): string => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replaceAll('"', '""')}"`;
    }
    return s;
  };

  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.roll_number,
        r.student_name,
        r.department_code,
        r.subject_code,
        r.subject_name,
        r.total_sessions,
        r.present_count,
        r.late_count,
        r.excused_count,
        r.absent_count,
        r.attendance_percentage.toFixed(1),
        r.shortage ? 'Shortage' : 'Nominal',
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ];

  return Buffer.from(lines.join('\r\n'), 'utf8');
}

export function generateExcelBuffer(
  rows: ReportSummaryRow[],
  meta: ReportMetadata
): Buffer {
  const workbook = XLSX.utils.book_new();

  const metaSheetData = [
    ['PyAttendance AI — Institutional Attendance Report'],
    ['Institution', meta.institutionName],
    ['Academic Year', meta.academicYear],
    ['Department', meta.departmentLabel],
    ['Subject', meta.subjectLabel],
    ['Faculty', meta.facultyName],
    ['Date Range', meta.dateRangeLabel],
    ['Shortage Threshold (%)', meta.shortageThreshold],
    ['Generated At', new Date().toISOString()],
  ];
  const metaSheet = XLSX.utils.aoa_to_sheet(metaSheetData);
  XLSX.utils.book_append_sheet(workbook, metaSheet, 'Report Info');

  const tableRows = rows.map((r) => ({
    'Roll Number': r.roll_number,
    'Student Name': r.student_name,
    Department: r.department_code,
    'Subject Code': r.subject_code,
    'Subject Name': r.subject_name,
    'Total Sessions': r.total_sessions,
    Present: r.present_count,
    Late: r.late_count,
    Excused: r.excused_count,
    Absent: r.absent_count,
    'Attendance %': Number(r.attendance_percentage.toFixed(1)),
    Standing: r.shortage ? 'Below Threshold' : 'Nominal',
  }));

  const dataSheet = XLSX.utils.json_to_sheet(
    tableRows.length > 0
      ? tableRows
      : [
          {
            'Roll Number': 'No matching attendance records found',
          },
        ]
  );
  dataSheet['!cols'] = [
    { wch: 14 },
    { wch: 24 },
    { wch: 12 },
    { wch: 14 },
    { wch: 28 },
    { wch: 15 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Attendance Summary');

  return Buffer.from(
    XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  );
}

export function generatePdfBuffer(
  rows: ReportSummaryRow[],
  meta: ReportMetadata
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 40,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header band
    doc.rect(40, 36, 761, 56).fill('#0f172a');
    doc
      .fillColor('#ffffff')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(meta.institutionName, 54, 48);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#cbd5e1')
      .text(
        `PyAttendance AI  |  Official Attendance Report  |  Academic Year ${meta.academicYear}`,
        54,
        70
      );

    // Metadata grid
    doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold');
    doc.text('Department:', 40, 108);
    doc.font('Helvetica').text(meta.departmentLabel, 112, 108);
    doc.font('Helvetica-Bold').text('Subject:', 310, 108);
    doc.font('Helvetica').text(meta.subjectLabel, 362, 108);
    doc.font('Helvetica-Bold').text('Faculty:', 580, 108);
    doc.font('Helvetica').text(meta.facultyName, 628, 108);

    doc.font('Helvetica-Bold').text('Period:', 40, 124);
    doc.font('Helvetica').text(meta.dateRangeLabel, 112, 124);
    doc.font('Helvetica-Bold').text('Threshold:', 310, 124);
    doc.font('Helvetica').text(`${meta.shortageThreshold}% minimum`, 372, 124);
    doc.font('Helvetica-Bold').text('Generated:', 580, 124);
    doc.font('Helvetica').text(new Date().toISOString().slice(0, 16).replace('T', ' '), 640, 124);

    // Table header
    let y = 152;
    const drawTableHeader = (topY: number) => {
      doc.rect(40, topY, 761, 22).fill('#e2e8f0');
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5);
      doc.text('Roll No', 46, topY + 7, { width: 72 });
      doc.text('Student Name', 120, topY + 7, { width: 148 });
      doc.text('Subject', 270, topY + 7, { width: 165 });
      doc.text('Conducted', 440, topY + 7, { width: 55, align: 'right' });
      doc.text('Present', 500, topY + 7, { width: 48, align: 'right' });
      doc.text('Late', 552, topY + 7, { width: 40, align: 'right' });
      doc.text('Excused', 596, topY + 7, { width: 48, align: 'right' });
      doc.text('Absent', 648, topY + 7, { width: 45, align: 'right' });
      doc.text('Attend %', 698, topY + 7, { width: 48, align: 'right' });
      doc.text('Status', 750, topY + 7, { width: 48 });
    };

    drawTableHeader(y);
    y += 24;

    if (rows.length === 0) {
      doc
        .fillColor('#475569')
        .font('Helvetica')
        .fontSize(10)
        .text('No attendance records matched the selected filters.', 46, y + 12);
    } else {
      rows.forEach((row, idx) => {
        if (y > 520) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
          y = 44;
          drawTableHeader(y);
          y += 24;
        }
        if (idx % 2 === 1) {
          doc.rect(40, y - 2, 761, 20).fill('#f8fafc');
        }
        doc.fillColor('#0f172a').font('Helvetica').fontSize(8.5);
        doc.text(row.roll_number, 46, y + 3, { width: 72 });
        doc.text(row.student_name, 120, y + 3, { width: 148, ellipsis: true });
        doc.text(`${row.subject_code} · ${row.subject_name}`, 270, y + 3, {
          width: 165,
          ellipsis: true,
        });
        doc.text(String(row.total_sessions), 440, y + 3, {
          width: 55,
          align: 'right',
        });
        doc.text(String(row.present_count), 500, y + 3, {
          width: 48,
          align: 'right',
        });
        doc.text(String(row.late_count), 552, y + 3, {
          width: 40,
          align: 'right',
        });
        doc.text(String(row.excused_count), 596, y + 3, {
          width: 48,
          align: 'right',
        });
        doc.text(String(row.absent_count), 648, y + 3, {
          width: 45,
          align: 'right',
        });
        doc
          .fillColor(row.shortage ? '#dc2626' : '#0f766e')
          .font('Helvetica-Bold')
          .text(`${row.attendance_percentage.toFixed(1)}%`, 698, y + 3, {
            width: 48,
            align: 'right',
          });
        doc
          .font('Helvetica')
          .text(row.shortage ? 'Shortage' : 'Nominal', 750, y + 3, {
            width: 48,
          });
        y += 20;
      });
    }

    doc
      .fillColor('#64748b')
      .fontSize(8)
      .font('Helvetica')
      .text(
        'Generated by PyAttendance AI. AI recognition proposals require faculty verification before institutional finalization.',
        40,
        555
      );

    doc.end();
  });
}
