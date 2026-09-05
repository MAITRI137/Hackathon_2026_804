import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  Download,
  LayoutGrid,
  List,
  SlidersHorizontal,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { can } from '@shared/permissions';
import { formatMoney, formatMoneyShort, money } from '@shared/money';
import { EMPLOYEE_TYPES, EMPLOYEE_TYPE_LABEL, type Employee } from '@shared/types';
import { useStore } from '@/store/store';
import {
  currentContract,
  currentRole,
  deptName,
  positionName,
  scheduleName,
  visibleEmployees,
} from '@/store/selectors';
import {
  batchAddToPayrun,
  batchAssignSchedule,
  batchAssignStructure,
  moveEmployeeToDepartment,
} from '@/store/actions';
import { Page } from '@/app/Page';
import { useAppActions } from '@/app/actions-context';
import { Avatar, Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { SearchBox, Segmented, Select } from '@/ui/form';
import { DataTable, type Column } from '@/ui/table';
import { ConfirmDialog, useSidecar } from '@/ui/overlays';
import { ConsequencePreview } from '@/ui/feedback';
import { useToast } from '@/ui/toast';
import { downloadCsv } from '@/lib/export';
import { EmployeeSidecar } from './EmployeeSidecar';
import { AddEmployeeDialog } from './AddEmployeeDialog';

type BatchKind = 'schedule' | 'structure' | 'payrun' | 'export' | null;

export function EmployeesPage() {
  const state = useStore();
  const role = currentRole(state);
  const navigate = useNavigate();
  const sidecar = useSidecar();
  const toast = useToast();
  const globalActions = useAppActions();

  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [query, setQuery] = useState('');
  const [dept, setDept] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<BatchKind>(null);
  const [batchValue, setBatchValue] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const canSeeWage = can(role, 'payslip.read.all') || can(role, 'salary.structure.read');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleEmployees(state).filter((e) => {
      if (dept !== 'ALL' && e.departmentId !== dept) return false;
      if (status !== 'ALL' && e.status !== status) return false;
      if (type !== 'ALL' && e.employeeType !== type) return false;
      if (!q) return true;
      return (
        e.fullName.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        deptName(state, e.departmentId).toLowerCase().includes(q) ||
        positionName(state, e.jobPositionId).toLowerCase().includes(q)
      );
    });
  }, [state, query, dept, status, type]);

  const openSidecar = (e: Employee) =>
    sidecar.open({ title: e.fullName, content: <EmployeeSidecar employeeId={e.id} /> });

  const columns: Column<Employee>[] = [
    {
      key: 'name',
      header: 'Employee',
      sortValue: (e) => e.fullName,
      render: (e) => (
        <span className="person">
          <Avatar initials={e.initials} size="sm" tone={!e.bank?.verifiedAt ? 'warning' : undefined} />
          <span className="truncate">
            <span className="person-name">{e.fullName}</span>
            <span className="person-meta">{e.employeeCode}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'dept',
      header: 'Department',
      sortValue: (e) => deptName(state, e.departmentId),
      render: (e) => deptName(state, e.departmentId),
    },
    {
      key: 'position',
      header: 'Position',
      sortValue: (e) => positionName(state, e.jobPositionId),
      secondary: true,
      render: (e) => positionName(state, e.jobPositionId),
    },
    {
      key: 'type',
      header: 'Type',
      sortValue: (e) => e.employeeType,
      secondary: true,
      render: (e) => <Chip tone="neutral">{EMPLOYEE_TYPE_LABEL[e.employeeType]}</Chip>,
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (e) => e.status,
      render: (e) => (
        <Chip
          tone={e.status === 'ACTIVE' ? 'success' : e.status === 'PROBATION' ? 'info' : e.status === 'ARCHIVED' ? 'neutral' : 'warning'}
          dot
        >
          {e.status.toLowerCase()}
        </Chip>
      ),
    },
    {
      key: 'wage',
      header: 'Wage',
      align: 'right',
      sortValue: (e) => money(currentContract(state, e.id)?.wage ?? '0').toNumber(),
      render: (e) => {
        const c = currentContract(state, e.id);
        if (!canSeeWage) return <span className="muted">Restricted</span>;
        return c ? formatMoney(c.wage) : <span className="muted">No contract</span>;
      },
    },
    {
      key: 'alerts',
      header: 'Alerts',
      render: (e) =>
        !e.bank?.verifiedAt ? (
          <Chip tone="warning" icon={TriangleAlert}>
            Bank
          </Chip>
        ) : (
          <span className="muted">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (e) => (
        <span className="row gap1" style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" onClick={() => openSidecar(e)}>
            Preview
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/employees/${e.id}`)}>
            Open
          </Button>
        </span>
      ),
    },
  ];

  const runBatch = () => {
    const ids = [...selected];
    let result;
    if (batch === 'schedule') result = batchAssignSchedule(ids, batchValue);
    else if (batch === 'structure') result = batchAssignStructure(ids, batchValue);
    else if (batch === 'payrun') result = batchAddToPayrun(ids);
    else if (batch === 'export') {
      downloadCsv(
        'employees.csv',
        ids.map((id) => {
          const e = state.employees.find((x) => x.id === id)!;
          const c = currentContract(state, id);
          return {
            code: e.employeeCode,
            name: e.fullName,
            email: e.email,
            department: deptName(state, e.departmentId),
            position: positionName(state, e.jobPositionId),
            type: e.employeeType,
            status: e.status,
            wage: canSeeWage ? (c?.wage ?? '') : 'restricted',
          };
        }),
      );
      result = { ok: true as const, message: `${ids.length} employees exported` };
    }
    if (result) toast.result(result);
    setBatch(null);
    setBatchValue('');
    setSelected(new Set());
  };

  const batchPreview = () => {
    const ids = [...selected];
    if (batch === 'schedule') {
      const conflicts = ids.filter((id) => {
        const e = state.employees.find((x) => x.id === id);
        return e && e.workingScheduleId !== batchValue && e.status !== 'ACTIVE';
      });
      return (
        <ConsequencePreview
          rows={[
            { label: 'Employees selected', before: '—', after: String(ids.length) },
            { label: 'New schedule', before: 'Various', after: scheduleName(state, batchValue) || 'Select one' },
            { label: 'Non-active employees affected', before: '—', after: String(conflicts.length) },
          ]}
          note="Assignment updates the employee record and their active contract, so payroll uses the new schedule from the next compute."
        />
      );
    }
    if (batch === 'structure') {
      return (
        <ConsequencePreview
          rows={[
            { label: 'Contracts updated', before: '—', after: String(ids.length) },
            {
              label: 'New structure',
              before: 'Various',
              after: state.salaryStructures.find((s) => s.id === batchValue)?.name ?? 'Select one',
            },
          ]}
          note="Amounts are not changed here. The next compute recalculates payslips with the new rule set."
        />
      );
    }
    if (batch === 'payrun') {
      const payrun = state.payruns.find((p) => p.id === state.activePayrunId)!;
      const added = ids.filter((id) => !payrun.employeeIds.includes(id));
      return (
        <ConsequencePreview
          rows={[
            { label: 'Selected', before: '—', after: String(ids.length) },
            { label: 'Already in the payrun', before: '—', after: String(ids.length - added.length) },
            { label: 'Will be added', before: String(payrun.employeeIds.length), after: String(payrun.employeeIds.length + added.length) },
          ]}
          note={`Target payrun: ${payrun.name} (${payrun.status}).`}
        />
      );
    }
    return (
      <ConsequencePreview
        rows={[{ label: 'Rows exported', before: '—', after: String(ids.length) }]}
        note={canSeeWage ? 'Wages are included because your role may read them.' : 'Wages are excluded — your role cannot read them.'}
      />
    );
  };

  return (
    <Page
      title="Employees"
      crumbs={['People', 'Employees']}
      actions={
        can(role, 'employee.write') && (
          <Button variant="primary" icon={UserPlus} onClick={() => setAddOpen(true)}>
            Add employee
          </Button>
        )
      }
    >
      <div className="grid grid-4">
        <Metric label="Total" value={rows.length} icon={Users} tone="brand" sub={`of ${state.employees.length} in the organisation`} />
        <Metric label="On probation" value={rows.filter((e) => e.status === 'PROBATION').length} />
        <Metric label="Missing bank details" value={rows.filter((e) => !e.bank?.verifiedAt).length} tone="warning" />
        <Metric
          label="Monthly wage bill"
          value={
            canSeeWage
              ? formatMoneyShort(
                  rows.reduce((sum, e) => sum + money(currentContract(state, e.id)?.wage ?? '0').toNumber(), 0),
                )
              : 'Restricted'
          }
          icon={Wallet}
        />
      </div>

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search name, code, email…" />
        <Select
          size2="sm"
          aria-label="Filter by department"
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          options={[{ value: 'ALL', label: 'All departments' }, ...state.departments.map((d) => ({ value: d.id, label: d.name }))]}
        />
        <Select
          size2="sm"
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: 'ALL', label: 'All statuses' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'PROBATION', label: 'Probation' },
            { value: 'NOTICE', label: 'Notice' },
            { value: 'ARCHIVED', label: 'Archived' },
          ]}
        />
        <Select
          size2="sm"
          aria-label="Filter by employee type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[
            { value: 'ALL', label: 'All types' },
            ...EMPLOYEE_TYPES.map((t) => ({ value: t, label: EMPLOYEE_TYPE_LABEL[t] })),
          ]}
        />
        <span className="spacer" style={{ flex: 1 }} />
        <Segmented
          ariaLabel="View mode"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'List', icon: List },
            { value: 'kanban', label: 'Board', icon: LayoutGrid },
          ]}
        />
      </div>

      {view === 'list' ? (
        <Card padding="flush">
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(e) => e.id}
            pageSize={12}
            caption="Employee directory"
            initialSort={{ key: 'name', dir: 1 }}
            highlight={highlight}
            selection={can(role, 'employee.write') ? { selected, onChange: setSelected } : undefined}
            onRowClick={(e) => openSidecar(e)}
            empty={
              <EmptyState
                icon={Users}
                title="No employees match these filters"
                description="Clear a filter or widen the search to see more people."
                action={
                  <Button
                    onClick={() => {
                      setQuery('');
                      setDept('ALL');
                      setStatus('ALL');
                      setType('ALL');
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            }
            mobileCard={(e) => (
              <>
                <div className="row between">
                  <span className="person">
                    <Avatar initials={e.initials} size="sm" />
                    <span className="truncate">
                      <span className="person-name">{e.fullName}</span>
                      <span className="person-meta">{positionName(state, e.jobPositionId)}</span>
                    </span>
                  </span>
                  <Chip tone={e.status === 'ACTIVE' ? 'success' : 'info'} dot>
                    {e.status.toLowerCase()}
                  </Chip>
                </div>
                <dl className="reccard-kv">
                  <dt>Department</dt>
                  <dd>{deptName(state, e.departmentId)}</dd>
                  {canSeeWage && (
                    <>
                      <dt>Wage</dt>
                      <dd className="mono">{formatMoney(currentContract(state, e.id)?.wage ?? '0')}</dd>
                    </>
                  )}
                </dl>
                <Button size="sm" block onClick={() => navigate(`/employees/${e.id}`)}>
                  Open record
                </Button>
              </>
            )}
          />
        </Card>
      ) : (
        <KanbanBoard rows={rows} onOpen={openSidecar} canEdit={can(role, 'employee.write')} onMoved={(id) => setHighlight(new Set([id]))} />
      )}

      {selected.size > 0 && (
        <div className="batchbar" role="region" aria-label="Batch actions">
          <span style={{ fontWeight: 700 }}>{selected.size} selected</span>
          <span className="sep" aria-hidden />
          <button type="button" onClick={() => setBatch('schedule')}>
            <CalendarDays size={14} /> Assign schedule
          </button>
          <button type="button" onClick={() => setBatch('structure')}>
            <SlidersHorizontal size={14} /> Assign structure
          </button>
          {can(role, 'payrun.create') && (
            <button type="button" onClick={() => setBatch('payrun')}>
              <Wallet size={14} /> Add to payrun
            </button>
          )}
          <button type="button" onClick={() => setBatch('export')}>
            <Download size={14} /> Export
          </button>
          <span className="sep" aria-hidden />
          <button type="button" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <ConfirmDialog
        open={batch !== null}
        onClose={() => setBatch(null)}
        onConfirm={runBatch}
        title={
          batch === 'schedule'
            ? 'Assign working schedule'
            : batch === 'structure'
              ? 'Assign salary structure'
              : batch === 'payrun'
                ? 'Add to active payrun'
                : 'Export selected employees'
        }
        confirmLabel={batch === 'export' ? 'Download CSV' : 'Apply to selection'}
      >
        <div className="col gap4">
          {batch === 'schedule' && (
            <Select
              label="Working schedule"
              required
              placeholder="Select a schedule"
              value={batchValue}
              onChange={(e) => setBatchValue(e.target.value)}
              options={state.schedules.map((s) => ({ value: s.id, label: `${s.name} · ${s.hoursPerWeek}h` }))}
            />
          )}
          {batch === 'structure' && (
            <Select
              label="Salary structure"
              required
              placeholder="Select a structure"
              value={batchValue}
              onChange={(e) => setBatchValue(e.target.value)}
              options={state.salaryStructures.map((s) => ({ value: s.id, label: s.name }))}
            />
          )}
          {batchPreview()}
        </div>
      </ConfirmDialog>

      <AddEmployeeDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => setHighlight(new Set([id]))}
      />
      {globalActions.active === 'new-employee' && null}
    </Page>
  );
}

/* ── Kanban ────────────────────────────────────────────────── */

function KanbanBoard({
  rows,
  onOpen,
  canEdit,
  onMoved,
}: {
  rows: Employee[];
  onOpen: (e: Employee) => void;
  canEdit: boolean;
  onMoved: (id: string) => void;
}) {
  const state = useStore();
  const toast = useToast();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (
    <div className="kanban scroll-x">
      {state.departments.map((d) => {
        const list = rows.filter((e) => e.departmentId === d.id);
        return (
          <section
            className="kanban-col"
            key={d.id}
            data-over={over === d.id || undefined}
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setOver(d.id);
            }}
            onDragLeave={() => setOver((o) => (o === d.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              if (!dragging || !canEdit) return;
              const r = moveEmployeeToDepartment(dragging, d.id);
              if (r.ok && r.message) {
                toast.success(`${r.message} to ${d.name}`);
                onMoved(dragging);
              }
              setDragging(null);
            }}
          >
            <header className="kanban-h">
              <span className="row gap2">
                <span
                  aria-hidden
                  style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--mark-1)', display: 'block' }}
                />
                {d.name}
              </span>
              <span className="tab-count">{list.length}</span>
            </header>
            <div className="kanban-b scroll-y">
              {list.length === 0 ? (
                <p className="muted center" style={{ fontSize: 'var(--fs-xs)', padding: 'var(--s3)' }}>
                  No one here
                </p>
              ) : (
                list.map((e) => (
                  <button
                    type="button"
                    className="kanban-card"
                    key={e.id}
                    draggable={canEdit}
                    data-dragging={dragging === e.id || undefined}
                    onDragStart={() => setDragging(e.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => onOpen(e)}
                  >
                    <span style={{ fontWeight: 650, fontSize: 'var(--fs-sm)' }}>{e.fullName}</span>
                    <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                      {positionName(state, e.jobPositionId)}
                    </span>
                    {!e.bank?.verifiedAt && (
                      <span className="mt2">
                        <Chip tone="warning" icon={TriangleAlert}>
                          Bank details
                        </Chip>
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
