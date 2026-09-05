/**
 * The payslip document.
 *
 * Two audiences share one markup: on screen it is an interactive record where
 * every line can be opened for its provenance; on paper it is a plain payslip
 * with a document header, a footer, and no controls. The print stylesheet does
 * the switching, so the printed figures are the same DOM the operator read.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileQuestion, HelpCircle, Printer, TrendingDown, TrendingUp } from 'lucide-react';
import { formatDate, formatDateTime, monthLabel } from '@shared/dates';
import { formatDelta, formatMoney, money, subtractMoney } from '@shared/money';
import type { Payslip, PayslipLine } from '@shared/types';
import { Page } from '@/app/Page';
import { currentContract, deptName, empById, positionName, scheduleName } from '@/store/selectors';
import { useStore } from '@/store/store';
import { printDocument } from '@/lib/export';
import { Button, Card, Chip, EmptyState, InfoGrid } from '@/ui/primitives';
import { Drawer } from '@/ui/overlays';

export function PayslipDocumentPage() {
  const { id } = useParams();
  const state = useStore();
  const [explainLine, setExplainLine] = useState<PayslipLine | null>(null);
  const [compare, setCompare] = useState(false);

  const slip = state.payslips.find(
    (p) => p.id === id && !p.isDuplicate && p.status !== 'CANCELLED',
  );

  const previous = useMemo(() => {
    if (!slip) return undefined;
    return state.payslips
      .filter(
        (p) =>
          p.employeeId === slip.employeeId &&
          !p.isDuplicate &&
          p.status !== 'CANCELLED' &&
          p.periodStart < slip.periodStart,
      )
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  }, [state.payslips, slip]);

  if (!slip) {
    return (
      <Page title="Payslip not found" crumbs={['Payroll', 'Payslips']}>
        <Card>
          <EmptyState
            icon={FileQuestion}
            title="This payslip is unavailable"
            description="It may have been removed as a duplicate, or belong to someone you cannot view."
            action={
              <Link to="/payslips">
                <Button variant="primary">Back to payslips</Button>
              </Link>
            }
          />
        </Card>
      </Page>
    );
  }

  const employee = empById(state, slip.employeeId)!;
  const contract =
    state.contracts.find((c) => c.id === slip.contractId) ?? currentContract(state, employee.id);
  const earnings = slip.lines.filter((l) => l.category === 'BASIC' || l.category === 'ALLOWANCES');
  const deductions = slip.lines.filter((l) => l.category === 'DEDUCTIONS');
  const netDelta = previous ? subtractMoney(slip.net, previous.net) : null;

  return (
    <Page
      title={`${monthLabel(slip.periodStart)} payslip`}
      crumbs={['Payroll', 'Payslips', slip.payslipRef]}
      actions={
        <>
          {/* Always operable. A control that is simply dead reads as broken; if
              there is nothing to compare, the panel says so and explains why. */}
          <Button
            icon={FileQuestion}
            onClick={() => setCompare(true)}
            title={
              previous
                ? `Compare with ${monthLabel(previous.periodStart)}`
                : 'No earlier payslip for this employee yet'
            }
          >
            Why did salary change?
          </Button>
          <Button variant="primary" icon={Printer} onClick={printDocument}>
            Download / print
          </Button>
        </>
      }
    >
      <article
        className="payslip"
        aria-label={`${monthLabel(slip.periodStart)} payslip for ${employee.fullName}`}
      >
        {/* Paper only: the screen already carries this in the page header. */}
        <header className="doc-head print-only">
          <div>
            <div className="doc-mark">PeoplePay360</div>
            <div className="doc-sub">Payslip · {monthLabel(slip.periodStart)}</div>
          </div>
          <div className="doc-meta">
            {slip.payslipRef}
            <br />
            Generated {formatDate(state.today)}
          </div>
        </header>

        <section className="payslip-sec">
          <div className="row between wrap">
            <div>
              <div className="eyebrow">Employee</div>
              <h3 style={{ fontSize: 'var(--fs-lg)' }}>{employee.fullName}</h3>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                {employee.employeeCode} · {positionName(state, employee.jobPositionId)} ·{' '}
                {deptName(state, employee.departmentId)}
              </p>
            </div>
            <Chip tone={slip.status === 'PAID' ? 'success' : 'info'} dot>
              {slip.status}
            </Chip>
          </div>
        </section>

        <section className="payslip-sec">
          <InfoGrid
            items={[
              {
                label: 'Pay period',
                value: `${formatDate(slip.periodStart)} – ${formatDate(slip.periodEnd)}`,
              },
              { label: 'Contract', value: contract?.contractRef ?? '—', mono: true },
              { label: 'Working schedule', value: scheduleName(state, employee.workingScheduleId) },
              { label: 'Expected days', value: slip.input.expectedDays },
              { label: 'Paid leave', value: slip.input.paidLeaveDays },
              { label: 'Unpaid leave', value: slip.input.unpaidLeaveDays },
            ]}
          />
        </section>

        <section className="payslip-sec">
          <div className="payslip-sec-t">Earnings</div>
          {earnings.map((line) => (
            <LineRow key={line.ruleId} line={line} onExplain={setExplainLine} />
          ))}
          <div className="ps-line ps-total">
            <span className="ps-line-n">Gross earnings</span>
            <span className="ps-line-a">{formatMoney(slip.gross)}</span>
            <span className="ps-why-space no-print" aria-hidden />
          </div>
        </section>

        <section className="payslip-sec">
          <div className="payslip-sec-t">Deductions</div>
          {deductions.length ? (
            deductions.map((line) => (
              <LineRow key={line.ruleId} line={line} onExplain={setExplainLine} />
            ))
          ) : (
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              No deductions this period.
            </p>
          )}
          <div className="ps-line ps-total">
            <span className="ps-line-n">Total deductions</span>
            <span className="ps-line-a">{formatMoney(slip.totalDeductions)}</span>
            <span className="ps-why-space no-print" aria-hidden />
          </div>
        </section>

        <div className="ps-net">
          <span className="l">Net pay</span>
          <span className="v">{formatMoney(slip.net)}</span>
        </div>

        {netDelta && previous && (
          <section className="payslip-sec">
            <div className="row between wrap">
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                Compared with {monthLabel(previous.periodStart)}
              </span>
              <span className="row gap2">
                {netDelta.isZero() ? (
                  <Chip tone="neutral">Unchanged</Chip>
                ) : (
                  <Chip
                    tone={netDelta.isNegative() ? 'danger' : 'success'}
                    icon={netDelta.isNegative() ? TrendingDown : TrendingUp}
                  >
                    {formatDelta(netDelta)}
                  </Chip>
                )}
                <Button size="sm" className="no-print" onClick={() => setCompare(true)}>
                  Explain the change
                </Button>
              </span>
            </div>
          </section>
        )}

        <footer className="doc-foot print-only">
          Computed {formatDateTime(slip.computedAt)} from contract {contract?.contractRef} under
          structure {slip.structureId}. Input snapshot {slip.snapshotHash}. Every amount above is
          reproducible from the rule versions recorded against this payslip.
          <br />
          This is a computer-generated document and is valid without a signature.
        </footer>
      </article>

      <Drawer
        open={explainLine !== null}
        onClose={() => setExplainLine(null)}
        title={
          explainLine ? `Why ${explainLine.ruleName} is ${formatMoney(explainLine.amount)}` : ''
        }
      >
        {explainLine && <LineProvenance line={explainLine} />}
      </Drawer>

      <Drawer open={compare} onClose={() => setCompare(false)} title="Why did this salary change?">
        <SalaryChange slip={slip} previous={previous} />
      </Drawer>
    </Page>
  );
}

