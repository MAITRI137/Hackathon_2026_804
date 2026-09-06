/**
 * Blocker cards and their resolution surfaces.
 *
 * Resolving fixes the underlying record — a bank detail is verified, a
 * checkout time is written, a duplicate payslip row is removed. Nothing here
 * sets a "resolved" flag; the next readiness read simply stops finding it.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  Copy,
  FileWarning,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import type { PayrollException } from '@shared/types';
import { formatDate, formatDuration, minutesOfDay } from '@shared/dates';
import { formatMoney } from '@shared/money';
import { hydrateFromServer, useStore } from '@/store/store';
import { empById, payslipsOf } from '@/store/selectors';
import { bootstrapPayroll, cancelDuplicatePayslip } from '@/store/actions';
import { refreshBootstrap, resolvePayrunAttendance, resolvePayrunBank } from '@/lib/api';
import { Avatar, Banner, Button, Chip, InfoGrid } from '@/ui/primitives';
import { TextArea, TextInput } from '@/ui/form';
import { Modal } from '@/ui/overlays';
import { ConsequencePreview } from '@/ui/feedback';
import { useToast } from '@/ui/toast';

const KIND_ICON = {
  MISSING_BANK: Banknote,
  DUPLICATE_BANK_ACCOUNT: Banknote,
  MISSING_CHECKOUT: CalendarClock,
  DUPLICATE_PAYSLIP: Copy,
  NO_CONTRACT: FileWarning,
  AMBIGUOUS_CONTRACT: FileWarning,
  INVALID_RULE: ShieldAlert,
  NEGATIVE_NET: ShieldAlert,
  ONBOARDING_INCOMPLETE: FileWarning,
  UNAPPROVED_LEAVE: CalendarClock,
  CONTRACT_EXPIRING: FileWarning,
  SALARY_VARIANCE: TriangleAlert,
  LEAVER_PAID: ShieldAlert,
  EXCESSIVE_OVERTIME: CalendarClock,
} as const;

export function BlockerCard({
  exception,
  onResolve,
  leaving,
}: {
  exception: PayrollException;
  onResolve: () => void;
  leaving?: boolean;
}) {
  const state = useStore();
  const emp = empById(state, exception.employeeId);
  const Icon = KIND_ICON[exception.kind] ?? AlertTriangle;
  const canFix = exception.resolution !== 'REVIEW' && exception.resolution !== 'CONTRACT';

  return (
    <div
      className={`blocker${leaving ? ' leaving' : ''}`}
      data-sev={exception.blocking ? 'blocking' : 'warn'}
    >
      <span className="blocker-icon" aria-hidden>
        <Icon size={17} />
      </span>
      <div className="blocker-body">
        <div className="row gap2 wrap">
          <span className="blocker-title">{emp?.fullName ?? 'Payroll'}</span>
          <Chip tone={exception.blocking ? 'danger' : 'warning'} dot>
            {exception.blocking ? 'Blocking' : 'Warning'}
          </Chip>
        </div>
        <div className="blocker-desc">
          <strong>{exception.title}</strong> — {exception.detail}
        </div>
      </div>
      <Button
        variant={exception.blocking ? 'primary' : 'secondary'}
        size="sm"
        icon={ArrowRight}
        onClick={onResolve}
      >
        {canFix ? 'Resolve' : 'Review'}
      </Button>
    </div>
  );
}

/* ── Resolution dialogs ────────────────────────────────────── */

export function ResolveDialog({
  exception,
  onClose,
}: {
  exception: PayrollException | null;
  onClose: () => void;
}) {
  if (!exception) return null;
  switch (exception.resolution) {
    case 'BANK_DETAILS':
      return <BankDetailsDialog exception={exception} onClose={onClose} />;
    case 'ATTENDANCE_CHECKOUT':
      return <CheckoutDialog exception={exception} onClose={onClose} />;
    case 'REMOVE_DUPLICATE':
      return <DuplicateDialog exception={exception} onClose={onClose} />;
    default:
      return <ReviewDialog exception={exception} onClose={onClose} />;
  }
}

