import { useMemo, useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { useStore } from '@/store/store';
import { countLeaveDays, requestLeave } from '@/store/actions';
import { currentEmployee, currentRole, leaveBalance, visibleEmployees } from '@/store/selectors';
import { isSelfScoped } from '@shared/permissions';
import { Banner, Button } from '@/ui/primitives';
import { Checkbox, Select, TextArea, TextInput } from '@/ui/form';
import { Modal } from '@/ui/overlays';
import { ConsequencePreview } from '@/ui/feedback';
import { useToast } from '@/ui/toast';

export function RequestLeaveDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useStore();
  const toast = useToast();
  const me = currentEmployee(state);
  const selfOnly = isSelfScoped(currentRole(state));

  const [employeeId, setEmployeeId] = useState(me?.id ?? '');
  const [leaveTypeId, setLeaveTypeId] = useState(state.leaveTypes[0]?.id ?? '');
  const [fromDate, setFrom] = useState(state.today);
  const [toDate, setTo] = useState(state.today);
  const [halfStart, setHalfStart] = useState(false);
  const [halfEnd, setHalfEnd] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const target = employeeId || me?.id || '';
  const type = state.leaveTypes.find((t) => t.id === leaveTypeId);

  // X08 — live consequence preview from the same logic the mutation uses.
  const days = useMemo(
    () =>
      target && fromDate && toDate && toDate >= fromDate
        ? countLeaveDays(state, target, fromDate, toDate, halfStart, halfEnd)
        : 0,
    [state, target, fromDate, toDate, halfStart, halfEnd],
  );
  const balance = target && type ? leaveBalance(state, target, type.id) : null;

  const conflicts = useMemo(() => {
    if (!target || !fromDate) return [];
    const emp = state.employees.find((e) => e.id === target);
    if (!emp) return [];
    return state.leaveRequests.filter(
      (r) =>
        r.status === 'APPROVED' &&
        r.employeeId !== target &&
        state.employees.find((e) => e.id === r.employeeId)?.departmentId === emp.departmentId &&
        r.fromDate <= toDate &&
        r.toDate >= fromDate,
    );
  }, [state, target, fromDate, toDate]);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    const result = await requestLeave({
      employeeId: target,
      leaveTypeId,
      fromDate,
      toDate,
      halfDayStart: halfStart,
      halfDayEnd: halfEnd,
      reason,
    });
    setPending(false);
    if (!result.ok) {
      setError({ field: result.field, message: result.recovery ? `${result.error} ${result.recovery}` : result.error });
      return;
    }
    toast.success(result.message);
    setReason('');
    setError(null);
    onClose();
  };

  const err = (f: string) => (error?.field === f ? error.message : undefined);

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Time off"
      title="Request leave"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} pending={pending} disabled={days <= 0}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="col gap4">
        {error && !error.field && (
          <Banner tone="danger" icon={CalendarOff} title="Cannot submit">
            {error.message}
          </Banner>
        )}

        {!selfOnly && (
          <Select
            label="Employee"
            required
            value={target}
            options={visibleEmployees(state).map((e) => ({ value: e.id, label: e.fullName }))}
            onChange={(e) => setEmployeeId(e.target.value)}
          />
        )}

        <Select
          label="Leave type"
          required
          value={leaveTypeId}
          error={err('leaveTypeId')}
          options={state.leaveTypes.map((t) => ({
            value: t.id,
            label: `${t.name}${t.isPaid ? '' : ' (unpaid)'}`,
          }))}
          onChange={(e) => setLeaveTypeId(e.target.value)}
        />

        <div className="grid grid-2">
          <TextInput
            label="From"
            type="date"
            required
            value={fromDate}
            error={err('fromDate')}
            onChange={(e) => {
              setFrom(e.target.value);
              if (e.target.value > toDate) setTo(e.target.value);
            }}
          />
          <TextInput
            label="To"
            type="date"
            required
            value={toDate}
            min={fromDate}
            error={err('toDate')}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        <div className="row gap4 wrap">
          <Checkbox checked={halfStart} onChange={setHalfStart} label="First day is a half day" />
          {fromDate !== toDate && (
            <Checkbox checked={halfEnd} onChange={setHalfEnd} label="Last day is a half day" />
          )}
        </div>

        <TextArea
          label="Reason"
          rows={2}
          placeholder="Optional — helps your manager decide faster."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />

        {balance && type && (
          <ConsequencePreview
            rows={[
              {
                label: 'Working days requested',
                before: '—',
                after: `${days} day${days === 1 ? '' : 's'}`,
              },
              ...(type.requiresAllocation && balance.exists
                ? [
                    {
                      label: `${type.name} balance`,
                      before: `${balance.remaining} left`,
                      after: `${balance.remaining - days} left`,
                      delta: {
                        text: `−${days}`,
                        positive: balance.remaining - days >= 0,
                      },
                    },
                  ]
                : []),
              ...(type.isPaid
                ? []
                : [
                    {
                      label: 'Payroll effect',
                      before: 'No deduction',
                      after: `${days} unpaid day${days === 1 ? '' : 's'} deducted`,
                      delta: { text: 'reduces net pay', positive: false },
                    },
                  ]),
            ]}
            note={
              conflicts.length > 0
                ? `${conflicts.length} teammate${conflicts.length === 1 ? ' is' : 's are'} already away in this department during these dates.`
                : `Dates that fall on a weekly off or a company holiday are not counted.`
            }
          />
        )}

        {days <= 0 && fromDate && toDate && (
          <p className="field-err">That range contains no working days for this employee.</p>
        )}
      </div>
    </Modal>
  );
}
