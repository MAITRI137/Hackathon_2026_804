import { hash } from 'argon2';
import { PrismaClient } from '@prisma/client';

import * as demo from '../../src/data/seed.js';
import { DEMO_ORGANISATION_ID } from '../../server/src/config/tenant.js';
import { evaluatePayrun, persistPayslips } from '../../server/src/services/payrun-decision.js';
import { DEFAULT_SETTINGS } from '../../server/src/services/settings.js';
import { buildScaleData, TARGET_RECORDS } from './scale.js';

const prisma = new PrismaClient();

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** Insert in bounded batches so a 20,000-row table never becomes one giant statement. */
async function createInChunks<T>(
  label: string,
  rows: T[],
  insert: (batch: T[]) => Promise<unknown>,
  size = 2000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
  if (rows.length) console.info(`  ${label}: ${rows.length}`);
}

const scale = buildScaleData();
const instant = (value: string | null | undefined) => (value ? new Date(value) : null);

async function clearDatabase() {
  await prisma.idempotencyKey.deleteMany();
  await prisma.documentGeneration.deleteMany();
  await prisma.demoPaymentItem.deleteMany();
  await prisma.demoPaymentBatch.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.savedView.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.checklistInstance.deleteMany();
  await prisma.checklistTemplate.deleteMany();
  await prisma.profileChangeRequest.deleteMany();
  await prisma.salaryChangeRequest.deleteMany();
  await prisma.appSetting.deleteMany();
  await prisma.organisationMembership.deleteMany();
  await prisma.payrollDecisionReceipt.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.document.deleteMany();
  await prisma.payslipLine.deleteMany();
  await prisma.payslip.deleteMany();
  await prisma.payrunEmployee.deleteMany();
  await prisma.payrun.deleteMany();
  await prisma.salaryRule.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.leaveAllocation.deleteMany();
  await prisma.leaveType.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.employeeBankDetail.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.updateMany({ data: { managerId: null } });
  await prisma.employee.deleteMany();
  await prisma.scheduleLine.deleteMany();
  await prisma.workingSchedule.deleteMany();
  await prisma.jobPosition.deleteMany();
  await prisma.department.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.salaryStructure.deleteMany();
}

/**
 * The tenant every business row belongs to, and the policy the server reads.
 *
 * Settings are seeded as a row rather than left to a default so that the value
 * an administrator sees on the settings screen is the value the server used —
 * there is no second copy of the policy in the browser.
 */
async function seedOrganisation() {
  await prisma.organisation.upsert({
    where: { id: DEMO_ORGANISATION_ID },
    create: {
      id: DEMO_ORGANISATION_ID,
      name: 'PeoplePay360 Demo Organisation',
      code: 'PP360',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    },
    update: {},
  });
  await prisma.appSetting.upsert({
    where: { organisationId_key: { organisationId: DEMO_ORGANISATION_ID, key: 'operating-policy' } },
    create: { organisationId: DEMO_ORGANISATION_ID, key: 'operating-policy', value: DEFAULT_SETTINGS },
    update: { value: DEFAULT_SETTINGS },
  });
  await prisma.checklistTemplate.createMany({
    data: [
      {
        id: 'clt-onboarding',
        organisationId: DEMO_ORGANISATION_ID,
        name: 'Standard onboarding',
        kind: 'ONBOARDING',
        items: [
          { label: 'Signed contract on file', ownerRole: 'HR_MANAGER', dueOffsetDays: 7 },
          { label: 'Bank details verified', ownerRole: 'HR_PAYROLL_USER', dueOffsetDays: 10 },
          { label: 'Working schedule assigned', ownerRole: 'HR_MANAGER', dueOffsetDays: 3 },
          { label: 'Laptop and access provisioned', ownerRole: 'ADMIN', dueOffsetDays: 2 },
        ],
      },
      {
        id: 'clt-offboarding',
        organisationId: DEMO_ORGANISATION_ID,
        name: 'Standard offboarding',
        kind: 'OFFBOARDING',
        items: [
          { label: 'Final payroll input cutoff confirmed', ownerRole: 'HR_PAYROLL_USER', dueOffsetDays: -5 },
          { label: 'Assets returned', ownerRole: 'ADMIN', dueOffsetDays: 0 },
          { label: 'Access revoked', ownerRole: 'ADMIN', dueOffsetDays: 0 },
          { label: 'Relieving letter issued', ownerRole: 'HR_MANAGER', dueOffsetDays: 7 },
        ],
      },
    ],
    skipDuplicates: true,
  });
}

