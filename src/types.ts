export type UserRole = 'admin' | 'faculty' | 'student';

export interface AuthUser {
  id: number;
  role: UserRole;
  email: string;
  name: string;
  username?: string;
  employee_code?: string;
  student_code?: string;
  roll_number?: string;
  department_id?: number;
  department_name?: string;
  department_code?: string;
  course_name?: string;
  semester?: number;
  section?: string;
  designation?: string;
  details?: Record<string, unknown>;
}

export interface AppSettings {
  setting_id: number;
  institution_name: string;
  institution_code: string;
  academic_year: string;
  current_semester: number;
  shortage_threshold: number;
  recognition_threshold: number;
  uncertain_threshold: number;
  detector_backend: 'ssd_mobilenetv1' | 'tiny_face_detector';
  late_counts_as_attended: number;
  retention_days: number;
  dpdp_notice: string;
}

export interface Department {
  department_id: number;
  code: string;
  name: string;
  head_name: string;
}

export interface Course {
  course_id: number;
  code: string;
  name: string;
  department_id: number;
  department_code: string;
  department_name: string;
  total_semesters: number;
}

export interface Subject {
  subject_id: number;
  code: string;
  subject_name: string;
  course_id: number;
  course_code: string;
  course_name: string;
  department_id: number;
  department_code: string;
  department_name: string;
  semester: number;
  faculty_id: number | null;
  faculty_name: string | null;
  faculty_email: string | null;
  credits: number;
}

export interface Student {
  student_id: number;
  student_code: string;
  roll_number: string;
  name: string;
  email: string;
  phone: string;
  department_id: number;
  department_code: string;
  department_name: string;
  course_id: number;
  course_code: string;
  course_name: string;
  semester: number;
  section: string;
  academic_year: string;
  enrollment_date: string;
  is_active: number;
  biometric_consent: number;
  consent_timestamp: string | null;
  non_biometric_opt_out: number;
  sample_image_url: string | null;
  face_enrolled: number;
  template_quality: number | null;
  template_samples: number | null;
  template_updated_at: string | null;
  enrolled_subjects: Array<{ subject_id: number; code: string; subject_name: string }>;
}

export interface Faculty {
  faculty_id: number;
  employee_code: string;
  name: string;
  email: string;
  department_id: number;
  department_code: string;
  department_name: string;
  designation: string;
  is_active: number;
  assigned_subjects: Array<{ subject_id: number; code: string; subject_name: string; semester: number }>;
}

export interface AttendanceSession {
  session_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  semester: number;
  course_code: string;
  course_name: string;
  department_code: string;
  faculty_id: number;
  faculty_name: string;
  section: string;
  session_date: string;
  start_time: string;
  end_time: string | null;
  session_status: 'active' | 'closed' | 'cancelled';
  detector_used: string;
  threshold_used: number;
  faces_detected_count: number;
  proposals_count: number;
  unknown_count: number;
  present_count: number;
  absent_count: number;
  pending_review_count: number;
}

export interface AttendanceRecord {
  attendance_id: number;
  student_id: number;
  session_id: number;
  roll_number: string;
  student_name: string;
  section: string;
  department_code: string;
  session_date: string;
  session_status: string;
  start_time: string;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  faculty_name: string;
  status: 'Present' | 'Absent' | 'Late' | 'Excused';
  confidence_score: number | null;
  verification_method:
    | 'AI_Proposal_Pending'
    | 'AI_Face_Approved'
    | 'Manual_Faculty'
    | 'Corrected_Faculty';
  reviewed_by: string | null;
  notes: string;
  timestamp: string;
}

export interface AuditLog {
  log_id: number;
  user_role: string;
  user_id: number;
  user_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: string;
  ip_address: string;
  timestamp: string;
}
