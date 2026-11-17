import { db, initSchema, writeAuditLog } from './db.ts';
import { hashPassword } from './security.ts';

export function seedIfEmpty(): void {
  initSchema();

  const existingAdmin = db
    .prepare('SELECT COUNT(*) as cnt FROM admins')
    .get() as { cnt: number };
  if (existingAdmin.cnt > 0) {
    return;
  }

  const runSeed = db.transaction(() => {
    db.prepare(
      `INSERT INTO app_settings (
        setting_id, institution_name, institution_code, academic_year,
        current_semester, shortage_threshold, recognition_threshold,
        uncertain_threshold, detector_backend, late_counts_as_attended, retention_days
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'Apex Institute of Technology',
      'AIT-2026',
      '2026-27',
      5,
      75.0,
      0.62,
      0.48,
      'ssd_mobilenetv1',
      1,
      365
    );

    const adminHash = hashPassword('Admin@123');
    db.prepare(
      `INSERT INTO admins (username, full_name, email, password_hash)
       VALUES (?, ?, ?, ?)`
    ).run('sysadmin', 'Dr. Rajeshwari Menon', 'admin@pyattendance.edu', adminHash);

    const insertDept = db.prepare(
      `INSERT INTO departments (code, name, head_name) VALUES (?, ?, ?)`
    );
    const cseId = Number(
      insertDept.run('CSE', 'Computer Science & Engineering', 'Dr. Arvind Rao')
        .lastInsertRowid
    );
    const eceId = Number(
      insertDept.run(
        'ECE',
        'Electronics & Communication Engineering',
        'Dr. Meenakshi Iyer'
      ).lastInsertRowid
    );

    const insertCourse = db.prepare(
      `INSERT INTO courses (code, name, department_id, total_semesters) VALUES (?, ?, ?, ?)`
    );
    const btechCseId = Number(
      insertCourse.run('BTECH-CSE', 'B.Tech Computer Science & Engineering', cseId, 8)
        .lastInsertRowid
    );
    const btechEceId = Number(
      insertCourse.run('BTECH-ECE', 'B.Tech Electronics & Communication', eceId, 8)
        .lastInsertRowid
    );

    const facultyHash = hashPassword('Faculty@123');
    const insertFaculty = db.prepare(
      `INSERT INTO faculty (employee_code, name, email, password_hash, department_id, designation)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const fac1Id = Number(
      insertFaculty.run(
        'FAC-101',
        'Prof. Ananya Sharma',
        'ananya.sharma@pyattendance.edu',
        facultyHash,
        cseId,
        'Associate Professor'
      ).lastInsertRowid
    );
    const fac2Id = Number(
      insertFaculty.run(
        'FAC-102',
        'Dr. Vikram Patel',
        'vikram.patel@pyattendance.edu',
        facultyHash,
        eceId,
        'Professor'
      ).lastInsertRowid
    );

    const insertSubject = db.prepare(
      `INSERT INTO subjects (code, subject_name, course_id, semester, faculty_id, credits)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const sub1Id = Number(
      insertSubject.run('CS501', 'Machine Learning', btechCseId, 5, fac1Id, 4)
        .lastInsertRowid
    );
    const sub2Id = Number(
      insertSubject.run('CS502', 'Computer Vision & AI', btechCseId, 5, fac1Id, 4)
        .lastInsertRowid
    );
    const sub3Id = Number(
      insertSubject.run('CS503', 'Database Management Systems', btechCseId, 5, fac1Id, 3)
        .lastInsertRowid
    );
    const sub4Id = Number(
      insertSubject.run('EC501', 'Embedded Systems & DSP', btechEceId, 5, fac2Id, 4)
        .lastInsertRowid
    );

    const studentHash = hashPassword('Student@123');
    const insertStudent = db.prepare(
      `INSERT INTO students (
        student_code, roll_number, name, email, phone, department_id, course_id,
        semester, section, academic_year, enrollment_date, password_hash,
        biometric_consent, non_biometric_opt_out, sample_image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const studentRows: Array<{
      code: string;
      roll: string;
      name: string;
      email: string;
      phone: string;
      deptId: number;
      courseId: number;
      section: string;
      sampleImg: string | null;
      subjects: number[];
    }> = [
      {
        code: 'STU2026001',
        roll: 'CS2024001',
        name: 'Aarav Verma',
        email: 'aarav.verma@pyattendance.edu',
        phone: '+91-98401-11001',
        deptId: cseId,
        courseId: btechCseId,
        section: 'A',
        sampleImg: '/src/assets/images/sample_student_aarav_1794904592806.jpg',
        subjects: [sub1Id, sub2Id, sub3Id],
      },
      {
        code: 'STU2026002',
        roll: 'CS2024002',
        name: 'Priya Nair',
        email: 'priya.nair@pyattendance.edu',
        phone: '+91-98401-11002',
        deptId: cseId,
        courseId: btechCseId,
        section: 'A',
        sampleImg: '/src/assets/images/sample_student_priya_1794904593618.jpg',
        subjects: [sub1Id, sub2Id, sub3Id],
      },
      {
        code: 'STU2026003',
        roll: 'CS2024003',
        name: 'Rohan Kulkarni',
        email: 'rohan.kulkarni@pyattendance.edu',
        phone: '+91-98401-11003',
        deptId: cseId,
        courseId: btechCseId,
        section: 'A',
        sampleImg: '/src/assets/images/sample_student_rohan_1794904594306.jpg',
        subjects: [sub1Id, sub2Id, sub3Id],
      },
      {
        code: 'STU2026004',
        roll: 'CS2024004',
        name: 'Sneha Reddy',
        email: 'sneha.reddy@pyattendance.edu',
        phone: '+91-98401-11004',
        deptId: cseId,
        courseId: btechCseId,
        section: 'A',
        sampleImg: null,
        subjects: [sub1Id, sub2Id, sub3Id],
      },
      {
        code: 'STU2026005',
        roll: 'CS2024005',
        name: 'Karthik Subramanian',
        email: 'karthik.s@pyattendance.edu',
        phone: '+91-98401-11005',
        deptId: cseId,
        courseId: btechCseId,
        section: 'A',
        sampleImg: null,
        subjects: [sub1Id, sub2Id, sub3Id],
      },
      {
        code: 'STU2026006',
        roll: 'CS2024006',
        name: 'Divya Krishnan',
        email: 'divya.krishnan@pyattendance.edu',
        phone: '+91-98401-11006',
        deptId: cseId,
        courseId: btechCseId,
        section: 'A',
        sampleImg: null,
        subjects: [sub1Id, sub2Id, sub3Id],
      },
      {
        code: 'STU2026007',
        roll: 'CS2024007',
        name: 'Siddharth Joshi',
        email: 'siddharth.joshi@pyattendance.edu',
        phone: '+91-98401-11007',
        deptId: cseId,
        courseId: btechCseId,
        section: 'A',
        sampleImg: null,
        subjects: [sub1Id, sub2Id, sub3Id],
      },
      {
        code: 'STU2026008',
        roll: 'EC2024001',
        name: 'Meera Deshmukh',
        email: 'meera.deshmukh@pyattendance.edu',
        phone: '+91-98401-11008',
        deptId: eceId,
        courseId: btechEceId,
        section: 'A',
        sampleImg: null,
        subjects: [sub4Id],
      },
      {
        code: 'STU2026009',
        roll: 'EC2024002',
        name: 'Aditya Malhotra',
        email: 'aditya.malhotra@pyattendance.edu',
        phone: '+91-98401-11009',
        deptId: eceId,
        courseId: btechEceId,
        section: 'A',
        sampleImg: null,
        subjects: [sub4Id],
      },
      {
        code: 'STU2026010',
        roll: 'EC2024003',
        name: 'Nandini Bose',
        email: 'nandini.bose@pyattendance.edu',
        phone: '+91-98401-11010',
        deptId: eceId,
        courseId: btechEceId,
        section: 'A',
        sampleImg: null,
        subjects: [sub4Id],
      },
    ];

    const studentIdsByRoll = new Map<string, number>();
    const insertEnrollment = db.prepare(
      `INSERT INTO enrollments (student_id, subject_id) VALUES (?, ?)`
    );

    for (const st of studentRows) {
      const sid = Number(
        insertStudent.run(
          st.code,
          st.roll,
          st.name,
          st.email,
          st.phone,
          st.deptId,
          st.courseId,
          5,
          st.section,
          '2026-27',
          '2024-08-01',
          studentHash,
          0,
          st.roll === 'CS2024007' ? 1 : 0, // Siddharth uses non-biometric manual attendance option
          st.sampleImg
        ).lastInsertRowid
      );
      studentIdsByRoll.set(st.roll, sid);
      for (const subId of st.subjects) {
        insertEnrollment.run(sid, subId);
      }
    }

    // Seed historical closed sessions over past 14 days for realistic analytics & shortage alerts
    const insertSession = db.prepare(
      `INSERT INTO attendance_sessions (
        subject_id, faculty_id, section, session_date, start_time, end_time,
        session_status, detector_used, threshold_used, faces_detected_count,
        proposals_count, unknown_count
      ) VALUES (?, ?, 'A', ?, ?, ?, 'closed', 'ssd_mobilenetv1', 0.62, ?, ?, ?)`
    );
    const insertAtt = db.prepare(
      `INSERT INTO attendance (
        student_id, session_id, status, confidence_score, verification_method, reviewed_by, notes, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const cseRolls = [
      'CS2024001',
      'CS2024002',
      'CS2024003',
      'CS2024004',
      'CS2024005',
      'CS2024006',
      'CS2024007',
    ];
    const eceRolls = ['EC2024001', 'EC2024002', 'EC2024003'];

    const today = new Date();
    const formatDateOffset = (daysAgo: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().slice(0, 10);
    };

    const historicalSchedule = [
      { daysAgo: 12, subId: sub1Id, facId: fac1Id, facName: 'Prof. Ananya Sharma', rolls: cseRolls },
      { daysAgo: 10, subId: sub2Id, facId: fac1Id, facName: 'Prof. Ananya Sharma', rolls: cseRolls },
      { daysAgo: 8, subId: sub1Id, facId: fac1Id, facName: 'Prof. Ananya Sharma', rolls: cseRolls },
      { daysAgo: 7, subId: sub3Id, facId: fac1Id, facName: 'Prof. Ananya Sharma', rolls: cseRolls },
      { daysAgo: 5, subId: sub2Id, facId: fac1Id, facName: 'Prof. Ananya Sharma', rolls: cseRolls },
      { daysAgo: 3, subId: sub1Id, facId: fac1Id, facName: 'Prof. Ananya Sharma', rolls: cseRolls },
      { daysAgo: 2, subId: sub3Id, facId: fac1Id, facName: 'Prof. Ananya Sharma', rolls: cseRolls },
      { daysAgo: 1, subId: sub2Id, facId: fac1Id, facName: 'Prof. Ananya Sharma', rolls: cseRolls },
      { daysAgo: 9, subId: sub4Id, facId: fac2Id, facName: 'Dr. Vikram Patel', rolls: eceRolls },
      { daysAgo: 6, subId: sub4Id, facId: fac2Id, facName: 'Dr. Vikram Patel', rolls: eceRolls },
      { daysAgo: 3, subId: sub4Id, facId: fac2Id, facName: 'Dr. Vikram Patel', rolls: eceRolls },
      { daysAgo: 0, subId: sub1Id, facId: fac1Id, facName: 'Prof. Ananya Sharma', rolls: cseRolls },
    ];

    historicalSchedule.forEach((item, sIdx) => {
      const dateStr = formatDateOffset(item.daysAgo);
      const startTime = `${dateStr} 09:30:00`;
      const endTime = `${dateStr} 10:25:00`;
      const sessionId = Number(
        insertSession.run(
          item.subId,
          item.facId,
          dateStr,
          startTime,
          endTime,
          item.rolls.length,
          item.rolls.length - 1,
          0
        ).lastInsertRowid
      );

      item.rolls.forEach((roll, rIdx) => {
        const sid = studentIdsByRoll.get(roll)!;
        // Make CS2024005 (Karthik) and EC2024003 (Nandini) have shortage (<75%) for realistic shortage alerts
        let status: 'Present' | 'Absent' | 'Late' | 'Excused' = 'Present';
        if (roll === 'CS2024005' && sIdx % 2 === 0) status = 'Absent';
        else if (roll === 'EC2024003' && sIdx % 2 === 1) status = 'Absent';
        else if (roll === 'CS2024003' && sIdx % 4 === 1) status = 'Late';
        else if (roll === 'CS2024006' && sIdx === 2) status = 'Excused';
        else if ((sIdx + rIdx) % 9 === 0) status = 'Absent';

        const method =
          roll === 'CS2024007' || status !== 'Present'
            ? 'Manual_Faculty'
            : 'Manual_Faculty';

        insertAtt.run(
          sid,
          sessionId,
          status,
          null,
          method,
          item.facName,
          status === 'Excused' ? 'Medical leave note verified' : '',
          startTime
        );
      });
    });

    writeAuditLog({
      userRole: 'admin',
      userId: 1,
      userEmail: 'admin@pyattendance.edu',
      action: 'SYSTEM_SEED',
      resourceType: 'database',
      resourceId: 'initial',
      details: 'Seeded 2 departments, 2 courses, 2 faculty, 4 subjects, 10 students, and 12 baseline sessions.',
    });
  });

  runSeed();
}
