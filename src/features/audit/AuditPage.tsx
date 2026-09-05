import { useMemo, useState } from 'react';
import { Download, Search, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '@shared/dates';
import type { AuditEvent } from '@shared/types';
import { Page } from '@/app/Page';
import { useStore } from '@/store/store';
import { downloadCsv } from '@/lib/export';
import { Button, Card, Chip, EmptyState } from '@/ui/primitives';
import { SearchBox, Select } from '@/ui/form';
import { DataTable, type Column } from '@/ui/table';

export function AuditPage() {
  const state = useStore();
  const [query, setQuery] = useState('');
  const [entity, setEntity] = useState('ALL');
  const rows = useMemo(() => state.audit.filter((event) => (entity === 'ALL' || event.entityType === entity) && `${event.actorName} ${event.action} ${event.summary} ${event.entityId}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.at.localeCompare(a.at)), [state.audit, entity, query]);
  const columns: Column<AuditEvent>[] = [
    { key: 'time', header: 'Time', render: (e) => formatDateTime(e.at), sortValue: (e) => e.at },
    { key: 'actor', header: 'Actor', render: (e) => <div><strong>{e.actorName}</strong><div className="muted">{e.actorRole}</div></div>, sortValue: (e) => e.actorName },
    { key: 'action', header: 'Action', render: (e) => <Chip tone="info">{e.action.replaceAll('_', ' ')}</Chip> },
    { key: 'record', header: 'Record', render: (e) => <div>{e.entityType}<div className="mono muted">{e.entityId}</div></div>, secondary: true },
    { key: 'summary', header: 'Change', render: (e) => e.summary },
  ];
  const exportRows = () => downloadCsv('peoplepay360-audit-trail.csv', rows.map((e) => ({ time: e.at, actor: e.actorName, role: e.actorRole, action: e.action, entity: e.entityType, entityId: e.entityId, summary: e.summary })));
  return <Page title="Audit Trail" crumbs={['Insights', 'Audit']} actions={<Button icon={Download} onClick={exportRows}>Export visible events</Button>}><Card padding="tight"><div className="filters"><SearchBox value={query} onChange={setQuery} placeholder="Search actions, actors or records" /><Select value={entity} onChange={(e) => setEntity(e.target.value)} options={[{ value: 'ALL', label: 'All record types' }, ...Array.from(new Set(state.audit.map((e) => e.entityType))).sort().map((v) => ({ value: v, label: v }))]} /></div></Card><Card padding="flush"><DataTable rows={rows} columns={columns} rowKey={(e) => e.id} initialSort={{ key: 'time', dir: -1 }} caption="Immutable audit events" empty={<EmptyState icon={Search} title="No audit events found" />} mobileCard={(e) => <div className="col gap2"><div className="row between"><Chip tone="info">{e.action.replaceAll('_', ' ')}</Chip><span className="muted">{formatDateTime(e.at)}</span></div><strong>{e.actorName}</strong><p>{e.summary}</p><span className="mono muted">{e.entityType} · {e.entityId}</span></div>} /></Card><Card><div className="row-t"><ShieldCheck size={20} color="var(--brand)" aria-hidden /><div><strong>Evidence, not mutable history</strong><p className="secondary">Business actions append events with actor, time, record, and human-readable consequence. Filtering never changes the underlying log.</p></div></div></Card></Page>;
}
