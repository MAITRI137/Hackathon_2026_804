import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';

const origin = 'http://localhost:5173';
const demoPassword = 'PeoplePay360!2026';

async function signedInAgent(email: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ email, password: demoPassword })
    .expect(200);
  return agent;
}

describe('attendance workflow', () => {
  let originalRecord: Awaited<ReturnType<typeof prisma.attendance.findUniqueOrThrow>>;
  let createdAttendanceId: string | null = null;

  beforeEach(async () => {
    originalRecord = await prisma.attendance.findUniqueOrThrow({ where: { id: 'att-EMP-001-2026-09-05' } });
  });

  afterEach(async () => {
    await prisma.attendance.deleteMany({
      where: { OR: [{ id: { startsWith: 'test-attendance-' } }, ...(createdAttendanceId ? [{ id: createdAttendanceId }] : [])] },
    });
    await prisma.auditEvent.deleteMany({ where: { action: { in: ['ATTENDANCE_CHECKED_IN', 'ATTENDANCE_CHECKED_OUT', 'ATTENDANCE_CORRECTED', 'ATTENDANCE_REGULARIZED'] } } });
    await prisma.attendance.update({
      where: { id: originalRecord.id },
      data: {
        checkIn: originalRecord.checkIn,
        checkOut: originalRecord.checkOut,
        workedMinutes: originalRecord.workedMinutes,
        status: originalRecord.status,
        source: originalRecord.source,
        correctionReason: originalRecord.correctionReason,
        correctedById: originalRecord.correctedById,
        correctedAt: originalRecord.correctedAt,
        version: originalRecord.version,
      },
    });
  });

  it('persists an employee check-in with a server date and audit event', async () => {
    const agent = await signedInAgent('aarav.patel@peoplepay360.com');
    const currentDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .reduce<Record<string, string>>((parts, part) => ({ ...parts, [part.type]: part.value }), {});
    const date = `${currentDate.year}-${currentDate.month}-${currentDate.day}`;

    const response = await agent.post('/api/attendance/check-in').set('Origin', origin).expect(201);

    expect(response.body.data).toMatchObject({
      employeeId: 'EMP-001',
      date,
      checkOut: null,
      source: 'SELF',
    });
    createdAttendanceId = response.body.data.id;
    expect(await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: 'EMP-001', date: new Date(`${date}T00:00:00.000Z`) } } })).toMatchObject({
      checkIn: expect.stringMatching(/^\d{2}:\d{2}$/),
      source: 'SELF',
    });
    expect(await prisma.auditEvent.findFirst({ where: { entityId: response.body.data.id, action: 'ATTENDANCE_CHECKED_IN' } })).toMatchObject({ actorId: 'usr-emp' });
  });

  it('uses the employee schedule break when an authorised manager corrects checkout', async () => {
    const manager = await signedInAgent('priya.desai@peoplepay360.com');
    const record = await prisma.attendance.findUniqueOrThrow({ where: { id: 'att-EMP-001-2026-09-05' } });

    const response = await manager
      .patch(`/api/attendance/${record.id}/correction`)
      .set('Origin', origin)
      .send({ checkIn: '09:30', checkOut: '18:00', reason: 'Employee supplied the missing checkout time.', version: 1 })
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: record.id,
      checkIn: '09:30',
      checkOut: '18:00',
      workedMinutes: 510,
      source: 'MANAGER',
    });
    expect(await prisma.auditEvent.findFirst({ where: { entityId: record.id, action: 'ATTENDANCE_CORRECTED' } })).toBeTruthy();
  });

  it('rejects a correction by an employee and duplicate open attendance', async () => {
    const employee = await signedInAgent('aarav.patel@peoplepay360.com');
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date())
      .reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    await prisma.attendance.create({
      data: {
        id: `test-attendance-${Date.now()}`,
        employeeId: 'EMP-001',
        date: new Date(`${date}T00:00:00.000Z`),
        checkIn: '09:00',
        checkOut: null,
        workedMinutes: 0,
        status: 'MISSING_CHECKOUT',
        source: 'SELF',
      },
    });

    await employee
      .patch('/api/attendance/att-EMP-001-2026-09-05/correction')
      .set('Origin', origin)
      .send({ checkIn: '09:30', checkOut: '18:00', reason: 'Not allowed.', version: 1 })
      .expect(403);

    await employee.post('/api/attendance/check-in').set('Origin', origin).expect(409);
  });
});
