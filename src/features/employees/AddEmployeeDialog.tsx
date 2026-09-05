import { useMemo, useRef, useState } from 'react';
import { EMPLOYEE_TYPES, EMPLOYEE_TYPE_LABEL, type EmployeeType } from '@shared/types';
import { useStore } from '@/store/store';
import { createEmployee, type NewEmployeeInput } from '@/store/actions';
import { Button } from '@/ui/primitives';
import { MoneyInput, Select, TextInput } from '@/ui/form';
import { Modal } from '@/ui/overlays';
import { useToast } from '@/ui/toast';

const EMPTY: NewEmployeeInput = {
  firstName: '',
  lastName: '',
  email: '',
  departmentId: '',
  jobPositionId: '',
  employeeType: 'FULL_TIME',
  wage: '',
  salaryStructureId: '',
  workingScheduleId: '',
  managerId: '',
  joinDate: '',
};

export function AddEmployeeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const state = useStore();
  const toast = useToast();
  const [form, setForm] = useState<NewEmployeeInput>(EMPTY);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const firstInvalid = useRef<HTMLElement | null>(null);

  // X03 — smart defaults derived from real context, always visible and editable.
  const defaults = useMemo<NewEmployeeInput>(
    () => ({
      ...EMPTY,
      salaryStructureId: state.salaryStructures.find((s) => s.isActive)?.id ?? '',
      workingScheduleId: state.schedules.find((s) => s.isActive)?.id ?? '',
      joinDate: state.today,
    }),
    [state.salaryStructures, state.schedules, state.today],
  );

  const value = { ...defaults, ...form };
  const positions = state.jobPositions.filter(
    (p) => !value.departmentId || !p.departmentId || p.departmentId === value.departmentId,
  );

  const set = (patch: Partial<NewEmployeeInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError((e) => (e && patch[e.field as keyof NewEmployeeInput] !== undefined ? null : e));
  };

  const submit = () => {
    setPending(true);
    const result = createEmployee(value);
    setPending(false);
    if (!result.ok) {
      setError({ field: result.field, message: result.error });
      window.requestAnimationFrame(() => {
        const el = document.getElementById(`emp-${result.field}`);
        el?.focus();
        firstInvalid.current = el;
      });
      return;
    }
    toast.success(`${result.value.fullName} created — onboarding checklist started`);
    onCreated?.(result.value.id);
    setForm(EMPTY);
    setError(null);
    onClose();
  };

  const err = (field: string) => (error?.field === field ? error.message : undefined);

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New record"
      title="Add employee"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} pending={pending}>
            Create employee
          </Button>
        </>
      }
    >
      {error && !error.field && (
        <p className="field-err mb3" role="alert">
          {error.message}
        </p>
      )}

      <div className="col gap4">
        <div className="grid grid-2">
          <TextInput
            id="emp-firstName"
            label="First name"
            required
            autoComplete="given-name"
            placeholder="e.g. Riya"
            value={value.firstName}
            error={err('firstName')}
            onChange={(e) => set({ firstName: e.target.value })}
          />
          <TextInput
            id="emp-lastName"
            label="Last name"
            required
            autoComplete="family-name"
            placeholder="e.g. Verma"
            value={value.lastName}
            error={err('lastName')}
            onChange={(e) => set({ lastName: e.target.value })}
          />
        </div>

        <TextInput
          id="emp-email"
          label="Work email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="name@peoplepay360.com"
          value={value.email}
          error={err('email')}
          onChange={(e) => set({ email: e.target.value })}
        />

        <div className="grid grid-2">
          <Select
            id="emp-departmentId"
            label="Department"
            required
            placeholder="Select department"
            value={value.departmentId}
            error={err('departmentId')}
            options={state.departments.map((d) => ({ value: d.id, label: d.name }))}
            onChange={(e) => set({ departmentId: e.target.value, jobPositionId: '' })}
          />
          <Select
            id="emp-jobPositionId"
            label="Job position"
            required
            placeholder="Select position"
            value={value.jobPositionId}
            error={err('jobPositionId')}
            options={positions.map((p) => ({ value: p.id, label: p.title }))}
            onChange={(e) => set({ jobPositionId: e.target.value })}
          />
        </div>

        <div className="grid grid-2">
          <Select
            id="emp-employeeType"
            label="Employee type"
            value={value.employeeType}
            options={EMPLOYEE_TYPES.map((t) => ({ value: t, label: EMPLOYEE_TYPE_LABEL[t] }))}
            onChange={(e) => set({ employeeType: e.target.value as EmployeeType })}
          />
          <MoneyInput
            id="emp-wage"
            label="Monthly wage"
            required
            hint="Stored on the contract, not the employee record."
            value={value.wage}
            error={err('wage')}
            onChange={(e) => set({ wage: e.target.value })}
          />
        </div>

        <div className="grid grid-2">
          <Select
            id="emp-salaryStructureId"
            label="Salary structure"
            required
            value={value.salaryStructureId}
            error={err('salaryStructureId')}
            options={state.salaryStructures.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(e) => set({ salaryStructureId: e.target.value })}
          />
          <Select
            id="emp-workingScheduleId"
            label="Working schedule"
            required
            value={value.workingScheduleId}
            error={err('workingScheduleId')}
            options={state.schedules.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(e) => set({ workingScheduleId: e.target.value })}
          />
        </div>

        <div className="grid grid-2">
          <Select
            id="emp-managerId"
            label="Manager"
            placeholder="No manager"
            value={value.managerId}
            options={state.employees
              .filter((e) => e.status === 'ACTIVE')
              .map((e) => ({ value: e.id, label: e.fullName }))}
            onChange={(e) => set({ managerId: e.target.value })}
          />
          <TextInput
            id="emp-joinDate"
            label="Joining date"
            type="date"
            required
            value={value.joinDate}
            error={err('joinDate')}
            onChange={(e) => set({ joinDate: e.target.value })}
          />
        </div>

        <p className="field-hint">
          Creating an employee opens an onboarding checklist. Items marked as payroll-blocking —
          bank details, signed contract, schedule — feed the payroll readiness score straight away.
        </p>
      </div>
    </Modal>
  );
}
