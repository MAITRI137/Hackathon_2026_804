/**
 * Deterministic demo dataset.
 *
 * Same seed → byte-identical data, every time. `Math.random` is never used.
 * This is the story dataset: a September 2026 payrun with exactly three
 * blockers, three prior paid periods for trend and comparison, one contract
 * expiring, one probation ending, and one pending salary change.
 */
import type {
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
  Payrun,
  ProfileChangeRequest,
  SalaryChangeRequest,
  SalaryRule,
  SalaryStructure,
  User,
  WorkingSchedule,
} from '../../shared/types.js';
import {
  addDays,
  addMonths,
  countWorkingDays,
  eachDay,
  fromMinutes,
  isWorkingDay,
  monthEnd,
  monthLabel,
  monthStart,
  toISO,
  type ISODate,
  type WorkingDayContext,
} from '../../shared/dates.js';

/** The demo clock. Everything derives from this — nothing is hardcoded elsewhere. */
export const TODAY: ISODate = '2026-09-05';
export const NOW_ISO = '2026-09-05T14:30:00+05:30';

/* ── seeded RNG ────────────────────────────────────────────── */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260905);
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

/* ── departments & positions ───────────────────────────────── */

export const departments: Department[] = [
  {
    id: 'dep-eng',
    name: 'Engineering',
    code: 'ENG',
    parentId: null,
    managerId: 'EMP-005',
    monthlyBudget: '1400000.00',
  },
  {
    id: 'dep-prd',
    name: 'Product',
    code: 'PRD',
    parentId: null,
    managerId: 'EMP-002',
    monthlyBudget: '520000.00',
  },
  {
    id: 'dep-sls',
    name: 'Sales',
    code: 'SLS',
    parentId: null,
    managerId: 'EMP-009',
    monthlyBudget: '760000.00',
  },
  {
    id: 'dep-ops',
    name: 'Operations',
    code: 'OPS',
    parentId: null,
    managerId: 'EMP-004',
    monthlyBudget: '540000.00',
  },
  {
    id: 'dep-fin',
    name: 'Finance',
    code: 'FIN',
    parentId: null,
    managerId: 'EMP-006',
    monthlyBudget: '380000.00',
  },
  {
    id: 'dep-hr',
    name: 'Human Resources',
    code: 'HR',
    parentId: null,
    managerId: 'EMP-007',
    monthlyBudget: '300000.00',
  },
  {
    id: 'dep-mkt',
    name: 'Marketing',
    code: 'MKT',
    parentId: null,
    managerId: null,
    monthlyBudget: '340000.00',
  },
  {
    id: 'dep-sup',
    name: 'Customer Support',
    code: 'SUP',
    parentId: null,
    managerId: null,
    monthlyBudget: '290000.00',
  },
];

export const jobPositions: JobPosition[] = [
  { id: 'jp-swe', title: 'Software Engineer', departmentId: 'dep-eng', level: 'IC2' },
  { id: 'jp-sse', title: 'Senior Engineer', departmentId: 'dep-eng', level: 'IC3' },
  { id: 'jp-devops', title: 'DevOps Engineer', departmentId: 'dep-eng', level: 'IC3' },
  { id: 'jp-fe', title: 'Frontend Developer', departmentId: 'dep-eng', level: 'IC2' },
  { id: 'jp-qa', title: 'QA Engineer', departmentId: 'dep-eng', level: 'IC2' },
  { id: 'jp-pd', title: 'Product Designer', departmentId: 'dep-prd', level: 'IC3' },
  { id: 'jp-pm', title: 'Product Manager', departmentId: 'dep-prd', level: 'IC4' },
  { id: 'jp-se', title: 'Sales Executive', departmentId: 'dep-sls', level: 'IC2' },
  { id: 'jp-sm', title: 'Sales Manager', departmentId: 'dep-sls', level: 'M1' },
  { id: 'jp-om', title: 'Operations Manager', departmentId: 'dep-ops', level: 'M1' },
  { id: 'jp-oa', title: 'Operations Associate', departmentId: 'dep-ops', level: 'IC1' },
  { id: 'jp-fa', title: 'Finance Analyst', departmentId: 'dep-fin', level: 'IC2' },
  { id: 'jp-acc', title: 'Accountant', departmentId: 'dep-fin', level: 'IC2' },
  { id: 'jp-hrl', title: 'HR Lead', departmentId: 'dep-hr', level: 'M1' },
  { id: 'jp-hrb', title: 'HR Business Partner', departmentId: 'dep-hr', level: 'IC3' },
  { id: 'jp-mm', title: 'Marketing Manager', departmentId: 'dep-mkt', level: 'M1' },
  { id: 'jp-ca', title: 'Content Associate', departmentId: 'dep-mkt', level: 'IC1' },
  { id: 'jp-sup', title: 'Support Specialist', departmentId: 'dep-sup', level: 'IC1' },
];

