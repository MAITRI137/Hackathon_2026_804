import { useMemo, useState } from 'react';
import { Check, Download, FileText, Plus, Search } from 'lucide-react';
import { can, isSelfScoped } from '@shared/permissions';
import { formatDateTime } from '@shared/dates';
import type { EmployeeDocument } from '@shared/types';
import { Page } from '@/app/Page';
import { acknowledgeDocument, generateDocument } from '@/store/actions';
import { currentEmployee, currentRole, empName } from '@/store/selectors';
import { useStore } from '@/store/store';
import { downloadBlob } from '@/lib/export';
import { Button, Card, Chip, EmptyState, InfoGrid } from '@/ui/primitives';
import { SearchBox, Select } from '@/ui/form';
import { Modal } from '@/ui/overlays';
import { DataTable, type Column } from '@/ui/table';
import { useToast } from '@/ui/toast';

export function DocumentsPage() {
  const state = useStore();
  const role = currentRole(state);
  const me = currentEmployee(state);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(state.employees[0]?.id ?? '');
  const [kind, setKind] = useState('Employment verification letter');
  const visible = useMemo(() => state.documents.filter((doc) => {
    if (isSelfScoped(role) && doc.employeeId !== null && doc.employeeId !== me?.id) return false;
    if (category !== 'ALL' && doc.category !== category) return false;
    return `${doc.fileName} ${doc.category} ${empName(state, doc.employeeId)}`.toLowerCase().includes(query.toLowerCase());
  }), [state, role, me?.id, category, query]);
  const openDocument = (doc: EmployeeDocument) => {
    const lines = [`PeoplePay360 Document`, `File: ${doc.fileName}`, `Category: ${doc.category}`, `Employee: ${empName(state, doc.employeeId) || 'Company-wide'}`, `Uploaded: ${formatDateTime(doc.uploadedAt)}`, '', 'This prototype download represents the document record and its access-controlled metadata.'];
    downloadBlob(doc.fileName.replace(/\.pdf$/i, '.txt'), new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  };
  const columns: Column<EmployeeDocument>[] = [
    { key: 'file', header: 'Document', render: (d) => <div><strong>{d.fileName}</strong><div className="muted">{d.mimeType} · {Math.ceil(d.sizeBytes / 1024)} KB</div></div>, sortValue: (d) => d.fileName },
    { key: 'employee', header: 'Employee', render: (d) => empName(state, d.employeeId) || 'Company-wide', secondary: true },
    { key: 'category', header: 'Category', render: (d) => <Chip tone="neutral">{d.category}</Chip> },
    { key: 'uploaded', header: 'Uploaded', render: (d) => formatDateTime(d.uploadedAt), sortValue: (d) => d.uploadedAt, secondary: true },
    { key: 'ack', header: 'Acknowledgement', render: (d) => <Chip tone={d.acknowledgedAt ? 'success' : 'warning'}>{d.acknowledgedAt ? 'Acknowledged' : 'Pending'}</Chip> },
    { key: 'actions', header: '', align: 'right', render: (d) => <div className="row"><Button size="sm" icon={Download} onClick={() => openDocument(d)}>Download</Button>{role === 'EMPLOYEE' && d.employeeId === me?.id && !d.acknowledgedAt && <Button size="sm" variant="success" icon={Check} onClick={() => toast.result(acknowledgeDocument(d.id))}>Acknowledge</Button>}</div> },
  ];
  const create = async () => { const result = await generateDocument(employeeId, kind); toast.result(result); if (result.ok) setGenerateOpen(false); };
  return (
    <Page title={role === 'EMPLOYEE' ? 'My Documents' : 'Documents'} crumbs={['People', 'Documents']} actions={can(role, 'document.write') && <Button variant="primary" icon={Plus} onClick={() => setGenerateOpen(true)}>Generate document</Button>}>
      <Card padding="tight"><div className="filters"><SearchBox value={query} onChange={setQuery} placeholder="Search documents" /><Select value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: 'ALL', label: 'All categories' }, ...Array.from(new Set(state.documents.map((d) => d.category))).map((c) => ({ value: c, label: c }))]} /></div></Card>
      <Card padding="flush"><DataTable rows={visible} columns={columns} rowKey={(d) => d.id} caption="Documents" empty={<EmptyState icon={Search} title="No documents found" />} mobileCard={(d) => <div className="col gap3"><div className="row between"><FileText size={18} aria-hidden /><Chip tone="neutral">{d.category}</Chip></div><strong>{d.fileName}</strong><span className="muted">{empName(state, d.employeeId) || 'Company-wide'}</span><Button icon={Download} block onClick={() => openDocument(d)}>Download</Button>{role === 'EMPLOYEE' && d.employeeId === me?.id && !d.acknowledgedAt && <Button variant="success" icon={Check} block onClick={() => toast.result(acknowledgeDocument(d.id))}>Acknowledge</Button>}</div>} /></Card>
      <Modal open={generateOpen} onClose={() => setGenerateOpen(false)} title="Generate employee document" footer={<><Button onClick={() => setGenerateOpen(false)}>Cancel</Button><Button variant="primary" onClick={create}>Generate</Button></>}><div className="col gap4"><Select label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} options={state.employees.filter((e) => e.status !== 'ARCHIVED').map((e) => ({ value: e.id, label: `${e.fullName} · ${e.employeeCode}` }))} /><Select label="Document type" value={kind} onChange={(e) => setKind(e.target.value)} options={['Employment verification letter', 'Salary certificate', 'Experience letter', 'Address proof letter'].map((v) => ({ value: v, label: v }))} /><InfoGrid items={[{ label: 'Visibility', value: 'Employee self-service' }, { label: 'Format', value: 'PDF' }]} /></div></Modal>
    </Page>
  );
}
