import { useMemo, useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import { can } from '@shared/permissions';
import { DAY_SHORT, countWorkingDays, formatDate, minutesOfDay } from '@shared/dates';
import { useStore } from '@/store/store';
import { activePayrun, currentRole } from '@/store/selectors';
import { scheduleCtx } from '@/store/payroll';
import { batchAssignSchedule } from '@/store/actions';
import { Page } from '@/app/Page';
import { Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { Select } from '@/ui/form';
import { ConfirmDialog } from '@/ui/overlays';
import { ConsequencePreview } from '@/ui/feedback';
import { useToast } from '@/ui/toast';

export function SchedulesPage() {
  const state = useStore();
  const role = currentRole(state);
  const toast = useToast();
  const payrun = activePayrun(state);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [targetDept, setTargetDept] = useState('');

  const canEdit = can(role, 'schedule.write');

  const affected = useMemo(
    () => state.employees.filter((e) => e.departmentId === targetDept && e.status !== 'ARCHIVED'),
    [state.employees, targetDept],
  );

  return (
    <Page title="Working schedules" crumbs={['People', 'Schedules']}>
      <div className="grid grid-3">
        <Metric label="Schedules" value={state.schedules.length} icon={CalendarDays} tone="brand" />
        <Metric
          label="Working days this period"
          value={payrun.expectedWorkDays}
          sub={`${formatDate(payrun.periodStart)} → ${formatDate(payrun.periodEnd)}`}
        />
        <Metric label="Company holidays" value={state.holidays.length} />
      </div>

      {state.schedules.map((sch) => {
        const assigned = state.employees.filter((e) => e.workingScheduleId === sch.id && e.status !== 'ARCHIVED');
        const ctx = scheduleCtx(state, sch.id);
        const expected = countWorkingDays(payrun.periodStart, payrun.periodEnd, ctx);
        return (
          <Card
            key={sch.id}
            title={sch.name}
            subtitle={`${sch.hoursPerWeek} hours per week · ${expected} working days in ${formatDate(payrun.periodStart).slice(3)}`}
            action={
              <div className="row gap2">
                <Chip tone="info" icon={Users}>
                  {assigned.length} assigned
                </Chip>
                {canEdit && (
                  <Button size="sm" onClick={() => setAssigning(sch.id)}>
                    Assign a department
                  </Button>
                )}
              </div>
            }
          >
            <div className="scroll-x">
              <div className="sched">
                <div className="sched-cell head">Day</div>
                {DAY_SHORT.map((d) => (
                  <div className="sched-cell head" key={d}>
                    {d}
                  </div>
                ))}
                <div className="sched-cell head" style={{ textAlign: 'right' }}>
                  Hours
                </div>
                {DAY_SHORT.map((_, dow) => {
                  const line = sch.lines.find((l) => l.dayOfWeek === dow);
                  return (
                    <div className={line ? 'sched-cell on' : 'sched-cell off'} key={dow}>
                      {line ? `${line.start}–${line.end}` : 'Off'}
                    </div>
                  );
                })}
                <div className="sched-cell head" style={{ textAlign: 'right' }}>
                  Break
                </div>
                {DAY_SHORT.map((_, dow) => {
                  const line = sch.lines.find((l) => l.dayOfWeek === dow);
                  return (
                    <div className={line ? 'sched-cell' : 'sched-cell off'} key={`b-${dow}`}>
                      {line ? `${line.breakMinutes}m` : '—'}
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="muted mt3" style={{ fontSize: 'var(--fs-xs)' }}>
              Weekly hours are computed from the lines above minus breaks
              {' — '}
              {sch.lines
                .map((l) => (minutesOfDay(l.end) - minutesOfDay(l.start) - l.breakMinutes) / 60)
                .reduce((a, b) => a + b, 0)}
              h. Payroll derives expected working days from this schedule and the holiday calendar,
              never from a fixed number.
            </p>
          </Card>
        );
      })}

      <Card title="Holiday calendar" subtitle="Excluded from expected days and from leave-day counting">
        {state.holidays.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No holidays configured" />
        ) : (
          <div className="grid grid-4">
            {state.holidays.map((h) => (
              <div className="info-item" key={h.id}>
                <label>{formatDate(h.date)}</label>
                <div className="v">{h.name}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={assigning !== null}
        onClose={() => setAssigning(null)}
        onConfirm={() => {
          const r = batchAssignSchedule(
            affected.map((e) => e.id),
            assigning!,
          );
          toast.result(r);
          setAssigning(null);
          setTargetDept('');
        }}
        title="Assign schedule to a department"
        confirmLabel={`Assign to ${affected.length} employees`}
      >
        <div className="col gap4">
          <Select
            label="Department"
            required
            placeholder="Select a department"
            value={targetDept}
            onChange={(e) => setTargetDept(e.target.value)}
            options={state.departments.map((d) => ({ value: d.id, label: d.name }))}
          />
          {targetDept && (
            <ConsequencePreview
              rows={[
                { label: 'Employees affected', before: '—', after: String(affected.length) },
                {
                  label: 'New schedule',
                  before: 'Various',
                  after: state.schedules.find((s) => s.id === assigning)?.name ?? '',
                },
                {
                  label: 'Expected days this period',
                  before: String(payrun.expectedWorkDays),
                  after: String(
                    countWorkingDays(payrun.periodStart, payrun.periodEnd, scheduleCtx(state, assigning ?? 'sch-std')),
                  ),
                },
              ]}
              note="Changing a schedule changes expected working days, which changes any per-day payroll calculation on the next compute."
            />
          )}
        </div>
      </ConfirmDialog>
    </Page>
  );
}