async function seedReferenceData() {
  await prisma.salaryStructure.createMany({ data: demo.salaryStructures });

  await prisma.department.createMany({
    data: demo.departments.map((department) => ({
      id: department.id,
      name: department.name,
      code: department.code,
      parentId: department.parentId ?? null,
      monthlyBudget: department.monthlyBudget,
    })),
  });

  await prisma.jobPosition.createMany({ data: demo.jobPositions });
  await prisma.workingSchedule.createMany({
    data: demo.schedules.map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      timezone: schedule.timezone,
      hoursPerWeek: schedule.hoursPerWeek,
      isActive: schedule.isActive,
    })),
  });
  await prisma.scheduleLine.createMany({
    data: demo.schedules.flatMap((schedule) =>
      schedule.lines.map((line) => ({
        scheduleId: schedule.id,
        dayOfWeek: line.dayOfWeek,
        startTime: line.start,
        endTime: line.end,
        breakMinutes: line.breakMinutes,
      })),
    ),
  });
  await prisma.holiday.createMany({
    data: demo.holidays.map((holiday) => ({ ...holiday, date: date(holiday.date) })),
  });
}

async function seedPeople() {
  await prisma.employee.createMany({
    data: demo.employees.map((employee) => ({
      id: employee.id,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      fullName: employee.fullName,
      initials: employee.initials,
      email: employee.email,
      phone: employee.phone,
      departmentId: employee.departmentId,
      jobPositionId: employee.jobPositionId,
      employeeType: employee.employeeType,
      status: employee.status,
      joinDate: date(employee.joinDate),
      exitDate: employee.exitDate ? date(employee.exitDate) : null,
      probationEndDate: employee.probationEndDate ? date(employee.probationEndDate) : null,
      workingScheduleId: employee.workingScheduleId,
      panMasked: employee.panMasked ?? null,
      version: employee.version,
      managerId: null,
    })),
  });

  for (const employee of demo.employees) {
    if (employee.managerId) {
      await prisma.employee.update({
        where: { id: employee.id },
        data: { managerId: employee.managerId },
      });
    }
  }

  await prisma.employeeBankDetail.createMany({
    data: demo.employees.flatMap((employee) =>
      employee.bank
        ? [
            {
              employeeId: employee.id,
              ...employee.bank,
              verifiedAt: instant(employee.bank.verifiedAt),
            },
          ]
        : [],
    ),
  });

  for (const department of demo.departments) {
    if (department.managerId) {
      await prisma.department.update({
        where: { id: department.id },
        data: { managerId: department.managerId },
      });
    }
  }

  const passwordHash = await hash('PeoplePay360!2026');
  await prisma.user.createMany({
    data: demo.users.map((user) => ({
      ...user,
      employeeId: user.employeeId ?? null,
      passwordHash,
      lastLoginAt: instant(user.lastLoginAt),
    })),
  });
  await prisma.organisationMembership.createMany({
    data: demo.users.map((user) => ({
      id: `orgm-${user.id}`,
      organisationId: DEMO_ORGANISATION_ID,
      userId: user.id,
      role: user.role,
    })),
    skipDuplicates: true,
  });
}

async function seedPayrollInputs() {
  await prisma.salaryRule.createMany({ data: demo.salaryRules });
  await prisma.contract.createMany({
    data: demo.contracts.map((contract) => ({
      ...contract,
      startDate: date(contract.startDate),
      endDate: contract.endDate ? date(contract.endDate) : null,
    })),
  });
  await prisma.attendance.createMany({
    data: demo.attendance.map((record) => ({
      ...record,
      date: date(record.date),
      correctedAt: instant(record.correctedAt),
    })),
  });
  await prisma.leaveType.createMany({ data: demo.leaveTypes });
  await prisma.leaveAllocation.createMany({
    data: demo.leaveAllocations.map((allocation) => ({
      ...allocation,
      validFrom: date(allocation.validFrom),
      validTo: date(allocation.validTo),
    })),
  });
  await prisma.leaveRequest.createMany({
    data: demo.leaveRequests.map((request) => ({
      ...request,
      fromDate: date(request.fromDate),
      toDate: date(request.toDate),
      decidedAt: instant(request.decidedAt),
      createdAt: new Date(request.createdAt),
    })),
  });
}

