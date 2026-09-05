import { useMemo, useState } from 'react';
import { FileText, FilePlus, TriangleAlert } from 'lucide-react';
import { can, isSelfScoped } from '@shared/permissions';
import { formatMoney, money } from '@shared/money';
import { diffDays, formatDate } from '@shared/dates';
import { EMPLOYEE_TYPES, EMPLOYEE_TYPE_LABEL, type Contract, type EmployeeType } from '@shared/types';
import { useStore } from '@/store/store';
import {
  contractPhase,
  currentEmployee,
  currentRole,
  deptName,
  empById,
} from '@/store/selectors';
import { createContract, terminateContract, updateContract, type ContractInput } from '@/store/actions';
import { EXPIRY_HORIZON_DAYS } from '@/data/seed';
import { Page } from '@/app/Page';
import { Avatar, Banner, Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { MoneyInput, SearchBox, Select, TextArea, TextInput } from '@/ui/form';
import { DataTable, type Column } from '@/ui/table';
import { Modal } from '@/ui/overlays';
import { useToast } from '@/ui/toast';

const EMPTY: ContractInput = {
  employeeId: '',
  startDate: '',
  endDate: '',
  departmentId: '',
  jobPositionId: '',
  employeeType: 'FULL_TIME',
  wage: '',
  salaryStructureId: '',
  workingScheduleId: '',
};

export function ContractsPage() {
  const state = useStore();
  const role = currentRole(state);
  const selfOnly = isSelfScoped(role);
  const me = currentEmployee(state);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'current' | 'expiring' | 'past'>('ALL');
  const [editing, setEditing] = useState<Contract | null>(null);
  const [creating, setCreating] = useState(false);
  const [terminating, setTerminating] = useState<Contract | null>(null);

  const scoped = useMemo(
    () => (selfOnly ? state.contracts.filter((c) => c.employeeId === me?.id) : state.contracts),
    [state.contracts, selfOnly, me],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter((c) => {
        const phase = contractPhase(state, c);
        if (filter === 'current' && phase !== 'current') return false;
        if (filter === 'past' && phase !== 'past') return false;
        if (filter === 'expiring') {
          if (!c.endDate || c.status !== 'ACTIVE') return false;
          const d = diffDays(c.endDate, state.today);
          if (d < 0 || d > EXPIRY_HORIZON_DAYS) return false;
        }
        if (!q) return true;
        const e = empById(state, c.employeeId);
        return (
          c.contractRef.toLowerCase().includes(q) ||
          (e?.fullName.toLowerCase().includes(q) ?? false) ||
          deptName(state, c.departmentId).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [scoped, query, filter, state]);

  const expiringSoon = scoped.filter((c) => {
    if (c.status !== 'ACTIVE' || !c.endDate) return false;
    const d = diffDays(c.endDate, state.today);
    return d >= 0 && d <= EXPIRY_HORIZON_DAYS;
  });

  const columns: Column<Contract>[] = [
    ...(selfOnly
      ? []
      : [
          {
            key: 'employee',
            header: 'Employee',
            sortValue: (c: Contract) => empById(state, c.employeeId)?.fullName ?? '',
            render: (c: Contract) => {
              const e = empById(state, c.employeeId);
              return (
                <span className="person">
                  <Avatar initials={e?.initials ?? '??'} size="sm" />
                  <span className="person-name truncate">{e?.fullName}</span>
                </span>
              );
            },
          } satisfies Column<Contract>,
        ]),
    {
      key: 'ref',
      header: 'Contract',
      sortValue: (c) => c.contractRef,
      render: (c) => <span className="mono">{c.contractRef}</span>,
    },
    { key: 'start', header: 'Start', sortValue: (c) => c.startDate, render: (c) => formatDate(c.startDate) },
    {
      key: 'end',
      header: 'End',
      sortValue: (c) => c.endDate ?? '9999',
      render: (c) => {
        if (!c.endDate) return <span className="muted">Open-ended</span>;
        const d = diffDays(c.endDate, state.today);
        const soon = c.status === 'ACTIVE' && d >= 0 && d <= EXPIRY_HORIZON_DAYS;
        return (
          <span style={soon ? { color: 'var(--warning)', fontWeight: 600 } : undefined}>
            {formatDate(c.endDate)}
            {soon && ` · ${d}d`}
          </span>
        );
      },
    },
    {
      key: 'phase',
      header: 'State',
      sortValue: (c) => contractPhase(state, c),
      render: (c) => {
        const phase = contractPhase(state, c);
        return (
          <Chip tone={phase === 'current' ? 'success' : phase === 'upcoming' ? 'info' : 'neutral'} dot>
            {phase}
          </Chip>
        );
      },
    },
    { key: 'dept', header: 'Department', secondary: true, sortValue: (c) => deptName(state, c.departmentId), render: (c) => deptName(state, c.departmentId) },
    {
      key: 'wage',
      header: 'Monthly wage',
      align: 'right',
      sortValue: (c) => money(c.wage).toNumber(),
      render: (c) => formatMoney(c.wage),
    },
    ...(can(role, 'contract.write')
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (c: Contract) => (
              <span className="row gap1" style={{ justifyContent: 'flex-end' }}>
                <Button size="sm" onClick={() => setEditing(c)}>
                  Edit
                </Button>
                {c.status === 'ACTIVE' && (
                  <Button size="sm" variant="ghost" onClick={() => setTerminating(c)}>
                    Terminate
                  </Button>
                )}
              </span>
            ),
          } satisfies Column<Contract>,
        ]
      : []),
  ];

  return (
    <Page
      title={selfOnly ? 'My contract' : 'Contracts'}
      crumbs={['People', 'Contracts']}
      actions={
        can(role, 'contract.write') && (
          <Button variant="primary" icon={FilePlus} onClick={() => setCreating(true)}>
            New contract
          </Button>
        )
      }
    >
      {!selfOnly && expiringSoon.length > 0 && (
        <Banner
          tone="warning"
          icon={TriangleAlert}
          title={`${expiringSoon.length} contract${expiringSoon.length === 1 ? '' : 's'} expiring within ${EXPIRY_HORIZON_DAYS} days`}
          action={
            <Button size="sm" onClick={() => setFilter('expiring')}>
              Show them
            </Button>
          }
        >
          {expiringSoon
            .map((c) => `${empById(state, c.employeeId)?.fullName} · ${c.contractRef} ends ${formatDate(c.endDate)}`)
            .join(' · ')}
        </Banner>
      )}

      {!selfOnly && (
        <div className="grid grid-4">
          <Metric label="Total contracts" value={scoped.length} icon={FileText} tone="brand" />
          <Metric label="Active" value={scoped.filter((c) => c.status === 'ACTIVE').length} />
          <Metric label="Expiring soon" value={expiringSoon.length} tone={expiringSoon.length ? 'warning' : undefined} />
          <Metric label="Historical" value={scoped.filter((c) => c.status !== 'ACTIVE').length} />
        </div>
      )}

      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search contract, employee, department…" />
        <Select
          size2="sm"
          aria-label="Filter contracts"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          options={[
            { value: 'ALL', label: 'All contracts' },
            { value: 'current', label: 'Current' },
            { value: 'expiring', label: 'Expiring soon' },
            { value: 'past', label: 'Historical' },
          ]}
        />
      </div>

      <Card padding="flush">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(c) => c.id}
          pageSize={12}
          caption="Contracts"
          empty={
            <EmptyState
              icon={FileText}
              title="No contracts match these filters"
              description={selfOnly ? 'Your contract will appear here once HR creates it.' : 'Clear the filters or create a contract.'}
            />
          }
          mobileCard={(c) => {
            const e = empById(state, c.employeeId);
            const phase = contractPhase(state, c);
            return (
              <>
                <div className="row between">
                  <span className="person">
                    <Avatar initials={e?.initials ?? '??'} size="sm" />
                    <span className="person-name">{e?.fullName}</span>
                  </span>
                  <Chip tone={phase === 'current' ? 'success' : 'neutral'} dot>
                    {phase}
                  </Chip>
                </div>
                <dl className="reccard-kv">
                  <dt>Contract</dt>
                  <dd className="mono">{c.contractRef}</dd>
                  <dt>Period</dt>
                  <dd>
                    {formatDate(c.startDate)} → {c.endDate ? formatDate(c.endDate) : 'open'}
                  </dd>
                  <dt>Wage</dt>
                  <dd className="mono">{formatMoney(c.wage)}</dd>
                </dl>
              </>
            );
          }}
        />
      </Card>

      <ContractDialog
        open={creating || editing !== null}
        contract={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      {terminating && (
        <TerminateDialog contract={terminating} onClose={() => setTerminating(null)} />
      )}
    </Page>
  );
}

function ContractDialog({
  open,
  contract,
  onClose,
}: {
  open: boolean;
  contract: Contract | null;
  onClose: () => void;
}) {
  const state = useStore();
  const toast = useToast();
  const [form, setForm] = useState<ContractInput>(EMPTY);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Seed the form when the dialog opens for a given contract.
  const target = contract?.id ?? 'new';
  if (open && seeded !== target) {
    setSeeded(target);
    setForm(
      contract
        ? {
            employeeId: contract.employeeId,
            startDate: contract.startDate,
            endDate: contract.endDate ?? '',
            departmentId: contract.departmentId,
            jobPositionId: contract.jobPositionId,
            employeeType: contract.employeeType,
            wage: contract.wage,
            salaryStructureId: contract.salaryStructureId,
            workingScheduleId: contract.workingScheduleId,
          }
        : {
            ...EMPTY,
            startDate: state.today,
            salaryStructureId: state.salaryStructures.find((s) => s.isActive)?.id ?? '',
            workingScheduleId: state.schedules[0]?.id ?? '',
            departmentId: state.departments[0]?.id ?? '',
            jobPositionId: '',
          },
    );
    setError(null);
  }
  if (!open) {
    if (seeded !== null) setSeeded(null);
    return null;
  }

  const set = (patch: Partial<ContractInput>) => setForm((f) => ({ ...f, ...patch }));
  const err = (f: string) => (error?.field === f ? error.message : undefined);

  const submit = () => {
    setPending(true);
    const r = contract ? updateContract(contract.id, form) : createContract(form);
    setPending(false);
    if (!r.ok) {
      setError({ field: r.field, message: r.error });
      return;
    }
    toast.success(r.message);
    onClose();
  };

  const positions = state.jobPositions.filter((p) => !p.departmentId || p.departmentId === form.departmentId);

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={contract ? 'Edit' : 'New record'}
      title={contract ? `Edit ${contract.contractRef}` : 'New contract'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} pending={pending}>
            {contract ? 'Save contract' : 'Create contract'}
          </Button>
        </>
      }
    >
      {error && !error.field && (
        <Banner tone="danger" icon={TriangleAlert} title="Cannot save">
          {error.message}
        </Banner>
      )}
      <div className="col gap4 mt3">
        <Select
          label="Employee"
          required
          disabled={Boolean(contract)}
          placeholder="Select employee"
          value={form.employeeId}
          error={err('employeeId')}
          onChange={(e) => set({ employeeId: e.target.value })}
          options={state.employees
            .filter((e) => e.status !== 'ARCHIVED')
            .map((e) => ({ value: e.id, label: `${e.fullName} · ${e.employeeCode}` }))}
        />
        <div className="grid grid-2">
          <TextInput
            label="Start date"
            type="date"
            required
            value={form.startDate}
            error={err('startDate')}
            onChange={(e) => set({ startDate: e.target.value })}
          />
          <TextInput
            label="End date"
            type="date"
            hint="Leave blank for an open-ended contract."
            value={form.endDate}
            error={err('endDate')}
            onChange={(e) => set({ endDate: e.target.value })}
          />
        </div>
        <div className="grid grid-2">
          <Select
            label="Department"
            required
            value={form.departmentId}
            onChange={(e) => set({ departmentId: e.target.value, jobPositionId: '' })}
            options={state.departments.map((d) => ({ value: d.id, label: d.name }))}
          />
          <Select
            label="Job position"
            required
            placeholder="Select position"
            value={form.jobPositionId}
            onChange={(e) => set({ jobPositionId: e.target.value })}
            options={positions.map((p) => ({ value: p.id, label: p.title }))}
          />
        </div>
        <div className="grid grid-2">
          <Select
            label="Employment type"
            value={form.employeeType}
            onChange={(e) => set({ employeeType: e.target.value as EmployeeType })}
            options={EMPLOYEE_TYPES.map((t) => ({ value: t, label: EMPLOYEE_TYPE_LABEL[t] }))}
          />
          <MoneyInput
            label="Monthly wage"
            required
            value={form.wage}
            error={err('wage')}
            onChange={(e) => set({ wage: e.target.value })}
          />
        </div>
        <div className="grid grid-2">
          <Select
            label="Salary structure"
            required
            value={form.salaryStructureId}
            onChange={(e) => set({ salaryStructureId: e.target.value })}
            options={state.salaryStructures.map((s) => ({ value: s.id, label: s.name }))}
          />
          <Select
            label="Working schedule"
            required
            value={form.workingScheduleId}
            onChange={(e) => set({ workingScheduleId: e.target.value })}
            options={state.schedules.map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
        <p className="field-hint">
          Overlapping active contracts are rejected — payroll must be able to resolve exactly one
          contract for any period.
        </p>
      </div>
    </Modal>
  );
}

function TerminateDialog({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const state = useStore();
  const toast = useToast();
  const [endDate, setEndDate] = useState(state.today);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Contract"
      title={`Terminate ${contract.contractRef}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              const r = terminateContract(contract.id, endDate, reason);
              if (!r.ok) {
                setError({ field: r.field, message: r.error });
                return;
              }
              toast.success(r.message);
              onClose();
            }}
          >
            Terminate contract
          </Button>
        </>
      }
    >
      <p className="mb4">
        {empById(state, contract.employeeId)?.fullName} will have no applicable contract after this
        date, which blocks any payroll period that starts later.
      </p>
      <div className="col gap4">
        <TextInput
          label="End date"
          type="date"
          required
          value={endDate}
          error={error?.field === 'endDate' ? error.message : undefined}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <TextArea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}
