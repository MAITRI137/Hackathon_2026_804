/**
 * Application state shape.
 *
 * One coherent store. Every screen derives from this — there is no second
 * copy of any business value anywhere in the app.
 */
import type {
  AppSettings,
  Attendance,
  AuditEvent,
  ChecklistInstance,
  Contract,
  Department,
  Employee,
  EmployeeDocument,
  Holiday,
  JobPosition,
  LeaveAllocation,
  LeaveRequest,
  LeaveType,
  OutboxMessage,
  Payrun,
  Payslip,
  ProfileChangeRequest,
  Role,
  SalaryChangeRequest,
  SalaryRule,
  SalaryStructure,
  SavedView,
  User,
  WorkingSchedule,
} from '@shared/types';
import * as seed from '@/data/seed';

export interface AppState {
  /* reference data */
  departments: Department[];
  jobPositions: JobPosition[];
  schedules: WorkingSchedule[];
  holidays: Holiday[];
  leaveTypes: LeaveType[];
  salaryStructures: SalaryStructure[];
  salaryRules: SalaryRule[];

  /* records */
  users: User[];
  employees: Employee[];
  contracts: Contract[];
  attendance: Attendance[];
  leaveAllocations: LeaveAllocation[];
  leaveRequests: LeaveRequest[];
  payruns: Payrun[];
  payslips: Payslip[];
  documents: EmployeeDocument[];
  checklists: ChecklistInstance[];
  profileChangeRequests: ProfileChangeRequest[];
  salaryChangeRequests: SalaryChangeRequest[];
  outbox: OutboxMessage[];
  audit: AuditEvent[];
  savedViews: SavedView[];

  /* platform */
  settings: AppSettings;
  readNotificationIds: string[];
  dismissedNotificationIds: string[];

  /** Real dataset totals from the server. Screens show these rather than
   *  counting a collection the browser happens to hold. */
  counts: (Record<string, number> & { total: number }) | null;
  /** Attendance status totals for the open period, aggregated in SQL. */
  attendanceSummary: Record<string, number> | null;

  /* session */
  currentUserId: string;
  activePayrunId: string;
  today: string;

  /* counters for deterministic ids */
  seq: number;
}

export const ROLE_TO_USER: Record<Role, string> = {
  EMPLOYEE: 'usr-emp',
  HR_MANAGER: 'usr-hr',
  HR_PAYROLL_USER: 'usr-pu',
  HR_PAYROLL_MANAGER: 'usr-pm',
  ADMIN: 'usr-admin',
};

export function createInitialState(): AppState {
  return {
    departments: structuredClone(seed.departments),
    jobPositions: structuredClone(seed.jobPositions),
    schedules: structuredClone(seed.schedules),
    holidays: structuredClone(seed.holidays),
    leaveTypes: structuredClone(seed.leaveTypes),
    salaryStructures: structuredClone(seed.salaryStructures),
    salaryRules: structuredClone(seed.salaryRules),

    users: structuredClone(seed.users),
    employees: structuredClone(seed.employees),
    contracts: structuredClone(seed.contracts),
    attendance: structuredClone(seed.attendance),
    leaveAllocations: structuredClone(seed.leaveAllocations),
    leaveRequests: structuredClone(seed.leaveRequests),
    payruns: structuredClone(seed.payruns),
    payslips: [],
    documents: structuredClone(seed.documents),
    checklists: structuredClone(seed.checklists),
    profileChangeRequests: structuredClone(seed.profileChangeRequests),
    salaryChangeRequests: structuredClone(seed.salaryChangeRequests),
    outbox: [],
    audit: structuredClone(seed.auditSeed),
    savedViews: [],

    settings: { ...seed.settingsSeed },
    readNotificationIds: [],
    dismissedNotificationIds: [],

    counts: null,
    attendanceSummary: null,

    currentUserId: 'usr-pm',
    activePayrunId: seed.ACTIVE_PAYRUN_ID,
    today: seed.TODAY,

    seq: 1000,
  };
}