async function seedPayrunsAndEvidence() {
  await prisma.payrun.createMany({
    data: demo.payruns.map((payrun) => ({
      id: payrun.id,
      name: payrun.name,
      periodStart: date(payrun.periodStart),
      periodEnd: date(payrun.periodEnd),
      salaryStructureId: payrun.salaryStructureId,
      status: payrun.status,
      isFrozen: payrun.isFrozen,
      frozenAt: instant(payrun.frozenAt),
      reopenReason: payrun.reopenReason,
      expectedWorkDays: payrun.expectedWorkDays,
      computedAt: instant(payrun.computedAt),
      validatedAt: instant(payrun.validatedAt),
      paidAt: instant(payrun.paidAt),
      inputSnapshotHash: payrun.inputSnapshotHash,
      createdById: payrun.createdById,
      version: payrun.version,
    })),
  });
  // Every payrun covers the whole organisation as it stood in that period.
  // Someone who had not joined yet is not payable for it — including them
  // would both overstate payroll and pay a person before their start date.
  for (const payrun of demo.payruns) {
    const members = scale.allEmployeeIds.filter(
      (employeeId) => (scale.joinDates[employeeId] ?? '9999-12-31') <= payrun.periodEnd,
    );
    await createInChunks(`payrun ${payrun.id} members`, members, (batch) =>
      prisma.payrunEmployee.createMany({
        data: batch.map((employeeId) => ({ payrunId: payrun.id, employeeId })),
      }),
    );
  }
  await prisma.document.createMany({
    data: demo.documents.map((document) => ({
      ...document,
      employeeId: document.employeeId ?? null,
      contractId: document.contractId ?? null,
      uploadedAt: new Date(document.uploadedAt),
      acknowledgedAt: instant(document.acknowledgedAt),
    })),
  });
  await prisma.auditEvent.createMany({
    data: demo.auditSeed.map((event) => ({
      ...event,
      at: new Date(event.at),
    })),
  });
}

/**
 * Grow the story organisation to full scale. The 42 narrated people keep every
 * hand-authored detail; the rest of the workforce is generated deterministically
 * so payroll, reports and the operations console all run against real volume.
 */
async function seedScaleWorkforce() {
  console.info(
    `Growing the organisation to a ${TARGET_RECORDS.toLocaleString('en-IN')}-record dataset ` +
      `(${(demo.employees.length + scale.employees.length).toLocaleString('en-IN')} employees)...`,
  );

  await createInChunks('employees', scale.employees, (batch) =>
    prisma.employee.createMany({
      data: batch.map((employee) => ({
        id: employee.id,
        employeeCode: employee.employeeCode,
        firstName: employee.firstName,
        lastName: employee.lastName,
        fullName: employee.fullName,
        initials: employee.initials,
        email: employee.email,
        phone: employee.phone,
        departmentId: employee.departmentId,
        jobPositionId: employee.jobPositionId,
        employeeType: employee.employeeType,
        status: employee.status,
        joinDate: date(employee.joinDate),
        exitDate: null,
        probationEndDate: employee.probationEndDate ? date(employee.probationEndDate) : null,
        workingScheduleId: employee.workingScheduleId,
        panMasked: employee.panMasked,
        version: 1,
        managerId: null,
      })),
    }),
  );

  await createInChunks('bank details', scale.employees, (batch) =>
    prisma.employeeBankDetail.createMany({
      data: batch.map((employee) => ({
        employeeId: employee.id,
        ...employee.bank,
        verifiedAt: new Date('2026-01-05T10:00:00.000Z'),
      })),
    }),
  );

  await createInChunks('contracts', scale.contracts, (batch) =>
    prisma.contract.createMany({
      data: batch.map((contract) => ({
        ...contract,
        startDate: date(contract.startDate),
        endDate: contract.endDate ? date(contract.endDate) : null,
      })),
    }),
  );

  await createInChunks('attendance', scale.attendance, (batch) =>
    prisma.attendance.createMany({
      data: batch.map((record) => ({ ...record, date: date(record.date) })),
    }),
  );

  await createInChunks('leave allocations', scale.leaveAllocations, (batch) =>
    prisma.leaveAllocation.createMany({
      data: batch.map((allocation) => ({
        ...allocation,
        validFrom: date(allocation.validFrom),
        validTo: date(allocation.validTo),
      })),
    }),
  );

  // Budget = the department's wage bill plus allowances, with 6% headroom.
  for (const [departmentId, wageBill] of Object.entries(scale.departmentWageBill)) {
    const budget = Math.round(wageBill * 1.2 * 1.06);
    await prisma.department.update({
      where: { id: departmentId },
      data: { monthlyBudget: budget.toFixed(2) },
    });
  }

  await createInChunks('leave requests', scale.leaveRequests, (batch) =>
    prisma.leaveRequest.createMany({
      data: batch.map((request) => ({
        ...request,
        fromDate: date(request.fromDate),
        toDate: date(request.toDate),
        decidedAt: new Date(request.decidedAt),
        createdAt: new Date(request.createdAt),
      })),
    }),
  );
}

/**
 * Compute and store the payslips for every period that already closed.
 *
 * A paid month has to be able to answer "what did this person earn and why"
 * from the database — the same rows a live compute writes, produced by the same
 * engine. Recomputing them here rather than authoring numbers by hand is what
 * makes the seeded history genuinely explainable instead of decorative.
 */