/* ── schedules & holidays ──────────────────────────────────── */

export const schedules: WorkingSchedule[] = [
  {
    id: 'sch-std',
    name: 'Standard 40h (Mon–Fri)',
    timezone: 'Asia/Kolkata',
    lines: [1, 2, 3, 4, 5].map((d) => ({
      dayOfWeek: d,
      start: '09:00',
      end: '18:00',
      breakMinutes: 60,
    })),
    hoursPerWeek: 40,
    isActive: true,
  },
  {
    id: 'sch-shift',
    name: 'Support Shift 36h (Mon–Sat)',
    timezone: 'Asia/Kolkata',
    lines: [1, 2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      start: '10:00',
      end: '17:00',
      breakMinutes: 60,
    })),
    hoursPerWeek: 36,
    isActive: true,
  },
];

export const holidays: Holiday[] = [
  { id: 'hol-1', name: 'Independence Day', date: '2026-08-15', isOptional: false },
  { id: 'hol-2', name: 'Ganesh Chaturthi', date: '2026-09-15', isOptional: false },
  { id: 'hol-3', name: 'Gandhi Jayanti', date: '2026-10-02', isOptional: false },
  { id: 'hol-4', name: 'Diwali', date: '2026-11-08', isOptional: false },
];

export const holidaySet = new Set(holidays.map((h) => h.date));

export function scheduleContext(scheduleId: string): WorkingDayContext {
  const sch = schedules.find((s) => s.id === scheduleId) ?? schedules[0];
  return { workingDows: sch.lines.map((l) => l.dayOfWeek), holidays: holidaySet };
}

/* ── employees ─────────────────────────────────────────────── */

interface Story {
  id: string;
  first: string;
  last: string;
  dep: string;
  pos: string;
  wage: number;
  join: string;
  bank: boolean;
  type?: Employee['employeeType'];
  status?: Employee['status'];
  manager?: string | null;
  probationEnd?: string | null;
  contractEnd?: string | null;
  email?: string;
}

const STORY: Story[] = [
  {
    id: 'EMP-001',
    first: 'Aarav',
    last: 'Patel',
    dep: 'dep-eng',
    pos: 'jp-swe',
    wage: 60000,
    join: '2024-03-11',
    bank: true,
    manager: 'EMP-005',
  },
  {
    id: 'EMP-002',
    first: 'Maitri',
    last: 'Shah',
    dep: 'dep-prd',
    pos: 'jp-pd',
    wage: 55000,
    join: '2023-07-03',
    bank: true,
  },
  {
    id: 'EMP-003',
    first: 'Rahul',
    last: 'Sharma',
    dep: 'dep-sls',
    pos: 'jp-se',
    wage: 45000,
    join: '2025-11-17',
    bank: false,
    manager: 'EMP-009',
  },
  {
    id: 'EMP-004',
    first: 'Meera',
    last: 'Joshi',
    dep: 'dep-ops',
    pos: 'jp-om',
    wage: 65000,
    join: '2022-01-10',
    bank: true,
  },
  {
    id: 'EMP-005',
    first: 'Dev',
    last: 'Patel',
    dep: 'dep-eng',
    pos: 'jp-sse',
    wage: 75000,
    join: '2021-06-21',
    bank: true,
  },
  {
    id: 'EMP-006',
    first: 'Isha',
    last: 'Mehta',
    dep: 'dep-fin',
    pos: 'jp-fa',
    wage: 50000,
    join: '2024-09-02',
    bank: true,
  },
  {
    id: 'EMP-007',
    first: 'Priya',
    last: 'Desai',
    dep: 'dep-hr',
    pos: 'jp-hrl',
    wage: 58000,
    join: '2022-11-14',
    bank: true,
  },
  {
    id: 'EMP-008',
    first: 'Karan',
    last: 'Singh',
    dep: 'dep-eng',
    pos: 'jp-devops',
    wage: 70000,
    join: '2023-02-06',
    bank: true,
    contractEnd: '2026-09-30',
  },
  {
    id: 'EMP-009',
    first: 'Nisha',
    last: 'Gupta',
    dep: 'dep-sls',
    pos: 'jp-sm',
    wage: 72000,
    join: '2021-08-30',
    bank: true,
    email: 'nisha.gupta@peoplepay360.invalid',
  },
  {
    id: 'EMP-010',
    first: 'Arjun',
    last: 'Reddy',
    dep: 'dep-eng',
    pos: 'jp-fe',
    wage: 55000,
    join: '2026-08-03',
    bank: true,
    status: 'PROBATION',
    probationEnd: '2026-09-18',
    manager: 'EMP-005',
  },
];

