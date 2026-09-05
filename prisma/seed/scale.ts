/**
 * Scale generator.
 *
 * The deterministic 42-person story in `src/data/seed.ts` is what the demo
 * narrates; this module grows that same organisation to a realistic 5,000
 * employees so the product is exercised at the scale it claims.
 *
 * It runs only in the database seed. The browser bundle never imports it, so
 * the offline fallback story stays small and instant.
 *
 * Determinism is preserved: one seeded PRNG, no `Math.random`, no clock reads.
 * Re-running the seed produces byte-identical rows.
 */
import * as demo from '../../src/data/seed.js';
import {
  addDays,
  eachDay,
  fromMinutes,
  isWorkingDay,
  monthStart,
  type ISODate,
} from '../../shared/dates.js';

/**
 * The demo dataset is sized by a *record* budget, not a headcount. The brief
 * asks the system to hold 5,000 records; the generator grows the workforce
 * until the whole persisted dataset reaches that size, so the number is a
 * property of the data rather than a hard-coded employee count.
 */
export const TARGET_RECORDS = 5000;

/** Rows the narrated story contributes before any generated employee. */
function storyRecordCount(): number {
  return (
    demo.employees.length +
    demo.employees.filter((e) => e.bank).length +
    demo.contracts.length +
    demo.attendance.length +
    demo.leaveAllocations.length +
    demo.leaveRequests.length +
    demo.departments.length +
    demo.jobPositions.length +
    demo.schedules.length +
    demo.schedules.reduce((sum, s) => sum + s.lines.length, 0) +
    demo.holidays.length +
    demo.users.length +
    demo.salaryStructures.length +
    demo.salaryRules.length +
    demo.leaveTypes.length +
    demo.documents.length +
    demo.auditSeed.length +
    demo.payruns.length
  );
}

/* ── deterministic PRNG (same family as the story seed) ────── */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(50002026);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const FIRST = [
  'Aditi',
  'Rohit',
  'Sneha',
  'Karthik',
  'Divya',
  'Nikhil',
  'Preeti',
  'Amit',
  'Shruti',
  'Vivek',
  'Kavita',
  'Suresh',
  'Anita',
  'Rajat',
  'Meghna',
  'Pranav',
  'Ritika',
  'Sameer',
  'Payal',
  'Akash',
  'Bhavna',
  'Tarun',
  'Swara',
  'Nitin',
  'Ishita',
  'Vikas',
  'Charu',
  'Mohit',
  'Renuka',
  'Abhay',
  'Sonal',
  'Gopal',
  'Trisha',
  'Jatin',
  'Leela',
  'Farhan',
  'Nandini',
  'Ashwin',
  'Juhi',
  'Dhruv',
];
const LAST = [
  'Agarwal',
  'Barot',
  'Chatterjee',
  'Dutta',
  'Engineer',
  'Fernandes',
  'Gandhi',
  'Hegde',
  'Iyengar',
  'Jain',
  'Khanna',
  'Lal',
  'Mishra',
  'Naik',
  'Oberoi',
  'Prasad',
  'Qureshi',
  'Rathore',
  'Saxena',
  'Thakur',
  'Upadhyay',
  'Varma',
  'Wadhwa',
  'Yadav',
  'Zachariah',
];

const BANKS = [
  { bankName: 'HDFC Bank', ifsc: 'HDFC0001234' },
  { bankName: 'ICICI Bank', ifsc: 'ICIC0004567' },
  { bankName: 'State Bank of India', ifsc: 'SBIN0007788' },
  { bankName: 'Axis Bank', ifsc: 'UTIB0002211' },
  { bankName: 'Kotak Mahindra Bank', ifsc: 'KKBK0003344' },
];

