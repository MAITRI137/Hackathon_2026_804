/**
 * Role homes. Each answers, in this order:
 *   what needs me → what is blocked → what is the next action → what changed.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  BadgeIndianRupee,
  CalendarClock,
  CalendarOff,
  CircleCheck,
  Clock,
  FileText,
  Inbox,
  LogIn,
  LogOut,
  Receipt,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { can } from '@shared/permissions';
import { formatMoney, formatMoneyShort } from '@shared/money';
import { formatDate, formatDayDate, formatDuration, monthLabel, relativeTime } from '@shared/dates';
import { useStore } from '@/store/store';
import {
  activePayrun,
  approvalItems,
  currentEmployee,
  currentContract,
  currentRole,
  empById,
  exceptionsFor,
  expiringContracts,
  leaveBalance,
  nextBestAction,
  nextShift,
  probationEnding,
  readinessFor,
  totalsFor,
  workedDaysThisPeriod,
} from '@/store/selectors';
import { netLabel } from '@/store/payroll';
import { checkIn, checkOut } from '@/store/actions';
import { Page } from '@/app/Page';
import { useAppActions } from '@/app/actions-context';
import { Avatar, Banner, Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { Ring, Timeline } from '@/ui/feedback';
import { HBars } from '@/ui/charts';
import { useToast } from '@/ui/toast';

export function HomePage() {
  const state = useStore();
  const role = currentRole(state);
  if (role === 'EMPLOYEE') return <EmployeeHome />;
  if (role === 'HR_MANAGER') return <HrHome />;
  if (role === 'ADMIN') return <AdminHome />;
  return <PayrollHome />;
}

/* ── Next best action card, shared ─────────────────────────── */

function NbaCard() {
  const state = useStore();
  const navigate = useNavigate();
  const nba = useMemo(() => nextBestAction(state), [state]);
  return (
    <div className="nba">
      <span className="lbl">Next best action</span>
      <span className="txt">{nba.label}</span>
      <span className="why">{nba.reason}</span>
      <Button className="btn" onClick={() => navigate(nba.to)}>
        {nba.cta}
      </Button>
    </div>
  );
}

function RecentActivity({ limit = 6 }: { limit?: number }) {
  const state = useStore();
  return (
    <Card title="What changed recently" padding="tight">
      {state.audit.length === 0 ? (
        <EmptyState icon={Activity} title="No activity yet" />
      ) : (
        <Timeline
          items={state.audit.slice(0, limit).map((a) => ({
            id: a.id,
            caption: `${relativeTime(a.at)} · ${a.actorName}`,
            title: a.summary,
            tone: a.action.includes('PAID')
              ? 'success'
              : a.action.includes('REFUSED') || a.action.includes('REOPENED')
                ? 'danger'
                : 'brand',
          }))}
        />
      )}
    </Card>
  );
}

/* ── Payroll manager / payroll user ────────────────────────── */