const FIRST = [
  'Ananya',
  'Rohan',
  'Kavya',
  'Vikram',
  'Sneha',
  'Aditya',
  'Diya',
  'Manish',
  'Riya',
  'Sahil',
  'Pooja',
  'Nikhil',
  'Tanvi',
  'Yash',
  'Ira',
  'Harsh',
  'Neha',
  'Varun',
  'Sara',
  'Kabir',
  'Anjali',
  'Om',
  'Zara',
  'Rehan',
  'Lakshmi',
  'Siddharth',
  'Naina',
  'Rudra',
  'Aisha',
  'Gaurav',
  'Mira',
  'Parth',
];
const LAST = [
  'Verma',
  'Nair',
  'Iyer',
  'Kulkarni',
  'Bhatt',
  'Chauhan',
  'Menon',
  'Rao',
  'Kapoor',
  'Pillai',
  'Sinha',
  'Trivedi',
  'Banerjee',
  'Deshmukh',
  'Malhotra',
  'Bose',
];

const POS_BY_DEP: Record<string, string[]> = {
  'dep-eng': ['jp-swe', 'jp-sse', 'jp-fe', 'jp-qa', 'jp-devops'],
  'dep-prd': ['jp-pd', 'jp-pm'],
  'dep-sls': ['jp-se', 'jp-sm'],
  'dep-ops': ['jp-oa', 'jp-om'],
  'dep-fin': ['jp-fa', 'jp-acc'],
  'dep-hr': ['jp-hrb'],
  'dep-mkt': ['jp-mm', 'jp-ca'],
  'dep-sup': ['jp-sup'],
};
const DEP_WEIGHTS = [
  'dep-eng',
  'dep-eng',
  'dep-eng',
  'dep-sls',
  'dep-sls',
  'dep-ops',
  'dep-prd',
  'dep-fin',
  'dep-mkt',
  'dep-sup',
  'dep-hr',
];

function initials(first: string, last: string) {
  return (first[0] + last[0]).toUpperCase();
}

function makeEmployee(s: Story, index: number): Employee {
  return {
    id: s.id,
    employeeCode: s.id,
    firstName: s.first,
    lastName: s.last,
    fullName: `${s.first} ${s.last}`,
    initials: initials(s.first, s.last),
    email: s.email ?? `${s.first.toLowerCase()}.${s.last.toLowerCase()}@peoplepay360.com`,
    phone: `+91 9${String(800000000 + index * 137711).slice(0, 9)}`,
    departmentId: s.dep,
    jobPositionId: s.pos,
    managerId: s.manager ?? null,
    employeeType: s.type ?? 'FULL_TIME',
    status: s.status ?? 'ACTIVE',
    joinDate: s.join,
    exitDate: null,
    probationEndDate: s.probationEnd ?? null,
    workingScheduleId: s.dep === 'dep-sup' ? 'sch-shift' : 'sch-std',
    bank: s.bank
      ? {
          accountName: `${s.first} ${s.last}`,
          accountNumberMasked: `••••${1000 + index * 7}`,
          ifsc: pick(['HDFC0001234', 'ICIC0004567', 'SBIN0007788', 'UTIB0002211']),
          bankName: pick(['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank']),
          verifiedAt: '2026-01-05T10:00:00+05:30',
        }
      : null,
    panMasked: s.bank ? `••••${2000 + index}F` : null,
    version: 1,
  };
}

const generated: Story[] = [];
for (let i = 0; i < 32; i++) {
  const dep = DEP_WEIGHTS[i % DEP_WEIGHTS.length];
  const pos = pick(POS_BY_DEP[dep]);
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 5 + 3) % LAST.length];
  generated.push({
    id: `EMP-${String(11 + i).padStart(3, '0')}`,
    first,
    last,
    dep,
    pos,
    wage: between(38, 96) * 1000,
    join: toISO(new Date(2021 + between(0, 4), between(0, 11), between(1, 28))),
    bank: true,
    type: i % 11 === 0 ? 'CONTRACT' : i % 7 === 0 ? 'PART_TIME' : 'FULL_TIME',
  });
}

const allStories = [...STORY, ...generated];
export const employees: Employee[] = allStories.map(makeEmployee);

const managerByDept: Record<string, string> = {
  'dep-eng': 'EMP-005',
  'dep-prd': 'EMP-002',
  'dep-sls': 'EMP-009',
  'dep-ops': 'EMP-004',
  'dep-fin': 'EMP-006',
  'dep-hr': 'EMP-007',
  'dep-mkt': 'EMP-013',
  'dep-sup': 'EMP-014',
};
for (const e of employees) {
  if (!e.managerId) {
    const m = managerByDept[e.departmentId];
    e.managerId = m && m !== e.id ? m : null;
  }
}

