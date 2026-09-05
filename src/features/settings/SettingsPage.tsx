import { useState } from 'react';
import { CalendarClock, Save, ShieldCheck, Zap } from 'lucide-react';
import type { AppSettings } from '@shared/types';
import { Page } from '@/app/Page';
import { updateSettings } from '@/store/actions';
import { useStore } from '@/store/store';
import { Banner, Button, Card } from '@/ui/primitives';
import { Switch, TextInput } from '@/ui/form';
import { useToast } from '@/ui/toast';

export function SettingsPage() {
  const state = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<AppSettings>({ ...state.settings });
  const number = (key: keyof AppSettings) => (value: string) => setDraft({ ...draft, [key]: Number(value) });
  const save = () => toast.result(updateSettings(draft));
  return <Page title="Settings" crumbs={['System', 'Settings']} actions={<Button variant="primary" icon={Save} onClick={save}>Save settings</Button>}><Banner tone="info" icon={ShieldCheck} title="Changes are audited"><p>Automation policies affect future actions only. Historical payroll and approvals remain unchanged.</p></Banner><div className="grid grid-2"><Card title={<span className="row"><CalendarClock size={17} />Payroll calendar</span>}><div className="grid grid-2"><TextInput label="Input cutoff day" type="number" min="1" max="28" value={draft.inputCutoffDay} onChange={(e) => number('inputCutoffDay')(e.target.value)} /><TextInput label="Pay day" type="number" min="1" max="31" value={draft.payDay} onChange={(e) => number('payDay')(e.target.value)} /><TextInput label="Variance alert threshold (%)" type="number" min="1" max="100" value={draft.varianceThresholdPercent} onChange={(e) => number('varianceThresholdPercent')(e.target.value)} /><Switch checked={draft.autoFreezeAtCutoff} onChange={(v) => setDraft({ ...draft, autoFreezeAtCutoff: v })} label="Freeze inputs at cutoff" /></div></Card><Card title={<span className="row"><Zap size={17} />Attendance & leave</span>}><div className="col gap4"><TextInput label="Late grace period (minutes)" type="number" min="0" max="120" value={draft.lateGraceMinutes} onChange={(e) => number('lateGraceMinutes')(e.target.value)} /><TextInput label="Excessive workday threshold (hours)" type="number" min="1" max="24" value={draft.excessiveHoursPerDay} onChange={(e) => number('excessiveHoursPerDay')(e.target.value)} /><Switch checked={draft.autoApproveShortSickLeave} onChange={(v) => setDraft({ ...draft, autoApproveShortSickLeave: v })} label="Auto-approve sick leave up to one day" /></div></Card><Card title="Payroll safeguards"><div className="col gap4"><Switch checked={draft.requireReopenReason} onChange={(v) => setDraft({ ...draft, requireReopenReason: v })} label="Require a reason to reopen frozen payroll" /><p className="muted">Validated and paid payruns remain protected by their state machine regardless of this setting.</p></div></Card></div></Page>;
}
