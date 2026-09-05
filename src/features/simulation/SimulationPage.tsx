import { useMemo, useState } from 'react';
import { Activity, ArrowRight, FlaskConical } from 'lucide-react';
import { computePayslip } from '@shared/engine';
import { formatMoney, subtractMoney } from '@shared/money';
import { Page } from '@/app/Page';
import { activePayrun, currentContract, empById } from '@/store/selectors';
import { buildContext } from '@/store/payroll';
import { useStore } from '@/store/store';
import { Banner, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { MoneyInput, Select, TextInput } from '@/ui/form';

export function SimulationPage() {
  const state = useStore();
  const payrun = activePayrun(state);
  const eligible = state.employees.filter((e) => currentContract(state, e.id));
  const [employeeId, setEmployeeId] = useState(eligible[0]?.id ?? '');
  const employee = empById(state, employeeId);
  const contract = currentContract(state, employeeId);
  const [wage, setWage] = useState(contract?.wage ?? '0');
  const [unpaid, setUnpaid] = useState('0');
  const results = useMemo(() => {
    if (!employee || !contract) return null;
    try {
      const base = buildContext(state, employee.id, payrun);
      const current = computePayslip(base);
      const scenario = computePayslip({ ...base, contract: { ...base.contract, wage }, leave: { ...base.leave, unpaidDays: Math.max(0, Number(unpaid) || 0) } });
      return { current, scenario };
    } catch { return null; }
  }, [state, employee, contract, payrun, wage, unpaid]);
  const chooseEmployee = (id: string) => { setEmployeeId(id); setWage(currentContract(state, id)?.wage ?? '0'); setUnpaid('0'); };
  return (
    <Page title="Payroll Simulation" crumbs={['Payroll', 'Simulation']} actions={<Chip tone="info" icon={FlaskConical}>No records are changed</Chip>}>
      <Banner tone="info" icon={Activity} title="Safe what-if workspace"><p>Uses the same payroll engine and rule versions as the live payrun. Results remain local until you deliberately update a contract or leave record elsewhere.</p></Banner>
      <div className="grid split-side">
        <Card title="Scenario inputs"><div className="col gap4"><Select label="Employee" value={employeeId} onChange={(e) => chooseEmployee(e.target.value)} options={eligible.map((e) => ({ value: e.id, label: `${e.fullName} · ${e.employeeCode}` }))} /><MoneyInput label="Simulated monthly wage" value={wage} onChange={(e) => setWage(e.target.value)} /><TextInput label="Unpaid leave days" type="number" min="0" step="0.5" value={unpaid} onChange={(e) => setUnpaid(e.target.value)} /><div className="preview"><strong>Scenario boundary</strong><p className="muted">{payrun.name} · {employee?.fullName}<br />Attendance and paid leave stay unchanged.</p></div></div></Card>
        {results ? <Card title="Impact"><div className="grid grid-2"><Metric label="Current net" value={formatMoney(results.current.net)} /><Metric label="Simulated net" value={formatMoney(results.scenario.net)} tone={Number(results.scenario.net) >= Number(results.current.net) ? 'success' : 'warning'} /><Metric label="Net difference" value={formatMoney(subtractMoney(results.scenario.net, results.current.net))} tone={Number(results.scenario.net) >= Number(results.current.net) ? 'success' : 'danger'} /><Metric label="Simulated gross" value={formatMoney(results.scenario.gross)} /></div></Card> : <Card><EmptyState icon={FlaskConical} title="Choose an employee with a valid contract" /></Card>}
      </div>
      {results && <Card title="Calculation comparison"><div className="col">{results.scenario.lines.filter((l) => !['GROSS', 'NET'].includes(l.category)).map((line) => { const before = results.current.lines.find((x) => x.ruleId === line.ruleId); return <div className="ps-line" key={line.ruleId}><span className="ps-line-n"><strong>{line.ruleName}</strong><span className="muted mono" style={{ display: 'block' }}>{line.formulaSnapshot}</span></span><span className="ps-line-a">{formatMoney(before?.amount ?? 0)} <ArrowRight size={13} aria-hidden /> {formatMoney(line.amount)}</span></div>; })}</div></Card>}
    </Page>
  );
}