function Header({ exception, children }: { exception: PayrollException; children?: ReactNode }) {
  const state = useStore();
  const emp = empById(state, exception.employeeId);
  return (
    <div className="col gap3 mb4">
      <Banner
        tone={exception.blocking ? 'danger' : 'warning'}
        icon={AlertTriangle}
        title={exception.title}
      >
        {exception.detail}
      </Banner>
      {emp && (
        <div className="row gap3">
          <Avatar initials={emp.initials} size="lg" />
          <div>
            <div style={{ fontWeight: 650 }}>{emp.fullName}</div>
            <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              {emp.employeeCode} · {emp.email}
            </div>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

function BankDetailsDialog({
  exception,
  onClose,
}: {
  exception: PayrollException;
  onClose: () => void;
}) {
  const toast = useToast();
  const state = useStore();
  const emp = empById(state, exception.employeeId);
  const [form, setForm] = useState({
    accountName: emp?.fullName ?? '',
    accountNumber: '',
    ifsc: '',
    bankName: '',
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!exception.employeeId) return;
    setPending(true);
    try {
      await resolvePayrunBank(state.activePayrunId, { employeeId: exception.employeeId, ...form });
      hydrateFromServer(await refreshBootstrap());
      bootstrapPayroll();
      toast.success('Bank details verified — the blocker is cleared');
      onClose();
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Could not save bank details.' });
    } finally {
      setPending(false);
    }
  };

  const err = (f: string) => (error?.field === f ? error.message : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Resolve exception"
      title="Add bank details"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} pending={pending}>
            Save and verify
          </Button>
        </>
      }
    >
      <Header exception={exception} />
      <div className="col gap4">
        {error && !error.field && (
          <Banner tone="danger" icon={AlertTriangle} title="Bank details were not saved">
            {error.message}
          </Banner>
        )}
        <TextInput
          label="Account holder name"
          required
          autoComplete="name"
          value={form.accountName}
          error={err('accountName')}
          onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
        />
        <div className="grid grid-2">
          <TextInput
            label="Account number"
            required
            inputMode="numeric"
            placeholder="9–18 digits"
            value={form.accountNumber}
            error={err('accountNumber')}
            onChange={(e) =>
              setForm((f) => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') }))
            }
          />
          <TextInput
            label="IFSC code"
            required
            placeholder="HDFC0001234"
            value={form.ifsc}
            error={err('ifsc')}
            onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))}
          />
        </div>
        <TextInput
          label="Bank name"
          required
          value={form.bankName}
          error={err('bankName')}
          onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
        />
        <p className="field-hint">
          Only the last four digits are stored in the interface. Saving marks the account verified,
          completes the onboarding item it came from, and clears this payroll blocker.
        </p>
      </div>
    </Modal>
  );
}

function CheckoutDialog({
  exception,
  onClose,
}: {
  exception: PayrollException;
  onClose: () => void;
}) {
  const toast = useToast();
  const state = useStore();
  const record = state.attendance.find((a) => a.id === exception.refId);
  const emp = empById(state, exception.employeeId);
  const schedule = state.schedules.find((s) => s.id === emp?.workingScheduleId);
  const scheduledEnd = schedule?.lines[0]?.end ?? '18:00';

  // Y06 — two evidenced proposals, shown side by side. Neither is applied silently.
  const median = useMemo(() => {
    if (!emp) return scheduledEnd;
    const recent = state.attendance
      .filter((a) => a.employeeId === emp.id && a.checkOut)
      .slice(-20)
      .map((a) => minutesOfDay(a.checkOut!))
      .sort((a, b) => a - b);
    if (recent.length === 0) return scheduledEnd;
    const mid = recent[Math.floor(recent.length / 2)];
    return `${String(Math.floor(mid / 60)).padStart(2, '0')}:${String(mid % 60).padStart(2, '0')}`;
  }, [state.attendance, emp, scheduledEnd]);

  const [checkOut, setCheckOut] = useState(scheduledEnd);
  const [reason, setReason] = useState('Employee confirmed the checkout time was not recorded.');
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const worked =
    record?.checkIn && /^\d{2}:\d{2}$/.test(checkOut)
      ? minutesOfDay(checkOut) - minutesOfDay(record.checkIn) - 60
      : 0;

  const submit = async () => {
    if (!record) return;
    setPending(true);
    try {
      await resolvePayrunAttendance(state.activePayrunId, {
        attendanceId: record.id,
        checkOut,
        reason,
      });
      hydrateFromServer(await refreshBootstrap());
      bootstrapPayroll();
      toast.success('Checkout recorded — worked hours recalculated');
      onClose();
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Could not save the correction.' });
    } finally {
      setPending(false);
    }
  };

  if (!record) {
    return (
      <Modal open onClose={onClose} title="Attendance record not found">
        <p>
          The record this exception referred to no longer exists. Recompute the payrun to refresh.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Resolve exception"
      title="Record the missing checkout"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} pending={pending}>
            Save correction
          </Button>
        </>
      }
    >
      <Header exception={exception}>
        <InfoGrid
          items={[
            { label: 'Date', value: formatDate(record.date) },
            { label: 'Checked in', value: record.checkIn ?? '—', mono: true },
            { label: 'Checked out', value: 'Missing' },
            { label: 'Recorded by', value: record.source.toLowerCase() },
          ]}
        />
      </Header>

      <div className="col gap4">
        {error && !error.field && (
          <Banner tone="danger" icon={AlertTriangle} title="Checkout was not saved">
            {error.message}
          </Banner>
        )}
        <div className="row gap2 wrap">
          <Button size="sm" onClick={() => setCheckOut(scheduledEnd)}>
            Use scheduled end ({scheduledEnd})
          </Button>
          <Button size="sm" onClick={() => setCheckOut(median)}>
            Use their usual time ({median})
          </Button>
        </div>

        <div className="grid grid-2">
          <TextInput
            label="Checkout time"
            type="time"
            required
            value={checkOut}
            error={error?.field === 'checkOut' ? error.message : undefined}
            onChange={(e) => setCheckOut(e.target.value)}
          />
          <div className="field">
            <span className="field-l">Worked duration</span>
            <div
              className="input"
              style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-3)' }}
            >
              <span className="mono">{worked > 0 ? formatDuration(worked) : '—'}</span>
            </div>
            <span className="field-hint">
              Derived from the timestamps, minus a 60-minute break.
            </span>
          </div>
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
          The correction is recorded against your name in the audit trail and shown on the
          attendance row.
        </p>
      </div>
    </Modal>
  );
}

