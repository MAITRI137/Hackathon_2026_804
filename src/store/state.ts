/**
 * The shape of what this browser currently knows.
 *
 * This is a cache of the server snapshot, not a second database. It starts
 * empty, it is filled by `/api/bootstrap`, and it is replaced — never patched
 * optimistically — after every command and every live event. The only fields
 * the browser owns are the ones marked as view state below.
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
  PayrollDecisionReceipt,
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

/** A simulated payout batch, exactly as the server stored it. */
export interface DemoPaymentBatchView {
  id: string;
  payrunId: string;
  reference: string;
  status: 'QUEUED' | 'SIMULATED_SUCCESS' | 'SIMULATED_FAILURE';
  totalAmount: string;
  itemCount: number;
  successCount: number;
  failureCount: number;
  createdByName: string;
  createdAt: string;
  simulated: true;
  items: {
    id: string;
    payslipId: string;
    employeeId: string;
    amount: string;
    accountMasked: string;
    status: 'QUEUED' | 'SIMULATED_SUCCESS' | 'SIMULATED_FAILURE';
    failureReason: string | null;
    retryCount: number;
  }[];
}

/** A notification the server persisted because another user's action caused it. */
export interface StoredNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  readAt: string | null;
}

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
  decisionReceipts: PayrollDecisionReceipt[];
  payslips: Payslip[];
  documents: EmployeeDocument[];
  checklists: ChecklistInstance[];
  profileChangeRequests: ProfileChangeRequest[];
  salaryChangeRequests: SalaryChangeRequest[];
  outbox: OutboxMessage[];
  demoPayments: DemoPaymentBatchView[];
  audit: AuditEvent[];
  savedViews: SavedView[];

  /* platform */
  settings: AppSettings;
  storedNotifications: StoredNotification[];

  /** Real dataset totals from the server. Screens show these rather than
   *  counting a collection the browser happens to hold. */
  counts: (Record<string, number> & { total: number }) | null;
  /** Attendance status totals for the open period, aggregated in SQL. */
  attendanceSummary: Record<string, number> | null;

  /* session */
  currentUserId: string;
  today: string;

  /* ── view state: the only fields this browser owns ── */

  /** Which period the payroll screens are looking at. */
  activePayrunId: string;
  /** Derived alerts the signed-in person has read or dismissed in this tab.
   *  Persisted notifications carry their own server-side read state; these
   *  ids only cover alerts computed from data, which have nothing to store. */
  readNotificationIds: string[];
  dismissedNotificationIds: string[];
  /** Bumped on every store write so `useSyncExternalStore` sees a new value. */
  seq: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoFreezeAtCutoff: false,
  requireReopenReason: true,
  varianceThresholdPercent: 25,
  autoApproveShortSickLeave: false,
  lateGraceMinutes: 15,
  excessiveHoursPerDay: 11,
  inputCutoffDay: 25,
  payDay: 30,
};

/**
 * An empty store.
 *
 * Nothing is rendered from this: the application shows the sign-in screen until
 * `/api/bootstrap` has answered. Seeding the browser with demo records would
 * make an unauthenticated tab look like a working product, which is exactly the
 * illusion this rewrite exists to remove.
 */
export function createInitialState(): AppState {
  return {
    departments: [],
    jobPositions: [],
    schedules: [],
    holidays: [],
    leaveTypes: [],
    salaryStructures: [],
    salaryRules: [],

    users: [],
    employees: [],
    contracts: [],
    attendance: [],
    leaveAllocations: [],
    leaveRequests: [],
    payruns: [],
    decisionReceipts: [],
    payslips: [],
    documents: [],
    checklists: [],
    profileChangeRequests: [],
    salaryChangeRequests: [],
    outbox: [],
    demoPayments: [],
    audit: [],
    savedViews: [],

    settings: { ...DEFAULT_SETTINGS },
    storedNotifications: [],

    counts: null,
    attendanceSummary: null,

    currentUserId: '',
    today: new Date().toISOString().slice(0, 10),

    activePayrunId: '',
    readNotificationIds: [],
    dismissedNotificationIds: [],
    seq: 0,
  };
}

export const ROLE_TO_USER: Record<Role, string> = {
  EMPLOYEE: 'usr-emp',
  HR_MANAGER: 'usr-hr',
  HR_PAYROLL_USER: 'usr-pu',
  HR_PAYROLL_MANAGER: 'usr-pm',
  ADMIN: 'usr-admin',
};
