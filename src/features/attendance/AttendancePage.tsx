import { useMemo, useState } from 'react';
import {
  Clock,
  LogIn,
  LogOut,
  Pencil,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { can, isSelfScoped } from '@shared/permissions';
import {
  DAY_SHORT,
  dayOfWeek,
  eachDay,
  formatDate,
  formatDuration,
  monthEnd,
  monthStart,
} from '@shared/dates';
import type { Attendance } from '@shared/types';
import { useStore } from '@/store/store';
import { currentEmployee, currentRole, empById } from '@/store/selectors';
import { applyRegularizations, checkIn, checkOut, correctAttendance } from '@/store/actions';
import { Page } from '@/app/Page';
import { Avatar, Banner, Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { Checkbox, SearchBox, Select, TextArea, TextInput } from '@/ui/form';
import { DataTable, type Column } from '@/ui/table';
import { Modal } from '@/ui/overlays';
import { Tabs, TabPanel } from '@/ui/feedback';
import { useToast } from '@/ui/toast';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  PRESENT: 'success',
  LATE: 'warning',
  EARLY_EXIT: 'warning',
  OVERTIME: 'info',
  MISSING_CHECKOUT: 'danger',
  ABSENT: 'danger',
  HOLIDAY: 'neutral',
  WEEKLY_OFF: 'neutral',
  ON_LEAVE: 'info',
};

export function AttendancePage() {
  const state = useStore();
  const role = currentRole(state);
  const toast = useToast();
  const selfOnly = isSelfScoped(role);
  const me = currentEmployee(state);

  const [tab, setTab] = useState('records');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState(monthStart(state.today));
  const [to, setTo] = useState(monthEnd(state.today));
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [correcting, setCorrecting] = useState<Attendance | null>(null);
  const [selectedProposals, setSelectedProposals] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const scoped = useMemo(
    () => (selfOnly ? state.attendance.filter((a) => a.employeeId === me?.id) : state.attendance),
    [state.attendance, selfOnly, me],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter((a) => {
        if (a.date < from || a.date > to) return false;
        if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
        if (!q) return true;
        return (empById(state, a.employeeId)?.fullName.toLowerCase().includes(q) ?? false);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [scoped, query, from, to, statusFilter, state]);

  const anomalies = useMemo(
    () =>
      scoped.filter(
        (a) =>
          a.status === 'MISSING_CHECKOUT' ||
          a.status === 'LATE' ||
          a.status === 'ABSENT' ||
          (a.checkIn && !a.checkOut) ||
          a.workedMinutes > state.settings.excessiveHoursPerDay * 60,
      ),
    [scoped, state.settings.excessiveHoursPerDay],
  );

  const proposals = useMemo(() => scoped.filter((a) => a.checkIn && !a.checkOut), [scoped]);

  const open = me ? state.attendance.find((a) => a.employeeId === me.id && a.checkIn && !a.checkOut) : undefined;
  const todayRecord = me ? state.attendance.find((a) => a.employeeId === me.id && a.date === state.today) : undefined;

  const columns: Column<Attendance>[] = [
    ...(selfOnly
      ? []
      : [
          {
            key: 'employee',
            header: 'Employee',
            sortValue: (a: Attendance) => empById(state, a.employeeId)?.fullName ?? '',
            render: (a: Attendance) => {
              const e = empById(state, a.employeeId);
              return (
                <span className="person">
                  <Avatar initials={e?.initials ?? '??'} size="sm" tone={a.status === 'MISSING_CHECKOUT' ? 'warning' : undefined} />
                  <span className="person-name truncate">{e?.fullName}</span>
                </span>
              );
            },
          } satisfies Column<Attendance>,
        ]),
    { key: 'date', header: 'Date', sortValue: (a) => a.date, render: (a) => formatDate(a.date) },
    { key: 'in', header: 'Check in', render: (a) => <span className="mono">{a.checkIn ?? '—'}</span> },
    {
      key: 'out',
      header: 'Check out',
      render: (a) =>
        a.checkOut ? (
          <span className="mono">{a.checkOut}</span>
        ) : a.checkIn ? (
          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Missing</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'worked',
      header: 'Worked',
      align: 'right',
      sortValue: (a) => a.workedMinutes,
      render: (a) => formatDuration(a.workedMinutes),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (a) => a.status,
      render: (a) => (
        <Chip tone={STATUS_TONE[a.status] ?? 'neutral'} dot>
          {a.status.replace(/_/g, ' ').toLowerCase()}
        </Chip>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      secondary: true,
      render: (a) =>
        a.correctedById ? (
          <span className="muted" title={a.correctionReason ?? ''}>
            corrected by {empById(state, state.users.find((u) => u.id === a.correctedById)?.employeeId ?? '')?.firstName ?? 'HR'}
          </span>
        ) : (
          <span className="muted">{a.source.toLowerCase()}</span>
        ),
    },
    ...(can(role, 'attendance.correct')
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (a: Attendance) => (
              <Button size="sm" icon={Pencil} onClick={() => setCorrecting(a)}>
                Correct
              </Button>
            ),
          } satisfies Column<Attendance>,
        ]
      : []),
  ];

  return (
    <Page
      title={selfOnly ? 'My attendance' : 'Attendance'}
      crumbs={['Time', 'Attendance']}
      actions={
        me &&
        can(role, 'attendance.self.punch') && (
          <>
            {open ? (
              <Button
                variant="danger"
                icon={LogOut}
                pending={busy}
                onClick={() => {
                  setBusy(true);
                  toast.result(checkOut(me.id));
                  setBusy(false);
                }}
              >
                Check out
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={LogIn}
                pending={busy}
                disabled={Boolean(todayRecord?.checkOut)}
                onClick={() => {
                  setBusy(true);
                  toast.result(checkIn(me.id));
                  setBusy(false);
                }}
              >
                Check in
              </Button>
            )}
          </>
        )
      }
    >
      {open && (
        <Banner tone="info" icon={Clock} title="You are currently checked in">
          Since {open.checkIn} on {formatDate(open.date)}. Worked time is derived from the timestamps
          when you check out.
        </Banner>
      )}

      <div className="grid grid-4">
        <Metric label="Records in range" value={rows.length} icon={Clock} tone="brand" />
        <Metric label="Present" value={rows.filter((a) => a.status === 'PRESENT').length} tone="success" />
        <Metric label="Late" value={rows.filter((a) => a.status === 'LATE').length} tone="warning" />
        <Metric
          label="Missing checkout"
          value={rows.filter((a) => a.checkIn && !a.checkOut).length}
          tone={rows.some((a) => a.checkIn && !a.checkOut) ? 'danger' : undefined}
        />
      </div>

      <Card padding="flush">
        <div style={{ padding: '0 var(--s4)' }}>
          <Tabs
            ariaLabel="Attendance views"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'records', label: 'Records', count: rows.length },
              { key: 'calendar', label: 'Calendar' },
              { key: 'anomalies', label: 'Anomalies', count: anomalies.length },
              ...(can(role, 'attendance.correct')
                ? [{ key: 'regularize', label: 'Regularization', count: proposals.length }]
                : []),
            ]}
          />
        </div>

        <div style={{ padding: 'var(--s4)' }}>
          <TabPanel tabKey="records" active={tab}>
            <div className="toolbar mb4">
              {!selfOnly && <SearchBox value={query} onChange={setQuery} placeholder="Search employee…" />}
              <TextInput type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <TextInput type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
              <Select
                size2="sm"
                aria-label="Filter status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: 'ALL', label: 'All statuses' },
                  { value: 'PRESENT', label: 'Present' },
                  { value: 'LATE', label: 'Late' },
                  { value: 'OVERTIME', label: 'Overtime' },
                  { value: 'MISSING_CHECKOUT', label: 'Missing checkout' },
                  { value: 'ABSENT', label: 'Absent' },
                ]}
              />
            </div>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(a) => a.id}
              pageSize={12}
              caption="Attendance records"
              empty={
                <EmptyState
                  icon={Clock}
                  title="No attendance in this range"
                  description="Widen the date range or clear the status filter."
                />
              }
              mobileCard={(a) => (
                <>
                  <div className="row between">
                    <strong>{formatDate(a.date)}</strong>
                    <Chip tone={STATUS_TONE[a.status] ?? 'neutral'} dot>
                      {a.status.replace(/_/g, ' ').toLowerCase()}
                    </Chip>
                  </div>
                  <dl className="reccard-kv">
                    {!selfOnly && (
                      <>
                        <dt>Employee</dt>
                        <dd>{empById(state, a.employeeId)?.fullName}</dd>
                      </>
                    )}
                    <dt>In / out</dt>
                    <dd className="mono">
                      {a.checkIn ?? '—'} → {a.checkOut ?? 'missing'}
                    </dd>
                    <dt>Worked</dt>
                    <dd className="mono">{formatDuration(a.workedMinutes)}</dd>
                  </dl>
                </>
              )}
            />
          </TabPanel>

          <TabPanel tabKey="calendar" active={tab}>
            <CalendarView records={scoped} month={state.today} />
          </TabPanel>

          <TabPanel tabKey="anomalies" active={tab}>
            {anomalies.length === 0 ? (
              <EmptyState icon={Clock} title="No anomalies" description="Every record in range is complete and within thresholds." />
            ) : (
              <div className="col gap2">
                {anomalies.slice(0, 25).map((a) => {
                  const e = empById(state, a.employeeId);
                  const reason =
                    a.checkIn && !a.checkOut
                      ? 'Missing checkout'
                      : a.status === 'LATE'
                        ? 'Late arrival'
                        : a.status === 'ABSENT'
                          ? 'Absent without leave'
                          : `Worked ${formatDuration(a.workedMinutes)} — above the ${state.settings.excessiveHoursPerDay}h threshold`;
                  return (
                    <div className="blocker" data-sev={a.checkIn && !a.checkOut ? 'blocking' : 'warn'} key={a.id}>
                      <span className="blocker-icon" aria-hidden>
                        <TriangleAlert size={16} />
                      </span>
                      <div className="blocker-body">
                        <div className="blocker-title">
                          {selfOnly ? formatDate(a.date) : `${e?.fullName} · ${formatDate(a.date)}`}
                        </div>
                        <div className="blocker-desc">{reason}</div>
                      </div>
                      {can(role, 'attendance.correct') && (
                        <Button size="sm" onClick={() => setCorrecting(a)}>
                          Correct
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabPanel>

          <TabPanel tabKey="regularize" active={tab}>
            {proposals.length === 0 ? (
              <EmptyState icon={Sparkles} title="Nothing to regularize" description="Every check-in has a matching checkout." />
            ) : (
              <div className="col gap3">
                <Banner tone="info" icon={Sparkles} title="Proposed corrections">
                  Each proposal uses the employee&apos;s own scheduled end time as evidence. Nothing is
                  applied until you accept it, and every acceptance is audited.
                </Banner>
                <div className="col gap2">
                  {proposals.map((a) => {
                    const e = empById(state, a.employeeId);
                    const sch = state.schedules.find((s) => s.id === e?.workingScheduleId);
                    const line = sch?.lines.find((l) => l.dayOfWeek === dayOfWeek(a.date)) ?? sch?.lines[0];
                    return (
                      <div
                        className="row between wrap gap3"
                        key={a.id}
                        style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 'var(--s3)' }}
                      >
                        <Checkbox
                          checked={selectedProposals.has(a.id)}
                          onChange={(c) =>
                            setSelectedProposals((s) => {
                              const next = new Set(s);
                              if (c) next.add(a.id);
                              else next.delete(a.id);
                              return next;
                            })
                          }
                          label={
                            <span>
                              <strong>{e?.fullName}</strong> · {formatDate(a.date)}
                            </span>
                          }
                        />
                        <span className="muted mono" style={{ fontSize: 'var(--fs-sm)' }}>
                          {a.checkIn} → propose {line?.end ?? '18:00'} ({sch?.name})
                        </span>
                      </div>
                    );
                  })}
                </div>
                <Button
                  variant="primary"
                  disabled={selectedProposals.size === 0}
                  onClick={() => {
                    const r = applyRegularizations([...selectedProposals]);
                    toast.result(r);
                    setSelectedProposals(new Set());
                  }}
                >
                  Accept {selectedProposals.size || ''} proposal{selectedProposals.size === 1 ? '' : 's'}
                </Button>
              </div>
            )}
          </TabPanel>
        </div>
      </Card>

      {correcting && <CorrectDialog record={correcting} onClose={() => setCorrecting(null)} />}
    </Page>
  );
}

function CalendarView({ records, month }: { records: Attendance[]; month: string }) {
  const start = monthStart(month);
  const end = monthEnd(month);
  const days = eachDay(start, end);
  const pad = dayOfWeek(start);
  const byDate = new Map<string, Attendance[]>();
  for (const r of records) {
    byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  }

  return (
    <div className="scroll-x">
      <div className="cal">
        {DAY_SHORT.map((d) => (
          <div className="cal-head" key={d}>
            {d}
          </div>
        ))}
        {Array.from({ length: pad }, (_, i) => (
          <div className="cal-day pad" key={`pad-${i}`} />
        ))}
        {days.map((d) => {
          const recs = byDate.get(d) ?? [];
          const missing = recs.filter((r) => r.checkIn && !r.checkOut).length;
          const late = recs.filter((r) => r.status === 'LATE').length;
          const present = recs.filter((r) => r.status === 'PRESENT' || r.status === 'OVERTIME').length;
          return (
            <div className={`cal-day${d === month ? ' today' : ''}`} key={d}>
              <span className="d">{Number(d.slice(-2))}</span>
              {present > 0 && (
                <span className="cal-mark" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                  {present} present
                </span>
              )}
              {late > 0 && (
                <span className="cal-mark" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
                  {late} late
                </span>
              )}
              {missing > 0 && (
                <span className="cal-mark" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                  {missing} open
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CorrectDialog({ record, onClose }: { record: Attendance; onClose: () => void }) {
  const toast = useToast();
  const [checkInVal, setCheckIn] = useState(record.checkIn ?? '09:00');
  const [checkOutVal, setCheckOut] = useState(record.checkOut ?? '18:00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Attendance"
      title={`Correct ${formatDate(record.date)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              const r = correctAttendance(record.id, { checkIn: checkInVal, checkOut: checkOutVal }, reason);
              if (!r.ok) {
                setError({ field: r.field, message: r.error });
                return;
              }
              toast.success(r.message);
              onClose();
            }}
          >
            Save correction
          </Button>
        </>
      }
    >
      <div className="col gap4">
        <div className="grid grid-2">
          <TextInput label="Check in" type="time" value={checkInVal} onChange={(e) => setCheckIn(e.target.value)} />
          <TextInput
            label="Check out"
            type="time"
            value={checkOutVal}
            error={error?.field === 'checkOut' ? error.message : undefined}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </div>
        <TextArea
          label="Correction reason"
          required
          rows={2}
          value={reason}
          error={error?.field === 'reason' ? error.message : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="field-hint">
          Worked hours are recomputed from the timestamps. The correction is recorded against your
          name in the audit trail.
        </p>
      </div>
    </Modal>
  );
}
