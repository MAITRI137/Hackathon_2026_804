import { useMemo, useState } from 'react';
import { Download, TrendingUp } from 'lucide-react';
import { can } from '@shared/permissions';
import { formatMoney, formatMoneyShort } from '@shared/money';
import { EMPLOYEE_TYPES, EMPLOYEE_TYPE_LABEL } from '@shared/types';
import { monthLabel } from '@shared/dates';
import { Page } from '@/app/Page';
import { currentEmployee, currentRole, headcountByDepartment, netTrend, salaryCostByDepartment, attendanceHealth, leaveSummary, salaryDistribution, filteredPayslips, type ReportFilters } from '@/store/selectors';
import { useStore } from '@/store/store';
import { downloadCsv } from '@/lib/export';
import { Button, Card, EmptyState, Metric } from '@/ui/primitives';
import { Select } from '@/ui/form';
import { BarChart, GroupedBarChart, LineChart } from '@/ui/charts';

export function ReportsPage() {
  const state = useStore();
  const role = currentRole(state);
  const me = currentEmployee(state);
  const payrollView = can(role, 'report.payroll');
  const [filters, setFilters] = useState<ReportFilters>({ payrunId: state.activePayrunId, departmentId: 'ALL', employeeType: 'ALL' });
  const slips = useMemo(() => filteredPayslips(state, filters), [state, filters]);
  if (!payrollView) {
    const mine = state.payslips.filter((p) => p.employeeId === me?.id && !p.isDuplicate && p.status !== 'CANCELLED').sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    return <Page title="My Payroll Report" crumbs={['Insights', 'Reports']}><div className="grid grid-3"><Metric label="Payslips" value={mine.length} /><Metric label="Latest gross" value={formatMoney(mine.at(-1)?.gross ?? 0)} /><Metric label="Latest net" value={formatMoney(mine.at(-1)?.net ?? 0)} tone="brand" /></div><Card title="My net pay trend">{mine.length ? <LineChart data={mine.map((p) => ({ id: p.id, label: monthLabel(p.periodStart).replace(' 2026', ''), value: Number(p.net), display: formatMoney(p.net) }))} unit="net pay" /> : <EmptyState icon={TrendingUp} title="No payslips available yet" />}</Card></Page>;
  }
  const cost = salaryCostByDepartment(state, filters);
  const totalNet = slips.reduce((sum, p) => sum + Number(p.net), 0);
  const exportReport = () => downloadCsv('peoplepay360-payroll-report.csv', slips.map((p) => ({ reference: p.payslipRef, employeeId: p.employeeId, period: monthLabel(p.periodStart), gross: p.gross, deductions: p.totalDeductions, net: p.net, status: p.status })), [`PeoplePay360 payroll report`, `Period,${monthLabel(state.payruns.find((p) => p.id === filters.payrunId)?.periodStart ?? state.today)}`]);
  return (
    <Page title="Reports" crumbs={['Insights', 'Reports']} actions={<Button icon={Download} onClick={exportReport} disabled={!slips.length}>Export current report</Button>}>
      <Card padding="tight"><div className="filters"><Select value={filters.payrunId} onChange={(e) => setFilters({ ...filters, payrunId: e.target.value })} options={state.payruns.slice().reverse().map((p) => ({ value: p.id, label: monthLabel(p.periodStart) }))} /><Select value={filters.departmentId} onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })} options={[{ value: 'ALL', label: 'All departments' }, ...state.departments.map((d) => ({ value: d.id, label: d.name }))]} /><Select value={filters.employeeType} onChange={(e) => setFilters({ ...filters, employeeType: e.target.value })} options={[{ value: 'ALL', label: 'All employee types' }, ...EMPLOYEE_TYPES.map((t) => ({ value: t, label: EMPLOYEE_TYPE_LABEL[t] }))]} /></div></Card>
      <div className="grid grid-4"><Metric label="Payslips" value={slips.length} /><Metric label="Net payroll" value={formatMoneyShort(totalNet)} tone="brand" /><Metric label="Departments" value={cost.filter((d) => d.count > 0).length} /><Metric label="Average net" value={formatMoney(slips.length ? totalNet / slips.length : 0)} /></div>
      <div className="grid grid-2"><Card title="Payroll cost vs budget"><GroupedBarChart data={cost.map((d) => ({ id: d.id, label: d.label, a: d.budget, b: d.value, aDisplay: formatMoneyShort(d.budget), bDisplay: formatMoneyShort(d.value) }))} seriesA="Budget" seriesB="Actual net" unit="payroll" /></Card><Card title="Net payroll trend"><LineChart data={netTrend(state).map((d) => ({ ...d, value: Number(d.value), display: formatMoneyShort(d.value) }))} unit="net payroll" /></Card><Card title="Headcount by department"><BarChart data={headcountByDepartment(state, filters)} unit="employees" /></Card><Card title="Attendance health"><BarChart data={attendanceHealth(state, filters).map((d) => ({ ...d, color: d.id === 'missing' || d.id === 'absent' ? 'var(--mark-4)' : d.id === 'late' ? 'var(--mark-3)' : 'var(--mark-1)' }))} unit="records" /></Card><Card title="Leave days"><BarChart data={leaveSummary(state, filters)} unit="approved days" /></Card><Card title="Salary distribution"><BarChart data={salaryDistribution(state, filters)} unit="employees" /></Card></div>
    </Page>
  );
}
