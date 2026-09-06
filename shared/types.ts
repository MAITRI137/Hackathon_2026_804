/**
 * Domain types shared by the web client and the API server.
 * Money fields are MoneyString ("55000.00") everywhere they cross a boundary.
 */
import type { MoneyString } from './money.js';

/* ── Identity ──────────────────────────────────────────────── */

export const ROLES = [
  'EMPLOYEE',
  'HR_MANAGER',
  'HR_PAYROLL_USER',
  'HR_PAYROLL_MANAGER',
  'ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  EMPLOYEE: 'Employee',
  HR_MANAGER: 'HR Manager',
  HR_PAYROLL_USER: 'HR Payroll User',
  HR_PAYROLL_MANAGER: 'HR Payroll Manager',
  ADMIN: 'Administrator',
};

export interface User {
  id: string;
  email: string;
  role: Role;
  employeeId: string | null;
  displayName: string;
  initials: string;
  isActive: boolean;
  lastLoginAt?: string | null;
}

/* ── Organisation ──────────────────────────────────────────── */

export interface Department {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  managerId: string | null;
  monthlyBudget: MoneyString;
}

export interface JobPosition {
  id: string;
  title: string;
  departmentId: string | null;
  level: string;
}

export interface ScheduleLine {
  dayOfWeek: number; // 0 Sun … 6 Sat
  start: string; // "09:00"
  end: string; // "18:00"
  breakMinutes: number;
}

export interface WorkingSchedule {
  id: string;
  name: string;
  timezone: string;
  lines: ScheduleLine[];
  hoursPerWeek: number; // derived server-side, stored
  isActive: boolean;
}

export interface Holiday {
  id: string;
  name: string;
  date: string; // ISO date
  isOptional: boolean;
}

/* ── People ────────────────────────────────────────────────── */

export const EMPLOYEE_STATUSES = ['ACTIVE', 'PROBATION', 'NOTICE', 'EXITED', 'ARCHIVED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

export const EMPLOYEE_TYPE_LABEL: Record<EmployeeType, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERN: 'Intern',
};

export interface BankDetail {
  accountName: string;
  accountNumberMasked: string;
  ifsc: string;
  bankName: string;
  verifiedAt: string | null;
}

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  initials: string;
  email: string;
  phone: string;
  departmentId: string;
  jobPositionId: string;
  managerId: string | null;
  employeeType: EmployeeType;
  status: EmployeeStatus;
  joinDate: string;
  exitDate: string | null;
  probationEndDate: string | null;
  workingScheduleId: string;
  bank: BankDetail | null;
  panMasked: string | null;
  version: number;
}

export interface ProfileChangeRequest {
  id: string;
  employeeId: string;
  field: string;
  currentValue: string;
  requestedValue: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedById: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export const DOCUMENT_CATEGORIES = [
  'CONTRACT',
  'PAYSLIP',
  'IDENTITY',
  'LETTER',
  'POLICY',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export interface EmployeeDocument {
  id: string;
  employeeId: string | null;
  contractId: string | null;
  category: DocumentCategory;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: 'SELF' | 'HR' | 'PAYROLL' | 'ADMIN';
  uploadedAt: string;
  uploadedById: string;
  acknowledgedAt: string | null;
}

export interface ChecklistItem {
  id: string;
  label: string;
  ownerRole: Role;
  dueDate: string;
  blocksPayroll: boolean;
  completedAt: string | null;
  completedById: string | null;
}

export interface ChecklistInstance {
  id: string;
  employeeId: string;
  type: 'ONBOARDING' | 'OFFBOARDING';
  items: ChecklistItem[];
  createdAt: string;
}

/* ── Contracts ─────────────────────────────────────────────── */

export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface Contract {
  id: string;
  contractRef: string;
  employeeId: string;
  startDate: string;
  endDate: string | null;
  departmentId: string;
  jobPositionId: string;
  employeeType: EmployeeType;
  wage: MoneyString;
  salaryStructureId: string;
  workingScheduleId: string;
  status: ContractStatus;
  notes: string;
  version: number;
}

/* ── Attendance ────────────────────────────────────────────── */

export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'LATE',
  'EARLY_EXIT',
  'MISSING_CHECKOUT',
  'OVERTIME',
  'ABSENT',
  'HOLIDAY',
  'WEEKLY_OFF',
  'ON_LEAVE',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export interface Attendance {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string | null; // "09:15"
  checkOut: string | null;
  workedMinutes: number;
  status: AttendanceStatus;
  source: 'SELF' | 'MANAGER' | 'IMPORT' | 'SYSTEM';
  correctionReason: string | null;
  correctedById: string | null;
  correctedAt: string | null;
  version: number;
}

/* ── Time off ──────────────────────────────────────────────── */

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  isPaid: boolean;
  requiresAllocation: boolean;
  allowNegativeBalance: boolean;
  carryForwardMax: number;
  accrualPerMonth: number;
  colorToken: string;
}

export interface LeaveAllocation {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  allocated: number;
  used: number;
  carriedForward: number;
  validFrom: string;
  validTo: string;
}

export const APPROVAL_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REFUSED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  days: number;
  reason: string;
  status: ApprovalStatus;
  approverId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  autoDecidedBy: string | null; // automation policy name, when applicable
  createdAt: string;
}

