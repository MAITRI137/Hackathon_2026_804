import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  CalendarOff,
  CircleCheck,
  Clock,
  FileText,
  Receipt,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import { can, isSelfScoped } from '@shared/permissions';
import { formatMoney } from '@shared/money';
import { formatDate, formatDuration, monthLabel, relativeTime } from '@shared/dates';
import { EMPLOYEE_TYPE_LABEL } from '@shared/types';
import { useStore } from '@/store/store';
import {
  contractsOf,
  contractPhase,
  currentContract,
  currentRole,
  currentUser,
  deptName,
  empById,
  leaveBalance,
  positionName,
  scheduleName,
} from '@/store/selectors';
import { archiveEmployee, restoreEmployee, generateDocument } from '@/store/actions';
import { Page } from '@/app/Page';
import { Avatar, Banner, Button, Card, Chip, EmptyState, InfoGrid, Metric } from '@/ui/primitives';
import { Tabs, TabPanel, Timeline } from '@/ui/feedback';
import { ConfirmDialog } from '@/ui/overlays';
import { useToast } from '@/ui/toast';

export function EmployeeDetailPage() {
  const { id = '' } = useParams();
  const state = useStore();
  const role = currentRole(state);
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [archiving, setArchiving] = useState(false);

  const employee = empById(state, id);
  const me = currentUser(state);

  // Employees may open only their own record — enforced here as well as in nav.
  if (isSelfScoped(role) && me.employeeId !== id) {
    return (
      <Page title="Permission denied" crumbs={['People']}>
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="You can only open your own record"
            description="Employee accounts are scoped to their own data. This request would be refused by the server too."
            action={
              <Link to="/">
                <Button variant="primary">Back to my dashboard</Button>
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  if (!employee) {
    return (
      <Page title="Employee not found" crumbs={['People']}>
        <Card>
          <EmptyState icon={UserRound} title="No such employee" description={`No record matches "${id}".`} />
        </Card>
      </Page>
    );
  }

  const contract = currentContract(state, employee.id);
  const contracts = contractsOf(state, employee.id);
  const canSeeWage = can(role, 'salary.structure.read') || can(role, 'payslip.read.all') || me.employeeId === employee.id;

  const attendance = state.attendance
    .filter((a) => a.employeeId === employee.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const leaves = state.leaveRequests
    .filter((l) => l.employeeId === employee.id)
    .sort((a, b) => b.fromDate.localeCompare(a.fromDate));
  const payslips = state.payslips
    .filter((p) => p.employeeId === employee.id && !p.isDuplicate)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const documents = state.documents.filter((d) => d.employeeId === employee.id);
  const checklist = state.checklists.find((c) => c.employeeId === employee.id);
  const audit = state.audit.filter((a) => a.entityId === employee.id || a.summary.includes(employee.fullName));

  const timeline = useMemo(() => {
    const items = [
      {
        id: 'joined',
        caption: formatDate(employee.joinDate),
        title: `Joined as ${positionName(state, employee.jobPositionId)}`,
        tone: 'success' as const,
      },
      ...contracts.map((c) => ({
        id: c.id,
        caption: formatDate(c.startDate),
        title: `${c.contractRef} — ${canSeeWage ? formatMoney(c.wage) : 'wage restricted'}`,
        detail: `${c.status.toLowerCase()} · ${c.endDate ? `until ${formatDate(c.endDate)}` : 'open-ended'}`,
        tone: 'brand' as const,
      })),
      ...audit.slice(0, 8).map((a) => ({
        id: a.id,
        caption: `${relativeTime(a.at)} · ${a.actorName}`,
        title: a.summary,
        tone: 'brand' as const,
      })),
    ];
    return items;
  }, [employee, contracts, audit, state, canSeeWage]);

  return (
    <Page
      title={employee.fullName}
      crumbs={['People', 'Employees', employee.employeeCode]}
      actions={
        <>
          {can(role, 'document.write') && (
            <Button
              onClick={() => toast.result(generateDocument(employee.id, 'Employment Letter'))}
              icon={FileText}
            >
              Generate letter
            </Button>
          )}
          {can(role, 'employee.archive') && employee.status !== 'ARCHIVED' && (
            <Button icon={Archive} onClick={() => setArchiving(true)}>
              Archive
            </Button>
          )}
        </>
      }
    >
      <div className="grid split-main">
        <Card padding="tight">
          <div className="row gap4 wrap">
            <Avatar initials={employee.initials} size="xl" />
            <div className="grow" style={{ minWidth: 180 }}>
              <h3 style={{ fontSize: 'var(--fs-lg)' }}>{employee.fullName}</h3>
              <p className="muted">
                {positionName(state, employee.jobPositionId)} · {deptName(state, employee.departmentId)}
              </p>
              <div className="row gap2 wrap mt2">
                <Chip tone={employee.status === 'ACTIVE' ? 'success' : employee.status === 'ARCHIVED' ? 'neutral' : 'info'} dot>
                  {employee.status.toLowerCase()}
                </Chip>
                <Chip tone="neutral">{EMPLOYEE_TYPE_LABEL[employee.employeeType]}</Chip>
                {employee.probationEndDate && employee.status === 'PROBATION' && (
                  <Chip tone="warning">Probation ends {formatDate(employee.probationEndDate)}</Chip>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Related records" padding="tight">
          <div className="col gap2" style={{ fontSize: 'var(--fs-sm)' }}>
            {[
              { label: 'Contracts', value: contracts.length, icon: FileText },
              { label: 'Attendance records', value: attendance.length, icon: Clock },
              { label: 'Leave requests', value: leaves.length, icon: CalendarOff },
              { label: 'Payslips', value: payslips.length, icon: Receipt },
              { label: 'Documents', value: documents.length, icon: FileText },
            ].map((r) => (
              <div className="row between" key={r.label}>
                <span className="row gap2 muted">
                  <r.icon size={14} aria-hidden />
                  {r.label}
                </span>
                <strong className="mono">{r.value}</strong>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {!employee.bank?.verifiedAt && (
        <Banner tone="warning" icon={TriangleAlert} title="Bank details not verified">
          This blocks payroll for {employee.firstName}. Resolve it from the payroll exception centre.
        </Banner>
      )}

      <Card padding="flush">
        <div style={{ padding: '0 var(--s4)' }}>
          <Tabs
            ariaLabel="Employee record sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'overview', label: 'Overview' },
              { key: 'contracts', label: 'Contracts', count: contracts.length },
              { key: 'attendance', label: 'Attendance', count: attendance.length },
              { key: 'timeoff', label: 'Time off', count: leaves.length },
              { key: 'payslips', label: 'Payslips', count: payslips.length },
              { key: 'onboarding', label: 'Onboarding' },
              { key: 'timeline', label: 'Timeline' },
            ]}
          />
        </div>

        <div style={{ padding: 'var(--s4)' }}>
          <TabPanel tabKey="overview" active={tab}>
            <InfoGrid
              items={[
                { label: 'Employee code', value: employee.employeeCode, mono: true },
                { label: 'Email', value: employee.email },
                { label: 'Phone', value: employee.phone || '—' },
                { label: 'Joined', value: formatDate(employee.joinDate) },
                { label: 'Manager', value: empById(state, employee.managerId)?.fullName ?? '—' },
                { label: 'Working schedule', value: scheduleName(state, employee.workingScheduleId) },
                {
                  label: 'Monthly wage',
                  value: canSeeWage ? (contract ? formatMoney(contract.wage) : '—') : 'Restricted',
                  mono: canSeeWage,
                },
                {
                  label: 'Bank account',
                  value: employee.bank?.verifiedAt
                    ? `${employee.bank.bankName} ${employee.bank.accountNumberMasked}`
                    : 'Not verified',
                },
              ]}
            />
          </TabPanel>

          <TabPanel tabKey="contracts" active={tab}>
            {contracts.length === 0 ? (
              <EmptyState icon={FileText} title="No contracts" description="Create one to include this person in payroll." />
            ) : (
              <div className="col gap2">
                {contracts.map((c) => {
                  const phase = contractPhase(state, c);
                  return (
                    <div
                      key={c.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r)',
                        padding: 'var(--s3)',
                        background: phase === 'current' ? 'var(--brand-50)' : 'var(--surface)',
                      }}
                    >
                      <div className="row between wrap gap2">
                        <span className="row gap2">
                          <strong className="mono">{c.contractRef}</strong>
                          <Chip tone={phase === 'current' ? 'success' : phase === 'upcoming' ? 'info' : 'neutral'} dot>
                            {phase}
                          </Chip>
                        </span>
                        <span className="mono">{canSeeWage ? formatMoney(c.wage) : 'Restricted'}</span>
                      </div>
                      <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                        {formatDate(c.startDate)} → {c.endDate ? formatDate(c.endDate) : 'open-ended'} ·{' '}
                        {positionName(state, c.jobPositionId)} · {scheduleName(state, c.workingScheduleId)}
                      </p>
                      {c.notes && <p style={{ fontSize: 'var(--fs-sm)' }}>{c.notes}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </TabPanel>

          <TabPanel tabKey="attendance" active={tab}>
            {attendance.length === 0 ? (
              <EmptyState icon={Clock} title="No attendance records" />
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>In</th>
                      <th>Out</th>
                      <th>Worked</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.slice(0, 20).map((a) => (
                      <tr key={a.id}>
                        <td>{formatDate(a.date)}</td>
                        <td className="mono">{a.checkIn ?? '—'}</td>
                        <td className="mono">
                          {a.checkOut ?? <span style={{ color: 'var(--danger)' }}>Missing</span>}
                        </td>
                        <td className="mono">{formatDuration(a.workedMinutes)}</td>
                        <td>
                          <Chip
                            tone={
                              a.status === 'PRESENT'
                                ? 'success'
                                : a.status === 'MISSING_CHECKOUT' || a.status === 'ABSENT'
                                  ? 'danger'
                                  : 'warning'
                            }
                            dot
                          >
                            {a.status.replace(/_/g, ' ').toLowerCase()}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabPanel>

          <TabPanel tabKey="timeoff" active={tab}>
            <div className="grid grid-3 mb4">
              {state.leaveTypes
                .filter((t) => t.requiresAllocation)
                .map((t) => {
                  const b = leaveBalance(state, employee.id, t.id);
                  return <Metric key={t.id} label={t.name} value={b.remaining} sub={`${b.used} used of ${b.allocated}`} />;
                })}
            </div>
            {leaves.length === 0 ? (
              <EmptyState icon={CalendarOff} title="No leave requests" />
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Days</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.map((l) => (
                      <tr key={l.id}>
                        <td>{state.leaveTypes.find((t) => t.id === l.leaveTypeId)?.name}</td>
                        <td>{formatDate(l.fromDate)}</td>
                        <td>{formatDate(l.toDate)}</td>
                        <td className="mono">{l.days}</td>
                        <td>
                          <Chip
                            tone={l.status === 'APPROVED' ? 'success' : l.status === 'PENDING' ? 'warning' : 'neutral'}
                            dot
                          >
                            {l.status.toLowerCase()}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabPanel>

          <TabPanel tabKey="payslips" active={tab}>
            {!canSeeWage ? (
              <EmptyState icon={ShieldCheck} title="Payslips are restricted" description="Your role cannot read this employee's payslips." />
            ) : payslips.length === 0 ? (
              <EmptyState icon={Receipt} title="No payslips yet" />
            ) : (
              <div className="col gap2">
                {payslips.map((p) => (
                  <Link className="row between" key={p.id} to={`/payslips/${p.id}`} style={{ color: 'inherit', padding: 'var(--s2) 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{monthLabel(p.periodStart)}</span>
                    <span className="row gap3">
                      <Chip tone={p.status === 'PAID' ? 'success' : 'info'} dot>
                        {p.status.toLowerCase()}
                      </Chip>
                      <strong className="mono">{formatMoney(p.net)}</strong>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </TabPanel>

          <TabPanel tabKey="onboarding" active={tab}>
            {!checklist ? (
              <EmptyState icon={CircleCheck} title="No checklist" description="Checklists are created automatically when an employee is added." />
            ) : (
              <div className="col gap2">
                {checklist.items.map((i) => (
                  <div className="row between" key={i.id} style={{ padding: 'var(--s2) 0', borderBottom: '1px solid var(--border)' }}>
                    <span className="row gap2">
                      {i.completedAt ? (
                        <CircleCheck size={16} color="var(--success)" aria-hidden />
                      ) : (
                        <TriangleAlert size={16} color="var(--warning-strong)" aria-hidden />
                      )}
                      {i.label}
                    </span>
                    <span className="row gap2">
                      {i.blocksPayroll && <Chip tone="danger">Blocks payroll</Chip>}
                      <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                        {i.completedAt ? `done ${formatDate(i.completedAt.slice(0, 10))}` : `due ${formatDate(i.dueDate)}`}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabPanel>

          <TabPanel tabKey="timeline" active={tab}>
            <Timeline items={timeline} />
          </TabPanel>
        </div>
      </Card>

      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        onConfirm={() => {
          const r = archiveEmployee(employee.id);
          setArchiving(false);
          if (r.ok) {
            const previous = employee.status;
            toast.show(r.message, 'success', () => {
              restoreEmployee(employee.id, previous);
            });
            navigate('/employees');
          }
        }}
        title={`Archive ${employee.fullName}`}
        confirmLabel="Archive employee"
        variant="danger"
      >
        <p>
          Archiving removes {employee.firstName} from directories and future payruns. Existing
          payslips and audit history are preserved. You can undo this immediately after.
        </p>
      </ConfirmDialog>
    </Page>
  );
}