function PayrollHome() {
  const state = useStore();
  const role = currentRole(state);
  const payrun = activePayrun(state);
  const exceptions = useMemo(() => exceptionsFor(state, payrun), [state, payrun]);
  const readiness = useMemo(() => readinessFor(state, payrun), [state, payrun]);
  const totals = useMemo(() => totalsFor(state, payrun.id), [state, payrun.id]);
  const blocking = exceptions.filter((e) => e.blocking);
  const approvals = approvalItems(state);

  return (
    <Page title="Payroll operations" crumbs={['Overview']}>
      <div className="grid split-main">
        <NbaCard />
        <Card padding="tight">
          <div className="row gap4" style={{ alignItems: 'center' }}>
            <Ring percent={readiness.score} size={104} />
            <div className="grow">
              <div className="eyebrow">{monthLabel(payrun.periodStart)}</div>
              <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{payrun.status}</div>
              <div className="row gap2 wrap mt2">
                {blocking.length > 0 ? (
                  <Chip tone="danger" dot>
                    {blocking.length} blocking
                  </Chip>
                ) : (
                  <Chip tone="success" icon={CircleCheck}>
                    Clean
                  </Chip>
                )}
                <Chip tone="neutral">{totals.count} payslips</Chip>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {blocking.length > 0 && (
        <Banner
          tone="warning"
          icon={TriangleAlert}
          title={`${blocking.length} exception${blocking.length === 1 ? '' : 's'} blocking ${monthLabel(payrun.periodStart)}`}
          action={
            <Link to="/payroll/exceptions">
              <Button size="sm" variant="primary">
                Resolve
              </Button>
            </Link>
          }
        >
          {blocking
            .slice(0, 3)
            .map((e) => `${empById(state, e.employeeId)?.fullName ?? 'Payroll'} — ${e.title}`)
            .join(' · ')}
          {blocking.length > 3 && ` · +${blocking.length - 3} more`}
        </Banner>
      )}

      <div className="grid grid-4">
        <Metric label="Employees in run" value={totals.count} icon={Users} />
        <Metric label="Gross" value={formatMoneyShort(totals.gross)} tone="brand" sub={formatMoney(totals.gross)} />
        <Metric label="Deductions" value={formatMoneyShort(totals.deductions)} tone="warning" />
        <Metric
          label={netLabel(payrun.status)}
          value={formatMoneyShort(totals.net)}
          tone="success"
          icon={BadgeIndianRupee}
          sub={formatMoney(totals.net)}
        />
      </div>

      <div className="grid split-side">
        <Card
          title="Input completeness"
          action={
            <Link to="/payroll">
              <Button size="sm">Open control room</Button>
            </Link>
          }
          padding="tight"
        >
          <HBars
            rows={readiness.categories.map((c) => ({
              id: c.category,
              label: c.label,
              percent: c.percent,
              caption: `${c.percent}%`,
              color:
                c.percent === 100
                  ? 'var(--success)'
                  : c.percent >= 90
                    ? 'var(--mark-1)'
                    : 'var(--warning-strong)',
            }))}
          />
        </Card>

        <Card
          title="Approvals waiting"
          action={
            can(role, 'approval.read') && (
              <Link to="/approvals">
                <Button size="sm">Open inbox</Button>
              </Link>
            )
          }
          padding="tight"
        >
          {approvals.length === 0 ? (
            <EmptyState icon={CircleCheck} title="Inbox is clear" />
          ) : (
            <div className="col gap2">
              {approvals.slice(0, 4).map((a) => {
                const e = empById(state, a.employeeId);
                return (
                  <div className="row gap3" key={a.id}>
                    <Avatar initials={e?.initials ?? '??'} size="sm" />
                    <div className="grow truncate">
                      <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{e?.fullName}</div>
                      <div className="muted truncate" style={{ fontSize: 'var(--fs-xs)' }}>
                        {a.title}
                      </div>
                    </div>
                    <Chip tone="neutral">{a.type.toLowerCase()}</Chip>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <RecentActivity />
    </Page>
  );
}

/* ── HR manager ────────────────────────────────────────────── */

function HrHome() {
  const state = useStore();
  const actions = useAppActions();
  const approvals = approvalItems(state);
  const expiring = expiringContracts(state);
  const probation = probationEnding(state);
  const missingBank = state.employees.filter((e) => e.status !== 'ARCHIVED' && !e.bank?.verifiedAt);
  const openCheckouts = state.attendance.filter((a) => a.checkIn && !a.checkOut);

  return (
    <Page
      title="HR operations"
      crumbs={['Overview']}
      actions={
        <Button variant="primary" icon={UserPlus} onClick={() => actions.run('new-employee')}>
          Add employee
        </Button>
      }
    >
      <div className="grid split-main">
        <NbaCard />
        <Card title="Missing information" padding="tight">
          <div className="col gap2">
            <div className="row between">
              <span className="muted">Bank details not verified</span>
              <Chip tone={missingBank.length ? 'warning' : 'success'}>{missingBank.length}</Chip>
            </div>
            <div className="row between">
              <span className="muted">Open check-ins</span>
              <Chip tone={openCheckouts.length ? 'warning' : 'success'}>{openCheckouts.length}</Chip>
            </div>
            <div className="row between">
              <span className="muted">Contracts expiring soon</span>
              <Chip tone={expiring.length ? 'warning' : 'success'}>{expiring.length}</Chip>
            </div>
            <div className="row between">
              <span className="muted">Probation ending</span>
              <Chip tone={probation.length ? 'info' : 'success'}>{probation.length}</Chip>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-4">
        <Metric
          label="Active employees"
          value={state.employees.filter((e) => e.status === 'ACTIVE' || e.status === 'PROBATION').length}
          icon={Users}
          tone="brand"
        />
        <Metric label="Pending approvals" value={approvals.length} icon={Inbox} tone={approvals.length ? 'warning' : undefined} />
        <Metric label="Departments" value={state.departments.length} />
        <Metric
          label="On leave this month"
          value={
            state.leaveRequests.filter(
              (r) => r.status === 'APPROVED' && r.fromDate.slice(0, 7) === state.today.slice(0, 7),
            ).length
          }
          icon={CalendarOff}
        />
      </div>

      <div className="grid split-side">
        <Card
          title="Employees needing attention"
          action={
            <Link to="/employees">
              <Button size="sm">All employees</Button>
            </Link>
          }
          padding="tight"
        >
          {missingBank.length === 0 && expiring.length === 0 ? (
            <EmptyState icon={CircleCheck} title="Nothing outstanding" />
          ) : (
            <div className="col gap2">
              {missingBank.slice(0, 3).map((e) => (
                <Link className="row gap3" to={`/employees/${e.id}`} key={e.id} style={{ color: 'inherit' }}>
                  <Avatar initials={e.initials} size="sm" tone="warning" />
                  <div className="grow truncate">
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{e.fullName}</div>
                    <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                      Bank details not verified
                    </div>
                  </div>
                </Link>
              ))}
              {expiring.slice(0, 3).map((c) => {
                const e = empById(state, c.employeeId);
                return (
                  <Link className="row gap3" to="/contracts" key={c.id} style={{ color: 'inherit' }}>
                    <Avatar initials={e?.initials ?? '??'} size="sm" tone="warning" />
                    <div className="grow truncate">
                      <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{e?.fullName}</div>
                      <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                        {c.contractRef} expires {formatDate(c.endDate)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <RecentActivity limit={5} />
      </div>
    </Page>
  );
}

/* ── Employee ──────────────────────────────────────────────── */

function EmployeeHome() {
  const state = useStore();
  const toast = useToast();
  const actions = useAppActions();
  const me = currentEmployee(state)!;
  const payrun = activePayrun(state);
  const [busy, setBusy] = useState(false);

  const open = state.attendance.find((a) => a.employeeId === me.id && a.checkIn && !a.checkOut);
  const todayRecord = state.attendance.find((a) => a.employeeId === me.id && a.date === state.today);
  const shift = nextShift(state, me);
  const worked = workedDaysThisPeriod(state, me.id, payrun);
  const contract = currentContract(state, me.id);
  const annual = leaveBalance(state, me.id, 'lt-annual');
  const sick = leaveBalance(state, me.id, 'lt-sick');
  const myPayslips = state.payslips
    .filter((p) => p.employeeId === me.id && !p.isDuplicate)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const latest = myPayslips[0];
  const myPending = state.leaveRequests.filter((r) => r.employeeId === me.id && r.status === 'PENDING');

  return (
    <Page title={`Welcome, ${me.firstName}`} crumbs={['My workspace']}>
      <div className="grid split-main">
        <Card padding="tight">
          <div className="row gap4 wrap">
            <Avatar initials={me.initials} size="xl" tone={open ? 'success' : undefined} />
            <div className="grow" style={{ minWidth: 160 }}>
              <div className="eyebrow">Today · {formatDayDate(state.today)}</div>
              <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
                {open ? 'Checked in' : todayRecord?.checkOut ? 'Checked out' : 'Not checked in'}
              </div>
              <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                {open
                  ? `Since ${open.checkIn}`
                  : todayRecord?.checkOut
                    ? `${todayRecord.checkIn} → ${todayRecord.checkOut} · ${formatDuration(todayRecord.workedMinutes)}`
                    : shift
                      ? `Next shift ${formatDayDate(shift)}`
                      : 'No upcoming shift scheduled'}
              </div>
            </div>
            {open ? (
              <Button
                variant="danger"
                icon={LogOut}
                pending={busy}
                onClick={() => {
                  setBusy(true);
                  const r = checkOut(me.id);
                  setBusy(false);
                  toast.result(r);
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
                title={todayRecord?.checkOut ? 'You have already completed today' : undefined}
                onClick={() => {
                  setBusy(true);
                  const r = checkIn(me.id);
                  setBusy(false);
                  toast.result(r);
                }}
              >
                Check in
              </Button>
            )}
          </div>
        </Card>

        <NbaCard />
      </div>

      <div className="grid grid-4">
        <Metric label="Annual leave left" value={annual.remaining} tone="brand" icon={CalendarOff} sub={`of ${annual.allocated} days`} />
        <Metric label="Sick leave left" value={sick.remaining} sub={`of ${sick.allocated} days`} />
        <Metric
          label={`Days worked in ${monthLabel(payrun.periodStart).split(' ')[0]}`}
          value={worked}
          icon={Clock}
          sub={`${payrun.expectedWorkDays} scheduled this month`}
        />
        <Metric
          label="Pending requests"
          value={myPending.length}
          tone={myPending.length ? 'warning' : undefined}
        />
      </div>

      <div className="grid split-side">
        <Card
          title="My latest payslip"
          action={
            <Link to="/payslips">
              <Button size="sm">All payslips</Button>
            </Link>
          }
          padding="tight"
        >
          {!latest ? (
            <EmptyState
              icon={Receipt}
              title="No payslip yet"
              description="Your first payslip appears once payroll has been computed for a period you worked."
            />
          ) : (
            <div className="col gap3">
              <div className="row between wrap">
                <div>
                  <div className="eyebrow">{monthLabel(latest.periodStart)}</div>
                  <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 750 }} className="mono">
                    {formatMoney(latest.net)}
                  </div>
                </div>
                <Chip tone={latest.status === 'PAID' ? 'success' : 'info'} dot>
                  {latest.status}
                </Chip>
              </div>
              <div className="row gap2 wrap">
                <Link to={`/payslips/${latest.id}`}>
                  <Button size="sm" variant="primary" icon={Receipt}>
                    Open payslip
                  </Button>
                </Link>
                {myPayslips[1] && (
                  <Link to={`/payslips/${latest.id}?compare=1`}>
                    <Button size="sm" icon={Activity}>
                      Why did my salary change?
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card title="Quick actions" padding="tight">
          <div className="col gap2">
            <Button block icon={CalendarOff} onClick={() => actions.run('request-leave')}>
              Request leave
            </Button>
            <Link to="/attendance">
              <Button block icon={Clock}>
                My attendance
              </Button>
            </Link>
            <Link to="/contracts">
              <Button block icon={FileText}>
                My contract
                {contract ? ` · ${contract.contractRef}` : ''}
              </Button>
            </Link>
            <Link to="/documents">
              <Button block icon={CalendarClock}>
                My documents
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </Page>
  );
}

/* ── Admin ─────────────────────────────────────────────────── */

function AdminHome() {
  const state = useStore();
  const payrun = activePayrun(state);
  const totals = totalsFor(state, payrun.id);

  return (
    <Page title="System administration" crumbs={['Overview']}>
      <div className="grid split-main">
        <NbaCard />
        <Card title="Environment" padding="tight">
          <div className="col gap2" style={{ fontSize: 'var(--fs-sm)' }}>
            <div className="row between">
              <span className="muted">Active period</span>
              <strong>{monthLabel(payrun.periodStart)}</strong>
            </div>
            <div className="row between">
              <span className="muted">Payrun state</span>
              <Chip tone={payrun.status === 'PAID' ? 'success' : 'info'} dot>
                {payrun.status}
              </Chip>
            </div>
            <div className="row between">
              <span className="muted">Reopen requires reason</span>
              <Chip tone={state.settings.requireReopenReason ? 'success' : 'warning'}>
                {state.settings.requireReopenReason ? 'On' : 'Off'}
              </Chip>
            </div>
            <div className="row between">
              <span className="muted">Auto-freeze at cutoff</span>
              <Chip tone={state.settings.autoFreezeAtCutoff ? 'success' : 'neutral'}>
                {state.settings.autoFreezeAtCutoff ? 'On' : 'Off'}
              </Chip>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-4">
        <Metric label="Users" value={state.users.length} icon={Users} tone="brand" />
        <Metric label="Employees" value={state.employees.length} icon={Users} />
        <Metric label="Audit events" value={state.audit.length} icon={ShieldCheck} />
        <Metric label={netLabel(payrun.status)} value={formatMoneyShort(totals.net)} tone="success" />
      </div>

      <div className="grid split-side">
        <RecentActivity limit={8} />
        <Card title="Administration" padding="tight">
          <div className="col gap2">
            <Link to="/users">
              <Button block icon={Users}>
                Users and roles
              </Button>
            </Link>
            <Link to="/settings">
              <Button block icon={ShieldCheck}>
                Settings
              </Button>
            </Link>
            <Link to="/audit">
              <Button block icon={ShieldCheck}>
                Audit trail
              </Button>
            </Link>
            <Link to="/ops">
              <Button block icon={Activity}>
                System health
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </Page>
  );
}
