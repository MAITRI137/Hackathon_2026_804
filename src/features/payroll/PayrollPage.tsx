/**
 * The Payroll Control Room — the primary payroll-manager surface.
 *
 * Priority order on screen: blocker → active state → key money → context.
 * Never a wall of equally loud KPI tiles.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  BadgeIndianRupee,
  CalendarPlus,
  CircleCheck,
  Lock,
  LockOpen,
  RefreshCw,
  Send,
  ShieldCheck,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react';
import { can } from '@shared/permissions';
import { formatMoney, formatMoneyShort } from '@shared/money';
import { formatDate, formatDateTime, monthLabel } from '@shared/dates';
import { useStore } from '@/store/store';
import {
  activePayrun,
  canValidate,
  currentRole,
  exceptionsFor,
  nextBestAction,
  readinessFor,
  totalsFor,
} from '@/store/selectors';
import { netLabel } from '@/store/payroll';
import {
  computeActivePayrun,
  createPayrunFromPrevious,
  markActivePayrunPaid,
  reopenPayrun,
  sendPayslips,
  setActivePayrun,
  setPayrunFrozen,
  validateActivePayrun,
} from '@/store/actions';
import { Page } from '@/app/Page';
import { Banner, Button, Card, Chip, Metric } from '@/ui/primitives';
import { Select, TextArea } from '@/ui/form';
import { ConfirmDialog, Drawer } from '@/ui/overlays';
import { ConsequencePreview, Ring, Stepper } from '@/ui/feedback';
import { HBars } from '@/ui/charts';
import { useToast } from '@/ui/toast';
import { BlockerCard, ResolveDialog, useLeavingIds } from './BlockerResolve';
import type { PayrollException } from '@shared/types';

const STEPS = [
  { key: 'DRAFT', label: 'Draft', caption: 'Selection made' },
  { key: 'COMPUTED', label: 'Computed', caption: 'Review results' },
  { key: 'VALIDATED', label: 'Validated', caption: 'Authorise payment' },
  { key: 'PAID', label: 'Paid', caption: 'Preserve history' },
];

export function PayrollPage() {
  const state = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const role = currentRole(state);

  const payrun = activePayrun(state);
  const exceptions = useMemo(() => exceptionsFor(state, payrun), [state, payrun]);
  const readiness = useMemo(() => readinessFor(state, payrun), [state, payrun]);
  const totals = useMemo(() => totalsFor(state, payrun.id), [state, payrun.id]);
  const nba = useMemo(() => nextBestAction(state), [state]);
  const validate = canValidate(state, payrun);

  const [resolving, setResolving] = useState<PayrollException | null>(null);
  const [confirm, setConfirm] = useState<'validate' | 'pay' | 'send' | null>(null);
  const [reopen, setReopen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showAllDetail, setShowAllDetail] = useState(false);
  const { leaving, markLeaving } = useLeavingIds();

  const blocking = exceptions.filter((e) => e.blocking);
  const warnings = exceptions.filter((e) => !e.blocking);

  const run = (key: string, fn: () => { ok: boolean; message?: string; error?: string }) => {
    if (busy) return;
    setBusy(key);
    const r = fn();
    setBusy(null);
    toast.result(r);
    setConfirm(null);
  };

  return (
    <Page
      title="Payroll Control Room"
      crumbs={['Payroll', monthLabel(payrun.periodStart)]}
      actions={
        <>
          <Select
            size2="sm"
            aria-label="Active payroll period"
            value={payrun.id}
            options={state.payruns
              .slice()
              .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
              .map((p) => ({ value: p.id, label: `${monthLabel(p.periodStart)} · ${p.status}` }))}
            onChange={(e) => setActivePayrun(e.target.value)}
          />
          {can(role, 'payrun.create') && (
            <Button
              size="sm"
              icon={CalendarPlus}
              onClick={() => {
                const r = createPayrunFromPrevious();
                if (r.ok) {
                  toast.success(
                    `${r.message} — ${r.value.added.length} added, ${r.value.removed.length} removed`,
                  );
                } else {
                  toast.error(r.error);
                }
              }}
            >
              New period from last
            </Button>
          )}
        </>
      }
    >
      <Stepper steps={STEPS} current={payrun.status} />

      {/* 1 — state and the single next action */}
      <div className="grid split-main">
        <Card padding="tight">
          <div className="row gap5 wrap" style={{ alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 200 }}>
              <div className="eyebrow">Active payrun</div>
              <h3 style={{ fontSize: 'var(--fs-xl)', fontWeight: 750, marginTop: 2 }}>{payrun.name}</h3>
              <div className="row gap2 wrap mt2">
                <Chip tone={payrun.status === 'PAID' ? 'success' : 'info'} dot>
                  {payrun.status}
                </Chip>
                {payrun.isFrozen && (
                  <Chip tone="warning" icon={Lock}>
                    Inputs frozen
                  </Chip>
                )}
                <Chip tone="neutral">
                  {formatDate(payrun.periodStart)} → {formatDate(payrun.periodEnd)}
                </Chip>
                <Chip tone="neutral">{payrun.expectedWorkDays} working days</Chip>
              </div>
              {payrun.computedAt && (
                <p className="muted mt2" style={{ fontSize: 'var(--fs-xs)' }}>
                  Last computed {formatDateTime(payrun.computedAt)}
                  {payrun.inputSnapshotHash && ` · inputs ${payrun.inputSnapshotHash.slice(0, 8)}`}
                </p>
              )}
            </div>
            <div className="col" style={{ alignItems: 'center', gap: 4 }}>
              <Ring percent={readiness.score} />
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                {blocking.length === 0
                  ? 'No blocking exceptions'
                  : `${blocking.length} blocking · ${warnings.length} warning`}
              </span>
            </div>
          </div>
        </Card>

        <div className="nba">
          <span className="lbl">Next best action</span>
          <span className="txt">{nba.label}</span>
          <span className="why">{nba.reason}</span>
          <Button className="btn" onClick={() => navigate(nba.to)}>
            {nba.cta}
          </Button>
        </div>
      </div>

      {/* 2 — blockers, before any totals */}
      {blocking.length > 0 ? (
        <Card
          title={`Blocking exceptions (${blocking.length})`}
          action={
            <Link to="/payroll/exceptions">
              <Button size="sm">Open exception centre</Button>
            </Link>
          }
          padding="tight"
        >
          <div className="col gap2">
            {blocking.slice(0, 4).map((e) => (
              <BlockerCard
                key={e.id}
                exception={e}
                leaving={leaving.has(e.id)}
                onResolve={() => setResolving(e)}
              />
            ))}
            {blocking.length > 4 && (
              <Link to="/payroll/exceptions" style={{ fontSize: 'var(--fs-sm)' }}>
                {blocking.length - 4} more blocking exceptions →
              </Link>
            )}
          </div>
        </Card>
      ) : (
        <Banner
          tone="success"
          icon={CircleCheck}
          title="No blocking exceptions"
          action={
            payrun.status === 'COMPUTED' && can(role, 'payrun.validate') ? (
              <Button variant="success" size="sm" onClick={() => setConfirm('validate')}>
                Validate now
              </Button>
            ) : undefined
          }
        >
          Every input for {monthLabel(payrun.periodStart)} is complete
          {warnings.length > 0 && ` — ${warnings.length} non-blocking warning${warnings.length === 1 ? '' : 's'} remain`}.
        </Banner>
      )}

      {/* 3 — key money */}
      <div className="grid grid-4">
        <Metric
          label="Employees in run"
          value={totals.count}
          icon={Users}
          sub={`${payrun.employeeIds.length} selected`}
        />
        <Metric label="Gross" value={formatMoneyShort(totals.gross)} tone="brand" icon={Wallet} sub={formatMoney(totals.gross)} />
        <Metric
          label="Deductions"
          value={formatMoneyShort(totals.deductions)}
          tone="warning"
          sub="Unpaid leave and configured deductions"
        />
        <Metric
          label={netLabel(payrun.status)}
          value={formatMoneyShort(totals.net)}
          tone="success"
          icon={BadgeIndianRupee}
          sub={formatMoney(totals.net)}
        />
      </div>

      {/* 4 — supporting context */}
      <div className="grid split-side">
        <Card title="Input completeness by category" padding="tight">
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
          <p className="muted mt3" style={{ fontSize: 'var(--fs-xs)' }}>
            Bars show the share of employees with clean inputs in each category. The ring above is the
            readiness score: 100 minus the severity of every open blocking exception.
          </p>
        </Card>

        <Card
          title="Warnings"
          subtitle="Do not block validation, but may change the result"
          padding="tight"
        >
          {warnings.length === 0 ? (
            <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 'var(--s3) 0' }}>
              Nothing flagged.
            </p>
          ) : (
            <div className="col gap2">
              {warnings.slice(0, showAllDetail ? warnings.length : 3).map((e) => (
                <BlockerCard key={e.id} exception={e} onResolve={() => setResolving(e)} />
              ))}
              {warnings.length > 3 && (
                <Button size="sm" variant="ghost" onClick={() => setShowAllDetail((v) => !v)}>
                  {showAllDetail ? 'Show fewer' : `Show ${warnings.length - 3} more`}
                </Button>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* 5 — actions, always reachable */}
      <div className="actionbar">
        {can(role, 'payrun.compute') && (
          <Button
            icon={RefreshCw}
            onClick={() => run('compute', computeActivePayrun)}
            pending={busy === 'compute'}
            disabled={payrun.status === 'VALIDATED' || payrun.status === 'PAID'}
            title={
              payrun.status === 'VALIDATED' || payrun.status === 'PAID'
                ? 'Reopen the payrun before recomputing'
                : undefined
            }
          >
            {payrun.status === 'DRAFT' ? 'Compute' : 'Recompute'}
          </Button>
        )}

        {can(role, 'payrun.freeze') && (
          <Button
            icon={payrun.isFrozen ? LockOpen : Lock}
            onClick={() => run('freeze', () => setPayrunFrozen(!payrun.isFrozen, 'Operator unfroze the period'))}
            pending={busy === 'freeze'}
          >
            {payrun.isFrozen ? 'Unfreeze inputs' : 'Freeze inputs'}
          </Button>
        )}

        {can(role, 'simulation.run') && (
          <Link to="/simulation">
            <Button icon={Activity}>Simulate</Button>
          </Link>
        )}

        <span className="spacer" />

        {payrun.status === 'PAID' && can(role, 'payrun.reopen') && (
          <Button icon={LockOpen} onClick={() => setReopen(true)}>
            Reopen
          </Button>
        )}

        {can(role, 'payslip.send') && (payrun.status === 'VALIDATED' || payrun.status === 'PAID') && (
          <Button icon={Send} onClick={() => setConfirm('send')} pending={busy === 'send'}>
            Send payslips
          </Button>
        )}

        {can(role, 'payrun.validate') && payrun.status === 'COMPUTED' && (
          <Button
            variant="primary"
            icon={ShieldCheck}
            disabled={!validate.ok}
            title={validate.ok ? undefined : validate.reason}
            onClick={() => setConfirm('validate')}
          >
            Validate payroll
          </Button>
        )}

        {can(role, 'payrun.pay') && payrun.status === 'VALIDATED' && (
          <Button variant="success" icon={BadgeIndianRupee} onClick={() => setConfirm('pay')}>
            Mark paid
          </Button>
        )}
      </div>

      {!validate.ok && payrun.status === 'COMPUTED' && can(role, 'payrun.validate') && (
        <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
          <TriangleAlert size={12} style={{ verticalAlign: -2 }} aria-hidden /> Validation is disabled:{' '}
          {validate.reason}
        </p>
      )}

      {/* dialogs */}
      <ResolveDialog
        exception={resolving}
        onClose={() => {
          if (resolving) markLeaving(resolving.id);
          setResolving(null);
        }}
      />

      <ConfirmDialog
        open={confirm === 'validate'}
        onClose={() => setConfirm(null)}
        onConfirm={() => run('validate', validateActivePayrun)}
        title={`Validate ${monthLabel(payrun.periodStart)} payroll`}
        confirmLabel="Validate payroll"
        variant="primary"
        pending={busy === 'validate'}
      >
        <ConsequencePreview
          rows={[
            { label: 'Payrun state', before: 'COMPUTED', after: 'VALIDATED' },
            { label: 'Payslips locked', before: `${totals.count} editable`, after: `${totals.count} locked` },
            { label: 'Net payroll', before: '—', after: formatMoney(totals.net) },
          ]}
          note="Validation confirms the computed amounts are correct. Recomputing afterwards requires an explicit, audited reopen."
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'pay'}
        onClose={() => setConfirm(null)}
        onConfirm={() => run('pay', markActivePayrunPaid)}
        title={`Mark ${monthLabel(payrun.periodStart)} payroll paid`}
        confirmLabel="Mark paid"
        variant="success"
        pending={busy === 'pay'}
      >
        <ConsequencePreview
          rows={[
            { label: 'Payrun state', before: 'VALIDATED', after: 'PAID' },
            { label: 'Amount released', before: '—', after: formatMoney(totals.net) },
            { label: 'Reports', before: 'Estimated net payroll', after: 'Total net salary paid' },
          ]}
          note="Paid payroll becomes immutable. Corrections require a reopen with a recorded reason."
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'send'}
        onClose={() => setConfirm(null)}
        onConfirm={() => run('send', () => sendPayslips(payrun.id))}
        title="Send payslips"
        confirmLabel={`Send ${totals.count} payslips`}
        variant="primary"
        pending={busy === 'send'}
      >
        <ConsequencePreview
          rows={[
            { label: 'Recipients', before: '—', after: `${totals.count} employees` },
            { label: 'Payroll amounts', before: formatMoney(totals.net), after: formatMoney(totals.net) },
          ]}
          note="Delivery runs independently of payroll. A failed email is recorded in the outbox and never changes a computed amount."
        />
      </ConfirmDialog>

      <Drawer
        open={reopen}
        onClose={() => setReopen(false)}
        title="Reopen paid payroll"
        footer={
          <>
            <Button onClick={() => setReopen(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const r = reopenPayrun(reopenReason);
                toast.result(r);
                if (r.ok) {
                  setReopen(false);
                  setReopenReason('');
                }
              }}
            >
              Reopen with reason
            </Button>
          </>
        }
      >
        <Banner tone="danger" icon={TriangleAlert} title="This changes paid payroll history">
          Reopening returns the payrun to COMPUTED so it can be corrected. The reason is recorded in
          the audit trail against your name and shown on the payrun afterwards.
        </Banner>
        <div className="mt4">
          <TextArea
            label="Reason for reopening"
            required
            rows={3}
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            placeholder="e.g. Attendance correction received for two employees after payment."
          />
        </div>
      </Drawer>
    </Page>
  );
}
