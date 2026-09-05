/**
 * Reports.
 *
 * A report is a document, not a wall of charts: the operator chooses a period,
 * a comparison, a scope and which sections to include, and the same selection
 * drives what is shown on screen, what is exported as CSV, and what is printed.
 *
 * Every figure derives from payslips and employees already in state, so a
 * report can never disagree with the payroll screen it was generated from.
 */
import { useMemo, useState } from 'react';
import {
  BadgeIndianRupee,
  CalendarDays,
  ChartNoAxesColumn,
  Download,
  Printer,
  Receipt,
  TrendingUp,
  Users,
} from 'lucide-react';
import { can } from '@shared/permissions';
import {
  addMoney,
  formatMoney,
  formatMoneyShort,
  money,
  subtractMoney,
  toMoneyString,
} from '@shared/money';
import { EMPLOYEE_TYPES, EMPLOYEE_TYPE_LABEL } from '@shared/types';
import { formatDate, monthLabel } from '@shared/dates';
import { Page } from '@/app/Page';
import { useStore } from '@/store/store';
import {
  attendanceHealth,
  currentEmployee,
  currentRole,
  deptName,
  filteredEmployees,
  filteredPayslips,
  headcountByDepartment,
  leaveSummary,
  netTrend,
  salaryCostByDepartment,
  salaryDistribution,
  type ReportFilters,
} from '@/store/selectors';
import { downloadCsv, printDocument } from '@/lib/export';
import { Banner, Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { Checkbox, Select } from '@/ui/form';
import { BarChart, DonutChart, GroupedBarChart, LineChart } from '@/ui/charts';

/** Sections an operator can include or leave out of the generated report. */
const SECTIONS = [
  { key: 'summary', label: 'Summary figures' },
  { key: 'composition', label: 'Pay composition' },
  { key: 'trend', label: 'Net payroll trend' },
  { key: 'departments', label: 'Department breakdown' },
  { key: 'workforce', label: 'Workforce mix' },
  { key: 'time', label: 'Attendance and leave' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

export function ReportsPage() {
  const role = useStore(currentRole);
  // Two different reports, not one report with things hidden: an employee's
  // own pay history and the organisation's payroll are separate documents.
  return can(role, 'report.payroll') ? <PayrollReport /> : <SelfReport />;
}

function PayrollReport() {
  const state = useStore();
  const [filters, setFilters] = useState<ReportFilters>({
    payrunId: state.activePayrunId,
    departmentId: 'ALL',
    employeeType: 'ALL',
  });
  const [sections, setSections] = useState<Set<SectionKey>>(
    () => new Set(SECTIONS.map((s) => s.key)),
  );

  const payrun = state.payruns.find((p) => p.id === filters.payrunId);
  const previousPayrun = useMemo(
    () =>
      state.payruns
        .filter((p) => payrun && p.periodStart < payrun.periodStart)
        .sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0],
    [state.payruns, payrun],
  );

  const slips = useMemo(() => filteredPayslips(state, filters), [state, filters]);
  const priorSlips = useMemo(
    () =>
      previousPayrun ? filteredPayslips(state, { ...filters, payrunId: previousPayrun.id }) : [],
    [state, filters, previousPayrun],
  );

  const employees = useMemo(() => filteredEmployees(state, filters), [state, filters]);
  const cost = useMemo(() => salaryCostByDepartment(state, filters), [state, filters]);

  const totals = useMemo(() => {
    const sum = (rows: typeof slips, field: 'gross' | 'net' | 'totalDeductions') =>
      rows.reduce((acc, p) => addMoney(acc, p[field]), money(0));
    const net = sum(slips, 'net');
    const priorNet = sum(priorSlips, 'net');
    return {
      net,
      gross: sum(slips, 'gross'),
      deductions: sum(slips, 'totalDeductions'),
      priorNet,
      netDeltaPct: priorNet.isZero()
        ? 0
        : subtractMoney(net, priorNet).div(priorNet).times(100).toNumber(),
      headcountDeltaPct:
        priorSlips.length === 0
          ? 0
          : ((slips.length - priorSlips.length) / priorSlips.length) * 100,
      average: slips.length ? net.div(slips.length) : money(0),
    };
  }, [slips, priorSlips]);

  /** What each rule contributed across the whole selection. */
  const composition = useMemo(() => {
    const byRule = new Map<
      string,
      { name: string; total: ReturnType<typeof money>; category: string }
    >();
    for (const slip of slips) {
      for (const line of slip.lines) {
        if (line.category === 'GROSS' || line.category === 'NET') continue;
        const entry = byRule.get(line.ruleCode) ?? {
          name: line.ruleName,
          total: money(0),
          category: line.category,
        };
        entry.total = addMoney(entry.total, line.amount);
        byRule.set(line.ruleCode, entry);
      }
    }
    const palette = ['var(--mark-1)', 'var(--mark-2)', 'var(--mark-3)', 'var(--mark-4)'];
    return [...byRule.entries()]
      .filter(([, v]) => !v.total.isZero())
      .sort((a, b) => b[1].total.comparedTo(a[1].total))
      .map(([code, v], i) => ({
        id: code,
        label: v.name,
        value: v.total.toNumber(),
        display: formatMoneyShort(v.total),
        color: palette[i % palette.length],
      }));
  }, [slips]);

  const scopeLabel = [
    payrun ? monthLabel(payrun.periodStart) : 'No period',
    filters.departmentId === 'ALL' ? 'All departments' : deptName(state, filters.departmentId),
    filters.employeeType === 'ALL'
      ? 'All employee types'
      : EMPLOYEE_TYPE_LABEL[filters.employeeType as keyof typeof EMPLOYEE_TYPE_LABEL],
  ].join(' · ');

  const show = (key: SectionKey) => sections.has(key);
  const toggle = (key: SectionKey, on: boolean) =>
    setSections((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const exportCsv = () => {
    downloadCsv(
      `payroll-report-${payrun?.periodStart.slice(0, 7) ?? 'period'}.csv`,
      cost.map((d) => ({
        department: d.label,
        employees: d.count,
        budget: toMoneyString(d.budget),
        actual_net: toMoneyString(d.value),
        variance: toMoneyString(d.budget - d.value),
        utilisation_percent: d.budget ? ((d.value / d.budget) * 100).toFixed(1) : '',
      })),
      [
        '# PeoplePay360 payroll report',
        `# scope=${scopeLabel}`,
        `# payslips=${slips.length} net=${toMoneyString(totals.net)}`,
        `# generated=${formatDate(state.today)}`,
      ],
    );
  };

  return (
    <Page
      title="Reports"
      crumbs={['Insights', 'Reports']}
      actions={
        <>
          <Button icon={Download} onClick={exportCsv} disabled={slips.length === 0}>
            Export CSV
          </Button>
          <Button
            variant="primary"
            icon={Printer}
            onClick={printDocument}
            disabled={slips.length === 0}
          >
            Print / save PDF
          </Button>
        </>
      }
    >
      {/* Printed report furniture — invisible on screen. */}
      <header className="doc-head print-only">
        <div>
          <div className="doc-mark">PeoplePay360</div>
          <div className="doc-sub">Payroll report · {scopeLabel}</div>
        </div>
        <div className="doc-meta">
          Generated {formatDate(state.today)}
          <br />
          {slips.length} payslips
        </div>
      </header>

      <Card padding="tight" className="no-print">
        <div className="report-builder">
          <div className="filters">
            <Select
              label="Period"
              value={filters.payrunId}
              onChange={(e) => setFilters({ ...filters, payrunId: e.target.value })}
              options={state.payruns
                .slice()
                .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
                .map((p) => ({ value: p.id, label: `${monthLabel(p.periodStart)} · ${p.status}` }))}
            />
            <Select
              label="Department"
              value={filters.departmentId}
              onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}
              options={[
                { value: 'ALL', label: 'All departments' },
                ...state.departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
            <Select
              label="Employee type"
              value={filters.employeeType}
              onChange={(e) => setFilters({ ...filters, employeeType: e.target.value })}
              options={[
                { value: 'ALL', label: 'All employee types' },
                ...EMPLOYEE_TYPES.map((t) => ({ value: t, label: EMPLOYEE_TYPE_LABEL[t] })),
              ]}
            />
          </div>
          <div className="report-sections">
            <span className="eyebrow">Include in this report</span>
            <div className="row wrap gap3">
              {SECTIONS.map((s) => (
                <Checkbox
                  key={s.key}
                  checked={show(s.key)}
                  onChange={(on) => toggle(s.key, on)}
                  label={s.label}
                />
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="row wrap gap2 no-print">
        <Chip tone="info" icon={CalendarDays}>
          {payrun ? monthLabel(payrun.periodStart) : '—'}
        </Chip>
        <Chip tone="neutral">
          {filters.departmentId === 'ALL'
            ? 'All departments'
            : deptName(state, filters.departmentId)}
        </Chip>
        <Chip tone="neutral">
          {filters.employeeType === 'ALL'
            ? 'All employee types'
            : EMPLOYEE_TYPE_LABEL[filters.employeeType as keyof typeof EMPLOYEE_TYPE_LABEL]}
        </Chip>
        {previousPayrun && (
          <Chip tone="neutral">Compared with {monthLabel(previousPayrun.periodStart)}</Chip>
        )}
      </div>

      {slips.length === 0 ? (
        <Card>
          <EmptyState
            icon={ChartNoAxesColumn}
            title="No payroll matches this selection"
            description="Choose a period that has been computed, or widen the department and employee-type filters."
            action={
              <Button
                onClick={() => setFilters({ ...filters, departmentId: 'ALL', employeeType: 'ALL' })}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {show('summary') && (
            <div className="grid grid-4">
              <Metric
                icon={BadgeIndianRupee}
                label={
                  payrun?.status === 'PAID' ? 'Total net salary paid' : 'Estimated net payroll'
                }
                value={formatMoneyShort(totals.net)}
                tone="brand"
                sub={formatMoney(totals.net)}
                delta={
                  previousPayrun
                    ? {
                        percent: totals.netDeltaPct,
                        caption: `vs ${monthLabel(previousPayrun.periodStart).split(' ')[0]}`,
                        good: 'none',
                      }
                    : undefined
                }
              />
              <Metric
                icon={Receipt}
                label="Payslips"
                value={slips.length}
                sub={`${formatMoney(totals.gross)} gross`}
                delta={
                  previousPayrun
                    ? {
                        percent: totals.headcountDeltaPct,
                        caption: `vs ${monthLabel(previousPayrun.periodStart).split(' ')[0]}`,
                        good: 'none',
                      }
                    : undefined
                }
              />
              <Metric
                icon={TrendingUp}
                label="Deductions"
                value={formatMoneyShort(totals.deductions)}
                tone="warning"
                sub="Unpaid leave and configured deductions"
              />
              <Metric
                icon={Users}
                label="Average net"
                value={formatMoney(totals.average)}
                sub={`across ${employees.length} employees in scope`}
              />
            </div>
          )}

          <div className="grid grid-2">
            {show('composition') && (
              <Card
                title="Pay composition"
                subtitle="What the gross bill is actually made of, by salary rule"
              >
                <DonutChart
                  data={composition}
                  total={formatMoneyShort(totals.gross)}
                  totalLabel="Gross"
                  unit="payroll"
                />
              </Card>
            )}

            {show('trend') && (
              <Card title="Net payroll trend" subtitle="Every computed period, oldest first">
                <LineChart
                  data={netTrend(state).map((d) => ({
                    ...d,
                    value: Number(d.value),
                    display: formatMoneyShort(d.value),
                  }))}
                  unit="net payroll"
                />
              </Card>
            )}

            {show('departments') && (
              <Card title="Payroll cost against budget">
                <GroupedBarChart
                  data={cost.map((d) => ({
                    id: d.id,
                    label: d.label,
                    a: d.budget,
                    b: d.value,
                    aDisplay: formatMoneyShort(d.budget),
                    bDisplay: formatMoneyShort(d.value),
                  }))}
                  seriesA="Budget"
                  seriesB="Actual net"
                  unit="payroll"
                />
              </Card>
            )}

            {show('workforce') && (
              <Card title="Headcount by department">
                <BarChart data={headcountByDepartment(state, filters)} unit="employees" />
              </Card>
            )}

            {show('workforce') && (
              <Card title="Salary distribution">
                <BarChart data={salaryDistribution(state, filters)} unit="employees" />
              </Card>
            )}

            {show('time') && (
              <Card title="Attendance health" subtitle="Records in the selected period">
                <BarChart
                  data={attendanceHealth(state, filters).map((d) => ({
                    ...d,
                    color:
                      d.id === 'missing' || d.id === 'absent'
                        ? 'var(--mark-4)'
                        : d.id === 'late'
                          ? 'var(--mark-3)'
                          : 'var(--mark-1)',
                  }))}
                  unit="records"
                />
              </Card>
            )}

            {show('time') && (
              <Card title="Approved leave">
                <BarChart data={leaveSummary(state, filters)} unit="approved days" />
              </Card>
            )}
          </div>

          {show('departments') && (
            <Card
              title="Department breakdown"
              subtitle="Budget is configured; actual derives from payslips"
              padding="flush"
            >
              <div className="tbl-wrap">
                <table className="tbl">
                  <caption className="sr-only">Payroll by department for {scopeLabel}</caption>
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th className="cell-num">Employees</th>
                      <th className="cell-num">Budget</th>
                      <th className="cell-num">Actual net</th>
                      <th className="cell-num">Variance</th>
                      <th>Utilisation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cost.map((d) => {
                      const variance = d.budget - d.value;
                      const used = d.budget ? (d.value / d.budget) * 100 : 0;
                      return (
                        <tr key={d.id}>
                          <td>{d.label}</td>
                          <td className="cell-num">{d.count}</td>
                          <td className="cell-num">{formatMoneyShort(d.budget)}</td>
                          <td className="cell-num">{formatMoneyShort(d.value)}</td>
                          <td
                            className="cell-num"
                            style={{ color: variance < 0 ? 'var(--danger)' : 'var(--success)' }}
                          >
                            {variance < 0 ? '−' : '+'}
                            {formatMoneyShort(Math.abs(variance))}
                          </td>
                          <td>
                            <span className="row gap2">
                              <span className="bar-track" style={{ width: 90 }}>
                                <span
                                  className="bar-fill"
                                  style={{
                                    width: `${Math.min(100, used)}%`,
                                    background:
                                      used > 100
                                        ? 'var(--mark-4)'
                                        : used > 90
                                          ? 'var(--mark-3)'
                                          : 'var(--mark-2)',
                                  }}
                                />
                              </span>
                              <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                                {used.toFixed(0)}%
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <footer className="doc-foot print-only">
            Scope: {scopeLabel}. {slips.length} payslips, net {formatMoney(totals.net)}. Figures are
            computed from the same payroll records shown in the application and are reproducible
            from the rule versions recorded on each payslip.
          </footer>
        </>
      )}
    </Page>
  );
}

/** Employees get their own pay history, and nothing about anyone else. */
function SelfReport() {
  const state = useStore();
  const me = currentEmployee(state);
  const mine = state.payslips
    .filter((p) => p.employeeId === me?.id && !p.isDuplicate && p.status !== 'CANCELLED')
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  const latest = mine.at(-1);
  const previous = mine.at(-2);
  const deltaPct =
    latest && previous && !money(previous.net).isZero()
      ? subtractMoney(latest.net, previous.net).div(money(previous.net)).times(100).toNumber()
      : 0;

  return (
    <Page title="My pay report" crumbs={['Insights', 'Reports']}>
      <Banner tone="info" icon={ChartNoAxesColumn} title="This report covers only your own pay">
        Organisation-wide payroll figures are not available to employee accounts.
      </Banner>

      <div className="grid grid-3">
        <Metric icon={Receipt} label="Payslips" value={mine.length} />
        <Metric
          icon={BadgeIndianRupee}
          label="Latest net pay"
          value={formatMoney(latest?.net ?? 0)}
          tone="brand"
          delta={
            previous
              ? { percent: deltaPct, caption: 'vs previous period', good: 'none' }
              : undefined
          }
        />
        <Metric label="Latest gross" value={formatMoney(latest?.gross ?? 0)} />
      </div>

      <Card title="My net pay trend">
        {mine.length ? (
          <LineChart
            data={mine.map((p) => ({
              id: p.id,
              label: monthLabel(p.periodStart).split(' ')[0],
              value: Number(p.net),
              display: formatMoney(p.net),
            }))}
            unit="net pay"
          />
        ) : (
          <EmptyState icon={TrendingUp} title="No payslips available yet" />
        )}
      </Card>
    </Page>
  );
}
