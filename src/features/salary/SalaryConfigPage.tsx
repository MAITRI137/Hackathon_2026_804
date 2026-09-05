import { useMemo, useState } from 'react';
import { Calculator, Pencil, ShieldCheck } from 'lucide-react';
import { can } from '@shared/permissions';
import type { SalaryRule } from '@shared/types';
import { Page } from '@/app/Page';
import { updateSalaryRule } from '@/store/actions';
import { currentRole } from '@/store/selectors';
import { useStore } from '@/store/store';
import { Banner, Button, Card, Chip, EmptyState, InfoGrid } from '@/ui/primitives';
import { MoneyInput, Switch, TextInput } from '@/ui/form';
import { Drawer } from '@/ui/overlays';
import { DataTable, type Column } from '@/ui/table';
import { useToast } from '@/ui/toast';

export function SalaryConfigPage() {
  const state = useStore();
  const toast = useToast();
  const role = currentRole(state);
  const writable = can(role, 'salary.rule.write');
  const [structureId, setStructureId] = useState(state.salaryStructures[0]?.id ?? '');
  const [editing, setEditing] = useState<SalaryRule | null>(null);
  const [value, setValue] = useState('');
  const rules = useMemo(() => state.salaryRules.filter((r) => r.structureId === structureId).sort((a, b) => a.sequence - b.sequence), [state.salaryRules, structureId]);
  const structure = state.salaryStructures.find((s) => s.id === structureId);

  const openRule = (rule: SalaryRule) => {
    setEditing(rule);
    setValue(rule.type === 'FIXED' ? rule.amount ?? '' : rule.type === 'PERCENTAGE' ? rule.percentage ?? '' : rule.formula ?? '');
  };
  const save = () => {
    if (!editing) return;
    const result = updateSalaryRule(editing.id, editing.type === 'FIXED' ? { amount: value } : editing.type === 'PERCENTAGE' ? { percentage: value } : { formula: value });
    toast.result(result);
    if (result.ok) setEditing(null);
  };
  const columns: Column<SalaryRule>[] = [
    { key: 'sequence', header: '#', render: (r) => r.sequence, sortValue: (r) => r.sequence, width: '56px' },
    { key: 'rule', header: 'Rule', render: (r) => <div><strong>{r.name}</strong><div className="mono muted">{r.code} · v{r.ruleVersion}</div></div>, sortValue: (r) => r.sequence },
    { key: 'category', header: 'Category', render: (r) => <Chip tone="neutral">{r.category}</Chip>, secondary: true },
    { key: 'type', header: 'Type', render: (r) => r.type },
    { key: 'calculation', header: 'Calculation', render: (r) => <code className="mono">{r.type === 'FIXED' ? `₹${r.amount}` : r.type === 'PERCENTAGE' ? `${r.percentage}% of ${r.baseCode}` : r.formula}</code> },
    { key: 'status', header: 'Status', render: (r) => <Chip tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Chip> },
    { key: 'actions', header: '', align: 'right', render: (r) => writable && <Button size="sm" icon={Pencil} onClick={() => openRule(r)}>Edit</Button> },
  ];
  return (
    <Page title="Salary Configuration" crumbs={['Payroll', 'Salary Config']}>
      <Banner tone="info" icon={ShieldCheck} title="Versioned calculations"><p>Rules already used in payroll are preserved on each payslip. Editing creates a new rule version for future computations.</p></Banner>
      <div className="grid split-side">
        <Card title="Salary structures">
          <div className="col gap3">{state.salaryStructures.map((s) => <button key={s.id} type="button" className="reccard" data-selected={s.id === structureId || undefined} onClick={() => setStructureId(s.id)} style={{ textAlign: 'left' }}><div className="row between"><strong>{s.name}</strong><Chip tone={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'Active' : 'Inactive'}</Chip></div><p className="muted">{s.code} · version {s.version}</p></button>)}</div>
        </Card>
        <Card title="Structure details"><InfoGrid items={[{ label: 'Name', value: structure?.name ?? '—' }, { label: 'Code', value: structure?.code ?? '—', mono: true }, { label: 'Version', value: structure?.version ?? '—' }, { label: 'Rules', value: rules.length }]} /><p className="secondary mt3">{structure?.description}</p></Card>
      </div>
      <Card title="Ordered salary rules" padding="flush"><DataTable rows={rules} columns={columns} rowKey={(r) => r.id} caption="Salary rules" empty={<EmptyState icon={Calculator} title="No rules in this structure" />} mobileCard={(r) => <div className="col gap2"><div className="row between"><strong>{r.name}</strong><Chip tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Chip></div><code className="mono">{r.formula ?? r.amount ?? `${r.percentage}% of ${r.baseCode}`}</code>{writable && <Button icon={Pencil} onClick={() => openRule(r)}>Edit rule</Button>}</div>} /></Card>
      <Drawer open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.name}` : 'Edit rule'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save new version</Button></>}>
        {editing && <div className="col gap4"><InfoGrid items={[{ label: 'Code', value: editing.code, mono: true }, { label: 'Type', value: editing.type }, { label: 'Current version', value: editing.ruleVersion }]} />{editing.type === 'FIXED' ? <MoneyInput label="Fixed amount" value={value} onChange={(e) => setValue(e.target.value)} /> : editing.type === 'PERCENTAGE' ? <TextInput label="Percentage" type="number" value={value} onChange={(e) => setValue(e.target.value)} /> : <TextInput label="Formula" value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} className="mono" hint="Use approved symbols and earlier rule codes only." />}<Switch checked={editing.isActive} onChange={(checked) => { toast.result(updateSalaryRule(editing.id, { isActive: checked })); setEditing({ ...editing, isActive: checked }); }} label="Rule active" /></div>}
      </Drawer>
    </Page>
  );
}