/** One payslip line: amount on screen and on paper, `Why?` on screen only. */
function LineRow({
  line,
  onExplain,
}: {
  line: PayslipLine;
  onExplain: (line: PayslipLine) => void;
}) {
  return (
    <div className="ps-line">
      <span className="ps-line-n">{line.ruleName}</span>
      <span className="ps-line-a">{formatMoney(line.amount)}</span>
      <button
        type="button"
        className="ps-why no-print"
        onClick={() => onExplain(line)}
        aria-label={`Why is ${line.ruleName} ${formatMoney(line.amount)}?`}
        title="Why?"
      >
        <HelpCircle size={15} aria-hidden />
      </button>
    </div>
  );
}

/** result → rule → formula → inputs → source, in that order. */
function LineProvenance({ line }: { line: PayslipLine }) {
  return (
    <div className="col gap5">
      <div className="provenance-chain">
        <div className="chain-step">
          <span className="eyebrow">Result</span>
          <strong className="mono" style={{ fontSize: 'var(--fs-xl)' }}>
            {formatMoney(line.amount)}
          </strong>
        </div>
        <div className="chain-step">
          <span className="eyebrow">Rule</span>
          <strong>
            {line.ruleName} · {line.ruleCode} v{line.ruleVersion}
          </strong>
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            Sequence {line.sequence} · {line.category.toLowerCase()}
          </span>
        </div>
        <div className="chain-step">
          <span className="eyebrow">Formula</span>
          <code className="formula">{line.formulaSnapshot}</code>
        </div>
        <div className="chain-step">
          <span className="eyebrow">Inputs</span>
          {Object.keys(line.inputs).length === 0 ? (
            <span className="muted">A fixed amount — this rule reads nothing.</span>
          ) : (
            <div className="col gap1">
              {Object.entries(line.inputs).map(([key, value]) => (
                <div className="row between" key={key}>
                  <span className="mono muted">{key}</span>
                  <strong className="mono">{value}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="chain-step">
          <span className="eyebrow">Source records</span>
          <div className="row wrap gap2">
            {line.sourceRefs.map((ref) => (
              <Chip key={`${ref.type}-${ref.id}`} tone="neutral">
                {ref.type.toLowerCase()}: {ref.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
        The rule version is pinned to this payslip, so editing the rule later cannot change what
        this period paid.
      </p>
    </div>
  );
}

/**
 * The change is decomposed line by line, and the causes must sum exactly to the
 * difference in net — a reconciliation, not a narrative.
 */
function SalaryChange({ slip, previous }: { slip: Payslip; previous?: Payslip }) {
  if (!previous) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="No earlier payslip to compare"
        description="A comparison needs at least two computed periods for this employee."
      />
    );
  }

  const codes = [...new Set([...slip.lines, ...previous.lines].map((l) => l.ruleCode))];
  const rows = codes
    .filter((code) => code !== 'GROSS' && code !== 'NET')
    .map((code) => {
      const now = slip.lines.find((l) => l.ruleCode === code);
      const before = previous.lines.find((l) => l.ruleCode === code);
      const sign = (now ?? before)?.category === 'DEDUCTIONS' ? -1 : 1;
      const delta = subtractMoney(now?.amount ?? '0', before?.amount ?? '0').times(sign);
      return {
        code,
        name: now?.ruleName ?? before?.ruleName ?? code,
        before: before?.amount ?? '0.00',
        after: now?.amount ?? '0.00',
        delta,
      };
    })
    .filter((r) => !r.delta.isZero());

  const netDelta = subtractMoney(slip.net, previous.net);
  const explained = rows.reduce((sum, r) => sum.plus(r.delta), money(0));
  const reconciles = explained.equals(netDelta);

  return (
    <div className="col gap5">
      <div className="compare-heads">
        <div className="compare-head">
          <span className="eyebrow">{monthLabel(previous.periodStart)}</span>
          <strong className="mono">{formatMoney(previous.net)}</strong>
        </div>
        <div className={`compare-arrow ${netDelta.isNegative() ? 'neg' : 'pos'}`} aria-hidden>
          {netDelta.isNegative() ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
        </div>
        <div className="compare-head">
          <span className="eyebrow">{monthLabel(slip.periodStart)}</span>
          <strong className="mono">{formatMoney(slip.net)}</strong>
        </div>
      </div>

      <div>
        <h4 className="eyebrow mb2">What changed</h4>
        {rows.length === 0 ? (
          <p className="muted">
            Nothing changed: both periods used the same inputs and the same rule versions.
          </p>
        ) : (
          <div className="col gap2">
            {rows.map((r) => (
              <div
                className="change-row"
                key={r.code}
                data-sign={r.delta.isNegative() ? 'neg' : 'pos'}
              >
                <span className="grow">
                  <strong>{r.name}</strong>
                  <span
                    className="muted mono"
                    style={{ display: 'block', fontSize: 'var(--fs-xs)' }}
                  >
                    {formatMoney(r.before)} → {formatMoney(r.after)}
                  </span>
                </span>
                <span className="mono change-amount">{formatDelta(r.delta)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="reconcile" data-ok={reconciles}>
        <div className="row between">
          <span>Sum of the causes above</span>
          <strong className="mono">{formatDelta(explained)}</strong>
        </div>
        <div className="row between">
          <span>Actual change in net pay</span>
          <strong className="mono">{formatDelta(netDelta)}</strong>
        </div>
        <p style={{ fontSize: 'var(--fs-xs)' }}>
          {reconciles
            ? 'The causes reconcile exactly to the change in net pay — nothing is unexplained.'
            : 'These do not reconcile, which means an input changed that is not represented as a rule line. Recompute the payrun before relying on this comparison.'}
        </p>
      </div>
    </div>
  );
}