/* ── users ─────────────────────────────────────────────────── */

export const users: User[] = [
  {
    id: 'usr-emp',
    email: 'aarav.patel@peoplepay360.com',
    role: 'EMPLOYEE',
    employeeId: 'EMP-001',
    displayName: 'Aarav Patel',
    initials: 'AP',
    isActive: true,
  },
  {
    id: 'usr-hr',
    email: 'priya.desai@peoplepay360.com',
    role: 'HR_MANAGER',
    employeeId: 'EMP-007',
    displayName: 'Priya Desai',
    initials: 'PD',
    isActive: true,
  },
  {
    id: 'usr-pu',
    email: 'isha.mehta@peoplepay360.com',
    role: 'HR_PAYROLL_USER',
    employeeId: 'EMP-006',
    displayName: 'Isha Mehta',
    initials: 'IM',
    isActive: true,
  },
  {
    id: 'usr-pm',
    email: 'maitri.shah@peoplepay360.com',
    role: 'HR_PAYROLL_MANAGER',
    employeeId: 'EMP-002',
    displayName: 'Maitri Shah',
    initials: 'MS',
    isActive: true,
  },
  {
    id: 'usr-admin',
    email: 'admin@peoplepay360.com',
    role: 'ADMIN',
    employeeId: null,
    displayName: 'System Administrator',
    initials: 'SA',
    isActive: true,
  },
];

/* ── salary structure & rules ──────────────────────────────── */

export const salaryStructures: SalaryStructure[] = [
  {
    id: 'str-reg',
    name: 'Regular Employee 2026',
    code: 'REGULAR_2026',
    description: 'Standard monthly structure: basic, HRA, fixed allowance, unpaid-leave deduction.',
    isActive: true,
    version: 1,
  },
];

export const salaryRules: SalaryRule[] = [
  {
    id: 'sr-basic',
    structureId: 'str-reg',
    code: 'BASIC',
    name: 'Basic Salary',
    category: 'BASIC',
    sequence: 10,
    type: 'FORMULA',
    amount: null,
    percentage: null,
    baseCode: null,
    formula: 'WAGE',
    conditionFormula: null,
    isActive: true,
    ruleVersion: 1,
  },
  {
    id: 'sr-hra',
    structureId: 'str-reg',
    code: 'HRA',
    name: 'House Rent Allowance',
    category: 'ALLOWANCES',
    sequence: 20,
    type: 'PERCENTAGE',
    amount: null,
    percentage: '20',
    baseCode: 'BASIC',
    formula: null,
    conditionFormula: null,
    isActive: true,
    ruleVersion: 1,
  },
  {
    id: 'sr-allow',
    structureId: 'str-reg',
    code: 'ALLOWANCE',
    name: 'Fixed Allowance',
    category: 'ALLOWANCES',
    sequence: 30,
    type: 'FIXED',
    amount: '3000.00',
    percentage: null,
    baseCode: null,
    formula: null,
    conditionFormula: null,
    isActive: true,
    ruleVersion: 1,
  },
  {
    id: 'sr-gross',
    structureId: 'str-reg',
    code: 'GROSS',
    name: 'Gross Salary',
    category: 'GROSS',
    sequence: 40,
    type: 'FORMULA',
    amount: null,
    percentage: null,
    baseCode: null,
    formula: 'BASIC + HRA + ALLOWANCE',
    conditionFormula: null,
    isActive: true,
    ruleVersion: 1,
  },
  {
    id: 'sr-unpaid',
    structureId: 'str-reg',
    code: 'UNPAID_LEAVE',
    name: 'Unpaid Leave Deduction',
    category: 'DEDUCTIONS',
    sequence: 50,
    type: 'FORMULA',
    amount: null,
    percentage: null,
    baseCode: null,
    formula: '(BASIC / EXPECTED_DAYS) * UNPAID_LEAVE_DAYS',
    conditionFormula: null,
    isActive: true,
    ruleVersion: 1,
  },
  {
    id: 'sr-net',
    structureId: 'str-reg',
    code: 'NET',
    name: 'Net Salary',
    category: 'NET',
    sequence: 60,
    type: 'FORMULA',
    amount: null,
    percentage: null,
    baseCode: null,
    formula: 'GROSS - UNPAID_LEAVE',
    conditionFormula: null,
    isActive: true,
    ruleVersion: 1,
  },
];

/* ── contracts ─────────────────────────────────────────────── */