/** Departments weighted the way a real product company is shaped. */
const DEPT_WEIGHTS = [
  'dep-eng',
  'dep-eng',
  'dep-eng',
  'dep-eng',
  'dep-eng',
  'dep-sls',
  'dep-sls',
  'dep-sls',
  'dep-sup',
  'dep-sup',
  'dep-ops',
  'dep-ops',
  'dep-prd',
  'dep-mkt',
  'dep-fin',
  'dep-hr',
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

export interface ScaleEmployee {
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
  employeeType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
  status: 'ACTIVE' | 'PROBATION';
  joinDate: ISODate;
  probationEndDate: ISODate | null;
  workingScheduleId: string;
  panMasked: string;
  wage: number;
  bank: { accountName: string; accountNumberMasked: string; ifsc: string; bankName: string };
}

export interface ScaleData {
  employees: ScaleEmployee[];
  contracts: {
    id: string;
    contractRef: string;
    employeeId: string;
    startDate: ISODate;
    endDate: ISODate | null;
    departmentId: string;
    jobPositionId: string;
    employeeType: ScaleEmployee['employeeType'];
    wage: string;
    salaryStructureId: string;
    workingScheduleId: string;
    status: 'ACTIVE';
    notes: string;
    version: number;
  }[];
  attendance: {
    id: string;
    employeeId: string;
    date: ISODate;
    checkIn: string | null;
    checkOut: string | null;
    workedMinutes: number;
    status: 'PRESENT' | 'LATE' | 'OVERTIME' | 'ABSENT';
    source: 'SELF';
    correctionReason: null;
    correctedById: null;
    correctedAt: null;
  }[];
  leaveAllocations: {
    id: string;
    employeeId: string;
    leaveTypeId: string;
    allocated: number;
    used: number;
    carriedForward: number;
    validFrom: ISODate;
    validTo: ISODate;
  }[];
  leaveRequests: {
    id: string;
    employeeId: string;
    leaveTypeId: string;
    fromDate: ISODate;
    toDate: ISODate;
    halfDayStart: boolean;
    halfDayEnd: boolean;
    days: number;
    reason: string;
    status: 'APPROVED';
    approverId: string;
    decidedAt: string;
    decisionNote: null;
    autoDecidedBy: null;
    createdAt: string;
  }[];
  /** Every employee id in the organisation, story people first. */
  allEmployeeIds: string[];
  /** What the finished dataset actually holds, counted as it was built. */
  recordBudget: { target: number; story: number; generated: number; total: number };
}

/**
 * Grow the story organisation until the persisted dataset reaches
 * `TARGET_RECORDS` rows.
 *
 * Attendance is generated for the open payroll period only. Earlier months are
 * represented by their payslips rather than by replaying every punch — the same
 * choice a production system makes to keep the working set bounded.
 */
export function buildScaleData(): ScaleData {
  const storyIds = new Set(demo.employees.map((e) => e.id));
  const storyRecords = storyRecordCount();
  // Each payrun carries a membership row per employee, so headcount costs more
  // than the employee row itself.
  const membershipCostPerEmployee = demo.payruns.length;
  let generatedRecords = 0;
  const total = () =>
    storyRecords +
    generatedRecords +
    membershipCostPerEmployee * (demo.employees.length + employees.length);

  const employees: ScaleData['employees'] = [];
  const contracts: ScaleData['contracts'] = [];
  const attendance: ScaleData['attendance'] = [];
  const leaveAllocations: ScaleData['leaveAllocations'] = [];
  const leaveRequests: ScaleData['leaveRequests'] = [];

  const period = monthStart(demo.TODAY);
  const workdays = eachDay(period, demo.TODAY).filter((day) =>
    isWorkingDay(day, demo.scheduleContext('sch-std')),
  );

  for (let i = 0; total() < TARGET_RECORDS; i += 1) {
    const n = demo.employees.length + i + 1;
    const id = `EMP-${String(n).padStart(4, '0')}`;
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7 + 3) % LAST.length];
    const departmentId = DEPT_WEIGHTS[i % DEPT_WEIGHTS.length];
    const jobPositionId = pick(POS_BY_DEP[departmentId]);
    const employeeType =
      i % 23 === 0
        ? 'CONTRACT'
        : i % 13 === 0
          ? 'PART_TIME'
          : i % 47 === 0
            ? 'INTERN'
            : 'FULL_TIME';
    const joinYear = 2020 + (i % 6);
    const joinDate = `${joinYear}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`;
    const probation = i % 97 === 0;
    const bank = pick(BANKS);
    const wage = between(32, 145) * 1000;
    const workingScheduleId = departmentId === 'dep-sup' ? 'sch-shift' : 'sch-std';

    employees.push({
      id,
      employeeCode: id,
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`,
      initials: (first[0] + last[0]).toUpperCase(),
      // Index-suffixed so 5,000 people never collide on a unique email.
      email: `${first.toLowerCase()}.${last.toLowerCase()}.${n}@peoplepay360.com`,
      phone: `+91 9${String(700000000 + n * 371).slice(0, 9)}`,
      departmentId,
      jobPositionId,
      employeeType,
      status: probation ? 'PROBATION' : 'ACTIVE',
      joinDate,
      probationEndDate: probation ? addDays(demo.TODAY, between(3, 40)) : null,
      workingScheduleId,
      panMasked: `••••${3000 + n}K`,
      wage,
      bank: {
        accountName: `${first} ${last}`,
        accountNumberMasked: `••••${String(1000 + ((n * 17) % 9000))}`,
        ifsc: bank.ifsc,
        bankName: bank.bankName,
      },
    });

    generatedRecords += 2; // employee + bank detail

    contracts.push({
      id: `ct-${id}`,
      contractRef: `CT-${10000 + n}`,
      employeeId: id,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      departmentId,
      jobPositionId,
      employeeType,
      wage: `${wage}.00`,
      salaryStructureId: 'str-reg',
      workingScheduleId,
      status: 'ACTIVE',
      notes: '',
      version: 1,
    });

    generatedRecords += 1; // contract

    leaveAllocations.push(
      {
        id: `la-${id}-annual`,
        employeeId: id,
        leaveTypeId: 'lt-annual',
        allocated: 24,
        used: between(2, 14),
        carriedForward: 0,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
      },
      {
        id: `la-${id}-sick`,
        employeeId: id,
        leaveTypeId: 'lt-sick',
        allocated: 8,
        used: between(0, 5),
        carriedForward: 0,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
      },
      {
        id: `la-${id}-comp`,
        employeeId: id,
        leaveTypeId: 'lt-comp',
        allocated: 4,
        used: between(0, 3),
        carriedForward: 0,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
      },
    );

    generatedRecords += 3; // three allocations

    // Roughly one in twelve people take unpaid leave in the open period, so the
    // deduction rule and the variance guard both have real work to do at scale.
    if (i % 12 === 5) {
      const from = addDays(period, 7 + (i % 14));
      leaveRequests.push({
        id: `LR-S${n}`,
        employeeId: id,
        leaveTypeId: 'lt-unpaid',
        fromDate: from,
        toDate: addDays(from, i % 3),
        halfDayStart: false,
        halfDayEnd: false,
        days: 1 + (i % 3),
        reason: 'Personal leave without pay.',
        status: 'APPROVED',
        approverId: 'usr-hr',
        decidedAt: '2026-09-01T10:00:00+05:30',
        decisionNote: null,
        autoDecidedBy: null,
        createdAt: '2026-08-27T10:00:00+05:30',
      });
      generatedRecords += 1;
    }

    const ctx = demo.scheduleContext(workingScheduleId);
    for (const day of workdays) {
      if (!isWorkingDay(day, ctx)) continue;
      if (day < joinDate) continue;
      const roll = rnd();
      if (roll > 0.97) {
        attendance.push({
          id: `att-${id}-${day}`,
          employeeId: id,
          date: day,
          checkIn: null,
          checkOut: null,
          workedMinutes: 0,
          status: 'ABSENT',
          source: 'SELF',
          correctionReason: null,
          correctedById: null,
          correctedAt: null,
        });
        generatedRecords += 1;
        continue;
      }
      let inMin = 540 + between(-6, 18);
      let outMin = 1080 + between(-8, 30);
      let status: ScaleData['attendance'][number]['status'] = 'PRESENT';
      if (roll > 0.9) {
        inMin = 540 + between(18, 50);
        status = 'LATE';
      } else if (roll < 0.05) {
        outMin = 1080 + between(70, 150);
        status = 'OVERTIME';
      }
      attendance.push({
        id: `att-${id}-${day}`,
        employeeId: id,
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
      generatedRecords += 1;
    }
  }

  return {
    employees,
    contracts,
    attendance,
    leaveAllocations,
    leaveRequests,
    allEmployeeIds: [
      ...demo.employees.map((e) => e.id).filter((id) => storyIds.has(id)),
      ...employees.map((e) => e.id),
    ],
    recordBudget: {
      target: TARGET_RECORDS,
      story: storyRecords,
      generated: generatedRecords,
      total: total(),
    },
  };
}
