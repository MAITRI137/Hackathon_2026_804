import { useState } from 'react';
import { FileQuestion, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { formatDate, monthLabel } from '@shared/dates';
import { formatMoney } from '@shared/money';
import { Page } from '@/app/Page';
import { currentContract, empById } from '@/store/selectors';
import { useStore } from '@/store/store';
import { printDocument } from '@/lib/export';
import { Button, Card, Chip, EmptyState, InfoGrid } from '@/ui/primitives';
import { Drawer } from '@/ui/overlays';

export function PayslipDocumentPage() {
  const { id } = useParams();
  const state = useStore();
  const [explain, setExplain] = useState(false);
  const slip = state.payslips.find((p) => p.id === id && !p.isDuplicate && p.status !== 'CANCELLED');
  if (!slip) return <Page title="Payslip not found"><Card><EmptyState icon={FileQuestion} title="This payslip is unavailable" action={<Link to="/payslips"><Button>Back to payslips</Button></Link>} /></Card></Page>;
  const employee = empById(state, slip.employeeId)!;
  const contract = state.contracts.find((c) => c.id === slip.contractId) ?? currentContract(state, employee.id);
  const earnings = slip.lines.filter((l) => l.category === 'BASIC' || l.category === 'ALLOWANCES');
  const deductions = slip.lines.filter((l) => l.category === 'DEDUCTIONS');
  return (
    <Page title={`${monthLabel(slip.periodStart)} Payslip`} crumbs={['Payroll', 'Payslips', slip.payslipRef]} actions={<><Button icon={FileQuestion} onClick={() => setExplain(true)}>Why did salary change?</Button><Button variant="primary" icon={Printer} onClick={printDocument}>Download / print</Button></>}>
      <article className="payslip" aria-label={`${monthLabel(slip.periodStart)} payslip for ${employee.fullName}`}>
        <section className="payslip-sec"><div className="row between wrap"><div><div className="eyebrow">PeoplePay360</div><h3>{employee.fullName}</h3><p className="muted">{employee.employeeCode} · {slip.payslipRef}</p></div><Chip tone={slip.status === 'PAID' ? 'success' : 'info'}>{slip.status}</Chip></div></section>
        <section className="payslip-sec"><InfoGrid items={[{ label: 'Pay period', value: `${formatDate(slip.periodStart)} – ${formatDate(slip.periodEnd)}` }, { label: 'Contract', value: contract?.contractRef ?? '—' }, { label: 'Expected days', value: slip.input.expectedDays }, { label: 'Paid leave', value: slip.input.paidLeaveDays }, { label: 'Unpaid leave', value: slip.input.unpaidLeaveDays }, { label: 'Computed', value: formatDate(slip.computedAt.slice(0, 10)) }]} /></section>
        <section className="payslip-sec"><div className="payslip-sec-t">Earnings</div>{earnings.map((line) => <div className="ps-line" key={line.ruleId}><span className="ps-line-n">{line.ruleName}</span><span className="ps-line-a">{formatMoney(line.amount)}</span></div>)}<div className="ps-line ps-total"><span className="ps-line-n">Gross earnings</span><span className="ps-line-a">{formatMoney(slip.gross)}</span></div></section>
        <section className="payslip-sec"><div className="payslip-sec-t">Deductions</div>{deductions.length ? deductions.map((line) => <div className="ps-line" key={line.ruleId}><span className="ps-line-n">{line.ruleName}</span><span className="ps-line-a">{formatMoney(line.amount)}</span></div>) : <p className="muted">No deductions this period.</p>}<div className="ps-line ps-total"><span className="ps-line-n">Total deductions</span><span className="ps-line-a">{formatMoney(slip.totalDeductions)}</span></div></section>
        <div className="ps-net"><span className="l">Net pay</span><span className="v">{formatMoney(slip.net)}</span></div>
      </article>
      <Drawer open={explain} onClose={() => setExplain(false)} title="How this payslip was calculated">
        <div className="col gap4"><p className="secondary">Every amount below preserves the exact rule version, formula, inputs, and source records used when payroll was computed.</p>{slip.lines.filter((l) => l.category !== 'GROSS' && l.category !== 'NET').map((line) => <Card key={line.ruleId} title={`${line.ruleName} · ${formatMoney(line.amount)}`} subtitle={`${line.ruleCode} v${line.ruleVersion}`}><div className="col gap2"><code className="mono">{line.formulaSnapshot}</code><div className="row wrap">{line.sourceRefs.map((ref) => <Chip key={`${ref.type}-${ref.id}`} tone="neutral">{ref.type}: {ref.label}</Chip>)}</div></div></Card>)}</div>
      </Drawer>
    </Page>
  );
}