/* ── Salary configuration ──────────────────────────────────── */

export const RULE_CATEGORIES = ['BASIC', 'ALLOWANCES', 'GROSS', 'DEDUCTIONS', 'NET'] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_TYPES = ['FIXED', 'PERCENTAGE', 'FORMULA'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

export interface SalaryRule {
  id: string;
  structureId: string;
  code: string;
  name: string;
  category: RuleCategory;
  sequence: number;
  type: RuleType;
  amount: MoneyString | null;
  percentage: string | null; // "20" means 20%
  baseCode: string | null;
  formula: string | null;
  conditionFormula: string | null;
  isActive: boolean;
  ruleVersion: number;
}

export interface SalaryStructure {
  id: string;
  name: string;
  code: string;
  description: string;
  isActive: boolean;
  version: number;
}

/* ── Payroll ───────────────────────────────────────────────── */

export const PAYRUN_STATUSES = ['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID'] as const;
export type PayrunStatus = (typeof PAYRUN_STATUSES)[number];

export interface Payrun {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  salaryStructureId: string;
  status: PayrunStatus;
  isFrozen: boolean;
  frozenAt: string | null;
  reopenReason: string | null;
  expectedWorkDays: number;
  computedAt: string | null;
  validatedAt: string | null;
  paidAt: string | null;
  inputSnapshotHash: string | null;
  createdById: string;
  employeeIds: string[];
  version: number;
}

/** Immutable evidence captured when a payroll run is authorised for payment. */
export interface PayrollDecisionReceipt {
  payrunId: string;
  status: 'VALIDATED' | 'PAID';
  snapshotHash: string;
  readinessScore: number;
  blockingExceptionCount: number;
  employeeCount: number;
  netTotal: MoneyString;
  preparedById: string;
  preparedByName: string;
  preparedAt: string;
  validatedById: string | null;
  validatedByName: string | null;
  validatedAt: string | null;
  paidById: string | null;
  paidByName: string | null;
  paidAt: string | null;
}

export interface SourceRef {
  type: 'CONTRACT' | 'RULE' | 'LEAVE' | 'ATTENDANCE' | 'SCHEDULE' | 'STRUCTURE' | 'CONSTANT';
  id: string;
  label: string;
}

export interface PayslipLine {
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  ruleVersion: number;
  category: RuleCategory;
  sequence: number;
  formulaSnapshot: string;
  inputs: Record<string, string>;
  sourceRefs: SourceRef[];
  amount: MoneyString;
}

export const PAYSLIP_STATUSES = ['DRAFT', 'COMPUTED', 'VALIDATED', 'PAID', 'CANCELLED'] as const;
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];

export const DELIVERY_STATUSES = ['PENDING', 'QUEUED', 'SENT', 'FAILED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export interface PayslipInputSnapshot {
  expectedDays: number;
  workedDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  overtimeMinutes: number;
  presentDays: number;
  wage: MoneyString;
}

