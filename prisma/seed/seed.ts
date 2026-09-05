import { hash } from 'argon2';
import { PrismaClient } from '@prisma/client';

import * as demo from '../../src/data/seed.js';

const prisma = new PrismaClient();

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const instant = (value: string | null | undefined) => (value ? new Date(value) : null);

async function clearDatabase() {
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
  await prisma.payrunEmployee.createMany({
    data: demo.payruns.flatMap((payrun) =>
      payrun.employeeIds.map((employeeId) => ({ payrunId: payrun.id, employeeId })),
    ),
  });
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

async function main() {
  await clearDatabase();
  await seedReferenceData();
  await seedPeople();
  await seedPayrollInputs();
  await seedPayrunsAndEvidence();

  const [users, departments, employees, contracts, attendance, payruns] = await prisma.$transaction(
    [
      prisma.user.count(),
      prisma.department.count(),
      prisma.employee.count(),
      prisma.contract.count(),
      prisma.attendance.count(),
      prisma.payrun.count(),
    ],
  );

  console.info(
    `Seeded PeoplePay360: ${users} users, ${departments} departments, ${employees} employees, ` +
      `${contracts} contracts, ${attendance} attendance records, ${payruns} payruns.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