export const contracts: Contract[] = allStories.map((s, i) => ({
  id: `ct-${s.id}`,
  contractRef: `CT-${200 + i + 1}`,
  employeeId: s.id,
  startDate: '2026-01-01',
  endDate: s.contractEnd ?? '2026-12-31',
  departmentId: s.dep,
  jobPositionId: s.pos,
  employeeType: s.type ?? 'FULL_TIME',
  wage: `${s.wage}.00`,
  salaryStructureId: 'str-reg',
  workingScheduleId: s.dep === 'dep-sup' ? 'sch-shift' : 'sch-std',
  status: 'ACTIVE',
  notes: '',
  version: 1,
}));

// A historical contract for Aarav, so "compensation history" and
// "historical payroll uses the historical contract" are demonstrable.
contracts.push({
  id: 'ct-EMP-001-prev',
  contractRef: 'CT-118',
  employeeId: 'EMP-001',
  startDate: '2024-03-11',
  endDate: '2025-12-31',
  departmentId: 'dep-eng',
  jobPositionId: 'jp-swe',
  employeeType: 'FULL_TIME',
  wage: '48000.00',
  salaryStructureId: 'str-reg',
  workingScheduleId: 'sch-std',
  status: 'EXPIRED',
  notes: 'Superseded by CT-201 on annual revision.',
  version: 1,
});

/* ── leave ─────────────────────────────────────────────────── */

export const leaveTypes: LeaveType[] = [
  {
    id: 'lt-annual',
    name: 'Annual Leave',
    code: 'ANNUAL',
    isPaid: true,
    requiresAllocation: true,
    allowNegativeBalance: false,
    carryForwardMax: 10,
    accrualPerMonth: 2,
    colorToken: 'var(--mark-1)',
  },
  {
    id: 'lt-sick',
    name: 'Sick Leave',
    code: 'SICK',
    isPaid: true,
    requiresAllocation: true,
    allowNegativeBalance: false,
    carryForwardMax: 0,
    accrualPerMonth: 0.5,
    colorToken: 'var(--mark-3)',
  },
  {
    id: 'lt-comp',
    name: 'Comp Off',
    code: 'COMPOFF',
    isPaid: true,
    requiresAllocation: true,
    allowNegativeBalance: false,
    carryForwardMax: 5,
    accrualPerMonth: 0,
    colorToken: 'var(--mark-2)',
  },
  {
    id: 'lt-unpaid',
    name: 'Unpaid Leave',
    code: 'UNPAID',
    isPaid: false,
    requiresAllocation: false,
    allowNegativeBalance: true,
    carryForwardMax: 0,
    accrualPerMonth: 0,
    colorToken: 'var(--mark-4)',
  },
];

export const leaveAllocations: LeaveAllocation[] = [];
for (const e of employees) {
  leaveAllocations.push(
    {
      id: `la-${e.id}-annual`,
      employeeId: e.id,
      leaveTypeId: 'lt-annual',
      allocated: 24,
      used: between(4, 12),
      carriedForward: 0,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    },
    {
      id: `la-${e.id}-sick`,
      employeeId: e.id,
      leaveTypeId: 'lt-sick',
      allocated: 8,
      used: between(0, 4),
      carriedForward: 0,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    },
    {
      id: `la-${e.id}-comp`,
      employeeId: e.id,
      leaveTypeId: 'lt-comp',
      allocated: 4,
      used: between(0, 3),
      carriedForward: 0,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    },
  );
}