export interface Payslip {
  id: string;
  payslipRef: string;
  payrunId: string;
  employeeId: string;
  contractId: string;
  periodStart: string;
  periodEnd: string;
  structureId: string;
  status: PayslipStatus;
  lines: PayslipLine[];
  gross: MoneyString;
  totalDeductions: MoneyString;
  net: MoneyString;
  input: PayslipInputSnapshot;
  snapshotHash: string;
  computedAt: string;
  isDuplicate: boolean;
  delivery: DeliveryStatus;
  deliveryError: string | null;
  deliveredAt: string | null;
  paymentStatus: 'UNPAID' | 'PAID' | 'FAILED';
}

/* ── Exceptions & readiness ────────────────────────────────── */

export const EXCEPTION_KINDS = [
  'MISSING_BANK',
  'NO_CONTRACT',
  'AMBIGUOUS_CONTRACT',
  'MISSING_CHECKOUT',
  'DUPLICATE_PAYSLIP',
  'INVALID_RULE',
  'NEGATIVE_NET',
  'ONBOARDING_INCOMPLETE',
  'UNAPPROVED_LEAVE',
  'CONTRACT_EXPIRING',
  'SALARY_VARIANCE',
  'LEAVER_PAID',
  'DUPLICATE_BANK_ACCOUNT',
  'EXCESSIVE_OVERTIME',
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export type ExceptionCategory = 'CONTRACT' | 'BANK' | 'ATTENDANCE' | 'LEAVE' | 'PAYSLIP' | 'RULE';

export interface PayrollException {
  id: string;
  kind: ExceptionKind;
  category: ExceptionCategory;
  severity: number; // readiness penalty
  blocking: boolean;
  employeeId: string | null;
  title: string;
  detail: string;
  /** How to fix it — drives the resolve surface. */
  resolution: 'BANK_DETAILS' | 'ATTENDANCE_CHECKOUT' | 'REMOVE_DUPLICATE' | 'CONTRACT' | 'REVIEW';
  refId: string | null;
}

export interface ReadinessCategory {
  category: ExceptionCategory;
  label: string;
  passing: number;
  total: number;
  percent: number;
}

export interface Readiness {
  score: number;
  blockingCount: number;
  warningCount: number;
  categories: ReadinessCategory[];
}

/* ── Platform ──────────────────────────────────────────────── */

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  actorRole: Role | 'SYSTEM';
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
}

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  createdAt: string;
  readAt: string | null;
  link: string | null;
  roles: Role[];
}

export interface OutboxMessage {
  id: string;
  to: string;
  subject: string;
  body: string;
  attachmentName: string | null;
  status: 'QUEUED' | 'SENT' | 'FAILED';
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  payslipId: string | null;
}

export interface AppSettings {
  autoFreezeAtCutoff: boolean;
  requireReopenReason: boolean;
  varianceThresholdPercent: number;
  autoApproveShortSickLeave: boolean;
  lateGraceMinutes: number;
  excessiveHoursPerDay: number;
  inputCutoffDay: number;
  payDay: number;
}

export interface SavedView {
  id: string;
  ownerId: string;
  module: string;
  name: string;
  filters: Record<string, string>;
  createdAt: string;
}

export interface NextBestAction {
  id: string;
  label: string;
  reason: string;
  to: string;
  cta: string;
  tone: 'default' | 'urgent';
}

export interface ApprovalItem {
  id: string;
  type: 'LEAVE' | 'PROFILE' | 'SALARY';
  employeeId: string;
  title: string;
  detail: string;
  submittedAt: string;
  status: ApprovalStatus;
  refId: string;
}

export interface SalaryChangeRequest {
  id: string;
  employeeId: string;
  contractId: string;
  currentWage: MoneyString;
  requestedWage: MoneyString;
  effectiveFrom: string;
  reason: string;
  status: ApprovalStatus;
  requestedById: string;
  decidedById: string | null;
  decidedAt: string | null;
  createdAt: string;
}
