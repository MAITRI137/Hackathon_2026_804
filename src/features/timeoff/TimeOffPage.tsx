import { useMemo, useState } from 'react';
import { CalendarOff, CalendarPlus, CircleCheck, Plus, X } from 'lucide-react';
import { can, isSelfScoped } from '@shared/permissions';
import {
  DAY_SHORT,
  dayOfWeek,
  eachDay,
  formatDate,
  monthEnd,
  monthStart,
  rangeOverlaps,
} from '@shared/dates';
import type { LeaveRequest } from '@shared/types';
import { useStore } from '@/store/store';
import {
  currentEmployee,
  currentRole,
  empById,
  leaveBalance,
  leaveTypeName,
} from '@/store/selectors';
import { cancelLeave, decideLeave, grantAllocation } from '@/store/actions';
import { Page } from '@/app/Page';
import { Avatar, Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { SearchBox, Select, TextInput } from '@/ui/form';
import { DataTable, type Column } from '@/ui/table';
import { ConfirmDialog, Modal } from '@/ui/overlays';
import { ConsequencePreview, Tabs, TabPanel } from '@/ui/feedback';
import { useToast } from '@/ui/toast';
import { RequestLeaveDialog } from './RequestLeaveDialog';

export function TimeOffPage() {
  const state = useStore();
  const role = currentRole(state);
  const toast = useToast();
  const selfOnly = isSelfScoped(role);
  const me = currentEmployee(state);

  const [tab, setTab] = useState('requests');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [requestOpen, setRequestOpen] = useState(false);
  const [refusing, setRefusing] = useState<LeaveRequest | null>(null);
  const [note, setNote] = useState('');
  const [granting, setGranting] = useState(false);
  const [grantForm, setGrantForm] = useState({ departmentId: '', leaveTypeId: 'lt-annual', days: '5' });

  const scoped = useMemo(
    () => (selfOnly ? state.leaveRequests.filter((r) => r.employeeId === me?.id) : state.leaveRequests),
    [state.leaveRequests, selfOnly, me],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter((r) => {
        if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
        if (!q) return true;
        return (
          (empById(state, r.employeeId)?.fullName.toLowerCase().includes(q) ?? false) ||
          leaveTypeName(state, r.leaveTypeId).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.fromDate.localeCompare(a.fromDate));
  }, [scoped, query, statusFilter, state]);

  const columns: Column<LeaveRequest>[] = [
    ...(selfOnly
      ? []
      : [
          {
            key: 'employee',
            header: 'Employee',
            sortValue: (r: LeaveRequest) => empById(state, r.employeeId)?.fullName ?? '',
            render: (r: LeaveRequest) => {
              const e = empById(state, r.employeeId);
              return (
                <span className="person">
                  <Avatar initials={e?.initials ?? '??'} size="sm" />
                  <span className="person-name truncate">{e?.fullName}</span>
                </span>
              );
            },
          } satisfies Column<LeaveRequest>,
        ]),
    {
      key: 'type',
      header: 'Type',
      sortValue: (r) => leaveTypeName(state, r.leaveTypeId),
      render: (r) => (
        <span className="row gap2">
          {leaveTypeName(state, r.leaveTypeId)}
          {r.autoDecidedBy && <Chip tone="info">auto</Chip>}
        </span>
      ),
    },
    { key: 'from', header: 'From', sortValue: (r) => r.fromDate, render: (r) => formatDate(r.fromDate) },
    { key: 'to', header: 'To', sortValue: (r) => r.toDate, render: (r) => formatDate(r.toDate) },
    { key: 'days', header: 'Days', align: 'right', sortValue: (r) => r.days, render: (r) => r.days },
    {
      key: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      render: (r) => (
        <Chip
          tone={
            r.status === 'APPROVED'
              ? 'success'
              : r.status === 'PENDING'
                ? 'warning'
                : r.status === 'REFUSED'
                  ? 'danger'
                  : 'neutral'
          }
          dot
        >
          {r.status.toLowerCase()}
        </Chip>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        if (r.status !== 'PENDING') return null;
        if (can(role, 'timeoff.approve') && !selfOnly) {
          return (
            <span className="row gap1" style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" variant="success" icon={CircleCheck} onClick={() => toast.result(decideLeave(r.id, 'APPROVED'))}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => setRefusing(r)}>
                Refuse
              </Button>
            </span>
          );
        }
        return (
          <Button size="sm" variant="ghost" onClick={() => toast.result(cancelLeave(r.id))}>
            Cancel
          </Button>
        );
      },
    },
  ];

  const allocations = selfOnly
    ? state.leaveAllocations.filter((a) => a.employeeId === me?.id)
    : state.leaveAllocations;

  return (
    <Page
      title={selfOnly ? 'My time off' : 'Time off'}
      crumbs={['Time', 'Time off']}
      actions={
        <>
          {can(role, 'timeoff.allocate') && (
            <Button icon={CalendarPlus} onClick={() => setGranting(true)}>
              Grant allocation
            </Button>
          )}
          <Button variant="primary" icon={Plus} onClick={() => setRequestOpen(true)}>
            Request leave
          </Button>
        </>
      }
    >
      {me && (
        <div className="grid grid-4">
          {state.leaveTypes
            .filter((t) => t.requiresAllocation)
            .map((t) => {
              const b = leaveBalance(state, selfOnly ? me.id : me.id, t.id);
              return (
                <Metric
                  key={t.id}
                  label={selfOnly ? `${t.name} left` : `My ${t.name.toLowerCase()}`}
                  value={b.remaining}
                  tone={b.remaining <= 2 ? 'warning' : 'brand'}
                  sub={`${b.used} used of ${b.allocated}`}
                  icon={CalendarOff}
                />
              );
            })}
          <Metric
            label="Pending"
            value={scoped.filter((r) => r.status === 'PENDING').length}
            tone={scoped.some((r) => r.status === 'PENDING') ? 'warning' : undefined}
          />
        </div>
      )}

      <Card padding="flush">
        <div style={{ padding: '0 var(--s4)' }}>
          <Tabs
            ariaLabel="Time off views"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'requests', label: 'Requests', count: rows.length },
              { key: 'allocations', label: 'Allocations', count: allocations.length },
              { key: 'calendar', label: 'Calendar' },
            ]}
          />
        </div>
        <div style={{ padding: 'var(--s4)' }}>
          <TabPanel tabKey="requests" active={tab}>
            <div className="toolbar mb4">
              {!selfOnly && <SearchBox value={query} onChange={setQuery} placeholder="Search employee or type…" />}
              <Select
                size2="sm"
                aria-label="Filter status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: 'ALL', label: 'All statuses' },
                  { value: 'PENDING', label: 'Pending' },
                  { value: 'APPROVED', label: 'Approved' },
                  { value: 'REFUSED', label: 'Refused' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                ]}
              />
            </div>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              pageSize={12}
              caption="Leave requests"
              empty={
                <EmptyState
                  icon={CalendarOff}
                  title="No requests"
                  description={selfOnly ? 'Request leave and it will appear here.' : 'No leave requests match these filters.'}
                />
              }
              mobileCard={(r) => (
                <>
                  <div className="row between">
                    <strong>{leaveTypeName(state, r.leaveTypeId)}</strong>
                    <Chip tone={r.status === 'APPROVED' ? 'success' : r.status === 'PENDING' ? 'warning' : 'neutral'} dot>
                      {r.status.toLowerCase()}
                    </Chip>
                  </div>
                  <dl className="reccard-kv">
                    {!selfOnly && (
                      <>
                        <dt>Employee</dt>
                        <dd>{empById(state, r.employeeId)?.fullName}</dd>
                      </>
                    )}
                    <dt>Dates</dt>
                    <dd>
                      {formatDate(r.fromDate)} → {formatDate(r.toDate)}
                    </dd>
                    <dt>Days</dt>
                    <dd>{r.days}</dd>
                  </dl>
                  {r.status === 'PENDING' && can(role, 'timeoff.approve') && !selfOnly && (
                    <div className="row gap2">
                      <Button size="sm" variant="success" block onClick={() => toast.result(decideLeave(r.id, 'APPROVED'))}>
                        Approve
                      </Button>
                      <Button size="sm" block onClick={() => setRefusing(r)}>
                        Refuse
                      </Button>
                    </div>
                  )}
                </>
              )}
            />
          </TabPanel>

          <TabPanel tabKey="allocations" active={tab}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {!selfOnly && <th>Employee</th>}
                    <th>Leave type</th>
                    <th className="cell-num">Allocated</th>
                    <th className="cell-num">Used</th>
                    <th className="cell-num">Remaining</th>
                    <th>Valid</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.slice(0, 40).map((a) => (
                    <tr key={a.id}>
                      {!selfOnly && <td>{empById(state, a.employeeId)?.fullName}</td>}
                      <td>{leaveTypeName(state, a.leaveTypeId)}</td>
                      <td className="cell-num">{a.allocated + a.carriedForward}</td>
                      <td className="cell-num">{a.used}</td>
                      <td className="cell-num">
                        <strong>{a.allocated + a.carriedForward - a.used}</strong>
                      </td>
                      <td className="muted">
                        {formatDate(a.validFrom)} → {formatDate(a.validTo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabPanel>

          <TabPanel tabKey="calendar" active={tab}>
            <LeaveCalendar requests={scoped} month={state.today} />
          </TabPanel>
        </div>
      </Card>

      <RequestLeaveDialog open={requestOpen} onClose={() => setRequestOpen(false)} />

      <Modal
        open={refusing !== null}
        onClose={() => setRefusing(null)}
        eyebrow="Time off"
        title="Refuse leave request"
        footer={
          <>
            <Button onClick={() => setRefusing(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!refusing) return;
                const r = await decideLeave(refusing.id, 'REFUSED', note);
                toast.result(r);
                if (r.ok) {
                  setRefusing(null);
                  setNote('');
                }
              }}
            >
              Refuse request
            </Button>
          </>
        }
      >
        {refusing && (
          <div className="col gap4">
            <p>
              {empById(state, refusing.employeeId)?.fullName} requested {refusing.days} day
              {refusing.days === 1 ? '' : 's'} of {leaveTypeName(state, refusing.leaveTypeId)} from{' '}
              {formatDate(refusing.fromDate)}.
            </p>
            <TextInput
              label="Reason for refusal"
              required
              placeholder="The employee sees this note."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={granting}
        onClose={() => setGranting(false)}
        onConfirm={() => {
          const ids = state.employees
            .filter((e) => e.departmentId === grantForm.departmentId && e.status !== 'ARCHIVED')
            .map((e) => e.id);
          toast.result(grantAllocation(ids, grantForm.leaveTypeId, Number(grantForm.days)));
          setGranting(false);
        }}
        title="Grant leave allocation"
        confirmLabel="Grant allocation"
      >
        <div className="col gap4">
          <Select
            label="Department"
            required
            placeholder="Select a department"
            value={grantForm.departmentId}
            onChange={(e) => setGrantForm((f) => ({ ...f, departmentId: e.target.value }))}
            options={state.departments.map((d) => ({ value: d.id, label: d.name }))}
          />
          <div className="grid grid-2">
            <Select
              label="Leave type"
              value={grantForm.leaveTypeId}
              onChange={(e) => setGrantForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
              options={state.leaveTypes.filter((t) => t.requiresAllocation).map((t) => ({ value: t.id, label: t.name }))}
            />
            <TextInput
              label="Days to add"
              type="number"
              inputMode="numeric"
              min={1}
              value={grantForm.days}
              onChange={(e) => setGrantForm((f) => ({ ...f, days: e.target.value }))}
            />
          </div>
          {grantForm.departmentId && (
            <ConsequencePreview
              rows={[
                {
                  label: 'Employees affected',
                  before: '—',
                  after: String(
                    state.employees.filter((e) => e.departmentId === grantForm.departmentId && e.status !== 'ARCHIVED').length,
                  ),
                },
                { label: 'Days added each', before: '—', after: grantForm.days },
              ]}
              note="Existing allocations are increased; employees without one receive a new allocation for the current year."
            />
          )}
        </div>
      </ConfirmDialog>
    </Page>
  );
}

function LeaveCalendar({ requests, month }: { requests: LeaveRequest[]; month: string }) {
  const state = useStore();
  const start = monthStart(month);
  const end = monthEnd(month);
  const days = eachDay(start, end);
  const pad = dayOfWeek(start);

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
          const onLeave = requests.filter(
            (r) => (r.status === 'APPROVED' || r.status === 'PENDING') && rangeOverlaps(r.fromDate, r.toDate, d, d),
          );
          const holiday = state.holidays.find((h) => h.date === d);
          return (
            <div className={`cal-day${d === month ? ' today' : ''}`} key={d}>
              <span className="d">{Number(d.slice(-2))}</span>
              {holiday && (
                <span className="cal-mark" style={{ background: 'var(--brand-light)', color: 'var(--brand)' }}>
                  {holiday.name}
                </span>
              )}
              {onLeave.slice(0, 2).map((r) => (
                <span
                  key={r.id}
                  className="cal-mark"
                  title={`${empById(state, r.employeeId)?.fullName} · ${leaveTypeName(state, r.leaveTypeId)}`}
                  style={{
                    background: r.status === 'APPROVED' ? 'var(--success-bg)' : 'var(--warning-bg)',
                    color: r.status === 'APPROVED' ? 'var(--success)' : 'var(--warning)',
                  }}
                >
                  {empById(state, r.employeeId)?.firstName}
                </span>
              ))}
              {onLeave.length > 2 && <span className="cal-mark">+{onLeave.length - 2}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