export const leaveRequests: LeaveRequest[] = [
  {
    id: 'LR-101',
    employeeId: 'EMP-002',
    leaveTypeId: 'lt-unpaid',
    fromDate: '2026-09-08',
    toDate: '2026-09-09',
    halfDayStart: false,
    halfDayEnd: false,
    days: 2,
    reason: 'Personal travel, no balance remaining.',
    status: 'APPROVED',
    approverId: 'usr-hr',
    decidedAt: '2026-09-01T11:20:00+05:30',
    decisionNote: null,
    autoDecidedBy: null,
    createdAt: '2026-08-28T09:12:00+05:30',
  },
  {
    id: 'LR-102',
    employeeId: 'EMP-007',
    leaveTypeId: 'lt-annual',
    fromDate: '2026-09-15',
    toDate: '2026-09-16',
    halfDayStart: false,
    halfDayEnd: false,
    days: 2,
    reason: 'Family function.',
    status: 'PENDING',
    approverId: null,
    decidedAt: null,
    decisionNote: null,
    autoDecidedBy: null,
    createdAt: '2026-09-02T15:41:00+05:30',
  },
  {
    id: 'LR-103',
    employeeId: 'EMP-010',
    leaveTypeId: 'lt-sick',
    fromDate: '2026-09-10',
    toDate: '2026-09-10',
    halfDayStart: false,
    halfDayEnd: false,
    days: 1,
    reason: 'Fever.',
    status: 'PENDING',
    approverId: null,
    decidedAt: null,
    decisionNote: null,
    autoDecidedBy: null,
    createdAt: '2026-09-04T08:05:00+05:30',
  },
  {
    id: 'LR-104',
    employeeId: 'EMP-009',
    leaveTypeId: 'lt-annual',
    fromDate: '2026-09-22',
    toDate: '2026-09-24',
    halfDayStart: false,
    halfDayEnd: false,
    days: 3,
    reason: 'Short holiday.',
    status: 'PENDING',
    approverId: null,
    decidedAt: null,
    decisionNote: null,
    autoDecidedBy: null,
    createdAt: '2026-09-03T18:22:00+05:30',
  },
  {
    id: 'LR-105',
    employeeId: 'EMP-014',
    leaveTypeId: 'lt-annual',
    fromDate: '2026-08-19',
    toDate: '2026-08-21',
    halfDayStart: false,
    halfDayEnd: false,
    days: 3,
    reason: 'Annual leave.',
    status: 'APPROVED',
    approverId: 'usr-hr',
    decidedAt: '2026-08-12T10:00:00+05:30',
    decisionNote: null,
    autoDecidedBy: null,
    createdAt: '2026-08-10T10:00:00+05:30',
  },
  {
    id: 'LR-106',
    employeeId: 'EMP-021',
    leaveTypeId: 'lt-unpaid',
    fromDate: '2026-07-13',
    toDate: '2026-07-14',
    halfDayStart: false,
    halfDayEnd: false,
    days: 2,
    reason: 'Extended personal leave.',
    status: 'APPROVED',
    approverId: 'usr-hr',
    decidedAt: '2026-07-06T12:00:00+05:30',
    decisionNote: null,
    autoDecidedBy: null,
    createdAt: '2026-07-02T12:00:00+05:30',
  },
];

/* ── attendance ────────────────────────────────────────────── */

/** Canonical missing-checkout record. One date, used by the blocker, the
 *  table, the calendar and the anomaly list — they can never disagree. */
export const MISSING_CHECKOUT = { employeeId: 'EMP-004', date: '2026-09-03' as ISODate };

/** Punch history retained for the narrated story. One month keeps the whole
 *  dataset inside the 5,000-record demo budget while still filling the
 *  attendance list, calendar and anomaly views. */
const HISTORY_START: ISODate = '2026-08-03';

export const attendance: Attendance[] = [];
{
  let seq = 0;
  for (const e of employees) {
    const ctx = scheduleContext(e.workingScheduleId);
    for (const day of eachDay(HISTORY_START, TODAY)) {
      if (!isWorkingDay(day, ctx)) continue;
      if (day < e.joinDate) continue;
      seq += 1;
      const id = `att-${e.id}-${day}`;

      if (e.id === MISSING_CHECKOUT.employeeId && day === MISSING_CHECKOUT.date) {
        attendance.push({
          id,
          employeeId: e.id,
          date: day,
          checkIn: '09:30',
          checkOut: null,
          workedMinutes: 0,
          status: 'MISSING_CHECKOUT',
          source: 'SELF',
          correctionReason: null,
          correctedById: null,
          correctedAt: null,
        });
        continue;
      }

      const roll = rnd();
      let inMin = 540 + between(-8, 22); // around 09:00
      let outMin = 1080 + between(-10, 35); // around 18:00
      let status: Attendance['status'] = 'PRESENT';

      if (roll > 0.965) {
        status = 'ABSENT';
        attendance.push({
          id,
          employeeId: e.id,
          date: day,
          checkIn: null,
          checkOut: null,
          workedMinutes: 0,
          status,
          source: 'SYSTEM',
          correctionReason: null,
          correctedById: null,
          correctedAt: null,
        });
        continue;
      }
      if (roll > 0.9) {
        inMin = 540 + between(20, 55);
        status = 'LATE';
      } else if (roll < 0.06) {
        outMin = 1080 + between(70, 160);
        status = 'OVERTIME';
      }
      attendance.push({
        id,
        employeeId: e.id,
        date: day,
        checkIn: fromMinutes(inMin),
        checkOut: fromMinutes(outMin),
        workedMinutes: outMin - inMin - 60,
        status,
        source: 'SELF',
        correctionReason: null,
        correctedById: null,
        correctedAt: null,
      });
    }
  }
  // Aarav is checked in right now (today is a Saturday — unscheduled cover),
  // so the employee "Check out" flow is immediately demonstrable.
  attendance.push({
    id: `att-EMP-001-${TODAY}`,
    employeeId: 'EMP-001',
    date: TODAY,
    checkIn: '09:15',
    checkOut: null,
    workedMinutes: 0,
    status: 'PRESENT',
    source: 'SELF',
    correctionReason: null,
    correctedById: null,
    correctedAt: null,
  });
  void seq;
}