async function seedHistoricalPayslips() {
  const closed = await prisma.payrun.findMany({
    where: { status: { in: ['COMPUTED', 'VALIDATED', 'PAID'] } },
    orderBy: { periodStart: 'asc' },
  });
  const preparer = demo.users.find((user) => user.role === 'HR_PAYROLL_USER') ?? demo.users[0]!;
  const approver = demo.users.find((user) => user.role === 'HR_PAYROLL_MANAGER') ?? demo.users[0]!;

  for (const payrun of closed) {
    const evaluation = await evaluatePayrun(prisma, payrun.id);
    const written = await persistPayslips(prisma, evaluation);
    await prisma.payslip.updateMany({
      where: { payrunId: payrun.id, status: 'COMPUTED' },
      data: { status: payrun.status === 'PAID' ? 'PAID' : payrun.status === 'VALIDATED' ? 'VALIDATED' : 'COMPUTED' },
    });
    if (payrun.status === 'PAID') {
      await prisma.payslip.updateMany({
        where: { payrunId: payrun.id, status: 'PAID' },
        data: { paymentStatus: 'PAID', deliveryStatus: 'SENT', deliveredAt: payrun.paidAt },
      });
    }
    await prisma.payrun.update({
      where: { id: payrun.id },
      data: { inputSnapshotHash: evaluation.snapshotHash },
    });
    if (payrun.status === 'VALIDATED' || payrun.status === 'PAID') {
      await prisma.payrollDecisionReceipt.upsert({
        where: { payrunId: payrun.id },
        create: {
          payrunId: payrun.id,
          snapshotHash: evaluation.snapshotHash,
          readinessScore: evaluation.readinessScore,
          blockingExceptionCount: evaluation.issues.length,
          employeeCount: evaluation.computedCount,
          netTotal: evaluation.netTotal,
          preparedById: preparer.id,
          preparedByName: preparer.displayName,
          preparedAt: payrun.computedAt ?? payrun.periodEnd,
          validatedById: approver.id,
          validatedByName: approver.displayName,
          validatedAt: payrun.validatedAt,
          paidById: payrun.paidAt ? approver.id : null,
          paidByName: payrun.paidAt ? approver.displayName : null,
          paidAt: payrun.paidAt,
        },
        update: { snapshotHash: evaluation.snapshotHash, netTotal: evaluation.netTotal },
      });
    }
    console.info(`  payslips ${payrun.id}: ${written}`);
  }
}

async function main() {
  await clearDatabase();
  await seedOrganisation();
  await seedReferenceData();
  await seedPeople();
  // Leave types and salary rules must exist before the scaled workforce
  // references them, so payroll inputs are seeded first.
  await seedPayrollInputs();
  await seedScaleWorkforce();
  await seedPayrunsAndEvidence();
  await seedHistoricalPayslips();

  // Count every persisted table, so the reported total is the real dataset
  // size rather than a subset of the tables that happen to be interesting.
  const counts = {
    users: await prisma.user.count(),
    departments: await prisma.department.count(),
    jobPositions: await prisma.jobPosition.count(),
    workingSchedules: await prisma.workingSchedule.count(),
    scheduleLines: await prisma.scheduleLine.count(),
    holidays: await prisma.holiday.count(),
    employees: await prisma.employee.count(),
    bankDetails: await prisma.employeeBankDetail.count(),
    contracts: await prisma.contract.count(),
    attendance: await prisma.attendance.count(),
    leaveTypes: await prisma.leaveType.count(),
    leaveAllocations: await prisma.leaveAllocation.count(),
    leaveRequests: await prisma.leaveRequest.count(),
    salaryStructures: await prisma.salaryStructure.count(),
    salaryRules: await prisma.salaryRule.count(),
    payruns: await prisma.payrun.count(),
    payrunMemberships: await prisma.payrunEmployee.count(),
    payslips: await prisma.payslip.count(),
    payslipLines: await prisma.payslipLine.count(),
    decisionReceipts: await prisma.payrollDecisionReceipt.count(),
    documents: await prisma.document.count(),
    checklistTemplates: await prisma.checklistTemplate.count(),
    appSettings: await prisma.appSetting.count(),
    memberships: await prisma.organisationMembership.count(),
    auditEvents: await prisma.auditEvent.count(),
  };

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

  console.info('Seeded PeoplePay360:');
  for (const [table, value] of Object.entries(counts)) {
    console.info(`  ${table.padEnd(18)} ${String(value).padStart(6)}`);
  }
  console.info(`  ${'TOTAL RECORDS'.padEnd(18)} ${String(total).padStart(6)}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
