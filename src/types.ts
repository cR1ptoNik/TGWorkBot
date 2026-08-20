export interface ShiftRecord {
  id: number;
  chat_id: number;
  telegram_user_id: number;
  action: 'in' | 'out';
  surname: string;
  time: string;
  time_line?: string;
  raw_text?: string;
  source: 'telegram_ocr' | 'web_manual' | 'ocr_simulator';
  created_at: string;
  status?: 'verified' | 'flagged' | 'pending';
}

export interface AuditLog {
  id: number;
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';
  logger: string;
  message: string;
}

export interface RoleMap {
  creator?: Record<string, number>;
  admin: Record<string, number>;
  user: Record<string, number>;
}

export interface EmployeeScheduleItem {
  work_days: number[]; // [1..7] where 1 = Monday (Пн), 7 = Sunday (Вс)
  vacation_start?: string | null; // "YYYY-MM-DD"
  vacation_end?: string | null; // "YYYY-MM-DD"
  shift_start?: string;
  shift_end?: string;
  notes?: string;
}

export interface ScheduleConfig {
  shift_start: string;
  shift_end: string;
  tz_offset_hours: number;
  remind_before_start_minutes: number;
  remind_after_end_minutes: number;
  enabled: boolean;
  employee_schedules?: Record<string, EmployeeScheduleItem>;
}

export interface OcrResult {
  surname: string;
  time: string;
  time_line: string;
  status_bar_detected: boolean;
  detected_action: 'in' | 'out';
  confidence: number;
  raw_text: string;
  is_registered: boolean;
}

export interface SystemStats {
  today_date: string;
  total_records: number;
  today_total_marks: number;
  today_checked_in: number;
  today_checked_out: number;
  registered_users_count: number;
}
