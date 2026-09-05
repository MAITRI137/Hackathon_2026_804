/** X02 — inspect a person without leaving the current workflow. */
import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { can } from '@shared/permissions';
import { formatMoney } from '@shared/money';
import { formatDate, monthLabel } from '@shared/dates';
import { EMPLOYEE_TYPE_LABEL } from '@shared/types';
import { useStore } from '@/store/store';
import {
  currentContract,
  currentRole,
  deptName,
  empById,
  leaveBalance,
  positionName,
  scheduleName,
} from '@/store/selectors';
import { Avatar, Banner, Button, Chip, InfoGrid } from '@/ui/primitives';

export function EmployeeSidecar({ employeeId }: { employeeId: string }) {
  const state = useStore();
  const role = currentRole(state);
  const e = empById(state, employeeId);
  if (!e) return <p className="muted">This employee no longer exists.</p>;

  const contract = currentContract(state, e.id);
  const canSeeWage = can(role, 'payslip.read.all') || can(role, 'salary.structure.read');
  const annual = leaveBalance(state, e.id, 'lt-annual');
  const slips = state.payslips
    .filter((p) => p.employeeId === e.id && !p.isDuplicate)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
    .slice(0, 3);
  const checklist = state.checklists.find((c) => c.employeeId === e.id && c.type === 'ONBOARDING');
  const openItems = checklist?.items.filter((i) => !i.completedAt) ?? [];

  return (
    <div className="col gap5">
      <div className="row gap3">
        <Avatar initials={e.initials} size="xl" />
        <div className="grow">
          <h4 style={{ fontSize: 'var(--fs-lg)' }}>{e.fullName}</h4>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            {positionName(state, e.jobPositionId)} · {deptName(state, e.departmentId)}
          </p>
          <div className="row gap2 wrap mt2">
            <Chip tone={e.status === 'ACTIVE' ? 'success' : 'info'} dot>
              {e.status.toLowerCase()}
            </Chip>
            <Chip tone="neutral">{EMPLOYEE_TYPE_LABEL[e.employeeType]}</Chip>
          </div>
        </div>
      </div>

      {!e.bank?.verifiedAt && (
        <Banner tone="warning" icon={TriangleAlert} title="Bank details not verified">
          Payroll for this employee is blocked until a verified account is on file.
        </Banner>
      )}

      <InfoGrid
        items={[
          { label: 'Employee code', value: e.employeeCode, mono: true },
          { label: 'Email', value: <span className="truncate">{e.email}</span> },
          { label: 'Joined', value: formatDate(e.joinDate) },
          { label: 'Manager', value: empById(state, e.managerId)?.fullName ?? '—' },
          { label: 'Schedule', value: scheduleName(state, e.workingScheduleId) },
          {
            label: 'Monthly wage',
            value: canSeeWage ? (contract ? formatMoney(contract.wage) : 'No contract') : 'Restricted',
            mono: canSeeWage,
          },
          { label: 'Contract', value: contract?.contractRef ?? '—', mono: true },
          { label: 'Annual leave left', value: `${annual.remaining} of ${annual.allocated}` },
        ]}
      />

      {openItems.length > 0 && (
        <div>
          <h5 className="eyebrow mb2">Onboarding outstanding</h5>
          <div className="col gap2">
            {openItems.map((i) => (
              <div className="row between" key={i.id} style={{ fontSize: 'var(--fs-sm)' }}>
                <span>{i.label}</span>
                {i.blocksPayroll ? (
                  <Chip tone="danger">Blocks payroll</Chip>
                ) : (
                  <Chip tone="neutral">Due {formatDate(i.dueDate)}</Chip>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {can(role, 'payslip.read.all') && slips.length > 0 && (
        <div>
          <h5 className="eyebrow mb2">Recent payslips</h5>
          <div className="col gap2">
            {slips.map((s) => (
              <Link className="row between" key={s.id} to={`/payslips/${s.id}`} style={{ color: 'inherit' }}>
                <span>{monthLabel(s.periodStart)}</span>
                <span className="mono">{formatMoney(s.net)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Link to={`/employees/${e.id}`}>
        <Button variant="primary" block>
          Open full record
        </Button>
      </Link>
    </div>
  );
}