/* ── payruns ───────────────────────────────────────────────── */

function makePayrun(anchor: ISODate, status: Payrun['status']): Payrun {
  const start = monthStart(anchor);
  const end = monthEnd(anchor);
  const expected = countWorkingDays(start, end, scheduleContext('sch-std'));
  return {
    id: `PR-${start.slice(0, 7)}`,
    name: `${monthLabel(start)} Payroll`,
    periodStart: start,
    periodEnd: end,
    salaryStructureId: 'str-reg',
    status,
    isFrozen: status === 'PAID',
    frozenAt: status === 'PAID' ? `${end}T18:00:00+05:30` : null,
    reopenReason: null,
    expectedWorkDays: expected,
    computedAt: status === 'DRAFT' ? null : `${addDays(end, -2)}T14:30:00+05:30`,
    validatedAt: status === 'PAID' ? `${addDays(end, -1)}T11:00:00+05:30` : null,
    paidAt: status === 'PAID' ? `${end}T16:00:00+05:30` : null,
    inputSnapshotHash: null,
    createdById: 'usr-pm',
    employeeIds: employees
      .filter((e) => e.joinDate <= end && e.status !== 'EXITED')
      .map((e) => e.id),
    version: 1,
  };
}

export const payruns: Payrun[] = [
  makePayrun('2026-06-15', 'PAID'),
  makePayrun('2026-07-15', 'PAID'),
  makePayrun('2026-08-15', 'PAID'),
  makePayrun('2026-09-15', 'DRAFT'),
];

export const ACTIVE_PAYRUN_ID = 'PR-2026-09';

/** Dev Patel carries a seeded duplicate payslip in the September run. */
export const DUPLICATE_PAYSLIP_EMPLOYEE = 'EMP-005';

/* ── documents, checklists, requests ───────────────────────── */

export const documents: EmployeeDocument[] = [
  {
    id: 'doc-1',
    employeeId: 'EMP-001',
    contractId: 'ct-EMP-001',
    category: 'CONTRACT',
    fileName: 'Employment_Contract_CT-201.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 184320,
    visibility: 'SELF',
    uploadedAt: '2026-01-02T09:00:00+05:30',
    uploadedById: 'usr-hr',
    acknowledgedAt: '2026-01-03T10:12:00+05:30',
  },
  {
    id: 'doc-2',
    employeeId: 'EMP-001',
    contractId: null,
    category: 'LETTER',
    fileName: 'Salary_Revision_2026.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 96140,
    visibility: 'SELF',
    uploadedAt: '2026-01-02T09:05:00+05:30',
    uploadedById: 'usr-hr',
    acknowledgedAt: null,
  },
  {
    id: 'doc-3',
    employeeId: 'EMP-003',
    contractId: null,
    category: 'IDENTITY',
    fileName: 'PAN_Card.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 51200,
    visibility: 'HR',
    uploadedAt: '2025-11-18T12:00:00+05:30',
    uploadedById: 'usr-hr',
    acknowledgedAt: null,
  },
  {
    id: 'doc-4',
    employeeId: null,
    contractId: null,
    category: 'POLICY',
    fileName: 'Leave_Policy_2026.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 220160,
    visibility: 'SELF',
    uploadedAt: '2026-01-01T09:00:00+05:30',
    uploadedById: 'usr-hr',
    acknowledgedAt: null,
  },
];