function DuplicateDialog({
  exception,
  onClose,
}: {
  exception: PayrollException;
  onClose: () => void;
}) {
  const toast = useToast();
  const state = useStore();
  const emp = empById(state, exception.employeeId);
  const slips = payslipsOf(state, state.activePayrunId).filter(
    (p) => p.employeeId === exception.employeeId,
  );
  const [selected, setSelected] = useState(
    exception.refId ?? slips.find((s) => s.isDuplicate)?.id ?? '',
  );
  const [pending, setPending] = useState(false);

  const submit = () => {
    setPending(true);
    const r = cancelDuplicatePayslip(selected);
    setPending(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success('Duplicate payslip removed');
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Resolve exception"
      title="Remove the duplicate payslip"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={submit} pending={pending} disabled={!selected}>
            Remove selected payslip
          </Button>
        </>
      }
    >
      <Header exception={exception} />
      <div className="col gap3">
        <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>
          {slips.length} payslips exist for {emp?.fullName} in this period. Keep the original and
          remove the duplicate — totals recalculate immediately.
        </p>
        {slips.map((s) => (
          <label
            key={s.id}
            className="check radio"
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--r)',
              padding: 'var(--s3)',
              alignItems: 'flex-start',
              background: selected === s.id ? 'var(--danger-bg)' : 'var(--surface)',
            }}
          >
            <input
              type="radio"
              name="dup"
              checked={selected === s.id}
              onChange={() => setSelected(s.id)}
            />
            <span className="box" aria-hidden />
            <span className="grow">
              <span className="row between wrap">
                <b className="mono">{s.payslipRef}</b>
                <span className="mono">{formatMoney(s.net)}</span>
              </span>
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                Computed {formatDate(s.computedAt.slice(0, 10))}
                {s.isDuplicate ? ' · flagged as duplicate' : ' · original'}
              </span>
            </span>
          </label>
        ))}
        <ConsequencePreview
          rows={[
            {
              label: 'Payslips for this employee',
              before: String(slips.length),
              after: String(Math.max(0, slips.length - 1)),
              delta: { text: '−1', positive: true },
            },
          ]}
          note="Removing a duplicate does not change any computed amount on the remaining payslip."
        />
      </div>
    </Modal>
  );
}

function ReviewDialog({
  exception,
  onClose,
}: {
  exception: PayrollException;
  onClose: () => void;
}) {
  const state = useStore();
  const emp = empById(state, exception.employeeId);
  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Exception detail"
      title={exception.title}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Header exception={exception} />
      <InfoGrid
        items={[
          { label: 'Kind', value: exception.kind.replace(/_/g, ' ').toLowerCase() },
          { label: 'Category', value: exception.category.toLowerCase() },
          { label: 'Severity', value: `${exception.severity} readiness points` },
          { label: 'Blocks payroll', value: exception.blocking ? 'Yes' : 'No' },
        ]}
      />
      <p className="mt4 secondary" style={{ fontSize: 'var(--fs-sm)' }}>
        {exception.blocking
          ? 'Payroll cannot be validated while this exception is open. Fix the underlying record and recompute.'
          : 'This is a warning. It does not block validation, but it may change the computed result once resolved.'}
      </p>
      {emp && (
        <p className="mt3">
          <a href={`#/employees/${emp.id}`}>Open {emp.fullName}&apos;s record →</a>
        </p>
      )}
    </Modal>
  );
}

/** Small helper: fades the card out before the list re-renders without it. */
export function useLeavingIds() {
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (leaving.size === 0) return;
    const t = window.setTimeout(() => setLeaving(new Set()), 320);
    return () => window.clearTimeout(t);
  }, [leaving]);
  return {
    leaving,
    markLeaving: (id: string) => setLeaving((s) => new Set([...s, id])),
  };
}