export const checklists: ChecklistInstance[] = [
  {
    id: 'chk-EMP-010',
    employeeId: 'EMP-010',
    type: 'ONBOARDING',
    createdAt: '2026-08-03T09:00:00+05:30',
    items: [
      {
        id: 'ci-1',
        label: 'Signed contract on file',
        ownerRole: 'HR_MANAGER',
        dueDate: '2026-08-10',
        blocksPayroll: true,
        completedAt: '2026-08-05T10:00:00+05:30',
        completedById: 'usr-hr',
      },
      {
        id: 'ci-2',
        label: 'Bank details verified',
        ownerRole: 'HR_PAYROLL_USER',
        dueDate: '2026-08-12',
        blocksPayroll: true,
        completedAt: '2026-08-11T14:00:00+05:30',
        completedById: 'usr-pu',
      },
      {
        id: 'ci-3',
        label: 'Working schedule assigned',
        ownerRole: 'HR_MANAGER',
        dueDate: '2026-08-08',
        blocksPayroll: true,
        completedAt: '2026-08-04T11:00:00+05:30',
        completedById: 'usr-hr',
      },
      {
        id: 'ci-4',
        label: 'Laptop and access provisioned',
        ownerRole: 'ADMIN',
        dueDate: '2026-08-06',
        blocksPayroll: false,
        completedAt: '2026-08-05T16:30:00+05:30',
        completedById: 'usr-admin',
      },
      {
        id: 'ci-5',
        label: 'Probation review scheduled',
        ownerRole: 'HR_MANAGER',
        dueDate: '2026-09-11',
        blocksPayroll: false,
        completedAt: null,
        completedById: null,
      },
    ],
  },
  {
    id: 'chk-EMP-003',
    employeeId: 'EMP-003',
    type: 'ONBOARDING',
    createdAt: '2025-11-17T09:00:00+05:30',
    items: [
      {
        id: 'ci-6',
        label: 'Signed contract on file',
        ownerRole: 'HR_MANAGER',
        dueDate: '2025-11-24',
        blocksPayroll: true,
        completedAt: '2025-11-20T10:00:00+05:30',
        completedById: 'usr-hr',
      },
      {
        id: 'ci-7',
        label: 'Bank details verified',
        ownerRole: 'HR_PAYROLL_USER',
        dueDate: '2025-11-26',
        blocksPayroll: true,
        completedAt: null,
        completedById: null,
      },
    ],
  },
];

export const profileChangeRequests: ProfileChangeRequest[] = [
  {
    id: 'PRQ-1',
    employeeId: 'EMP-001',
    field: 'Bank account number',
    currentValue: '••••4821',
    requestedValue: '••••7814',
    status: 'PENDING',
    requestedAt: '2026-09-03T10:15:00+05:30',
    decidedById: null,
    decidedAt: null,
    decisionNote: null,
  },
  {
    id: 'PRQ-2',
    employeeId: 'EMP-012',
    field: 'Phone number',
    currentValue: '+91 98220 11223',
    requestedValue: '+91 98220 55441',
    status: 'PENDING',
    requestedAt: '2026-09-04T16:40:00+05:30',
    decidedById: null,
    decidedAt: null,
    decisionNote: null,
  },
];

export const salaryChangeRequests: SalaryChangeRequest[] = [
  {
    id: 'SCR-1',
    employeeId: 'EMP-001',
    contractId: 'ct-EMP-001',
    currentWage: '60000.00',
    requestedWage: '66000.00',
    effectiveFrom: '2026-10-01',
    reason: 'Annual performance revision — exceeded expectations.',
    status: 'PENDING',
    requestedById: 'usr-hr',
    decidedById: null,
    decidedAt: null,
    createdAt: '2026-09-02T12:00:00+05:30',
  },
];

export const auditSeed: AuditEvent[] = [
  {
    id: 'aud-1',
    at: '2026-08-31T16:00:00+05:30',
    actorId: 'usr-pm',
    actorName: 'Maitri Shah',
    actorRole: 'HR_PAYROLL_MANAGER',
    action: 'PAYRUN_PAID',
    entityType: 'Payrun',
    entityId: 'PR-2026-08',
    summary: 'August 2026 Payroll marked paid',
  },
  {
    id: 'aud-2',
    at: '2026-08-30T11:00:00+05:30',
    actorId: 'usr-pm',
    actorName: 'Maitri Shah',
    actorRole: 'HR_PAYROLL_MANAGER',
    action: 'PAYRUN_VALIDATED',
    entityType: 'Payrun',
    entityId: 'PR-2026-08',
    summary: 'August 2026 Payroll validated with 0 blockers',
  },
  {
    id: 'aud-3',
    at: '2026-08-12T10:00:00+05:30',
    actorId: 'usr-hr',
    actorName: 'Priya Desai',
    actorRole: 'HR_MANAGER',
    action: 'LEAVE_APPROVED',
    entityType: 'LeaveRequest',
    entityId: 'LR-105',
    summary: 'Annual leave approved, 3 days',
  },
];

export const settingsSeed = {
  autoFreezeAtCutoff: false,
  requireReopenReason: true,
  varianceThresholdPercent: 25,
  autoApproveShortSickLeave: false,
  lateGraceMinutes: 15,
  excessiveHoursPerDay: 11,
  inputCutoffDay: 25,
  payDay: 30,
};

/** Contract-expiry horizon used consistently by alerts and the contracts table. */
export const EXPIRY_HORIZON_DAYS = 30;

export const nextPeriodAnchor = addMonths(monthStart(TODAY), 1);
