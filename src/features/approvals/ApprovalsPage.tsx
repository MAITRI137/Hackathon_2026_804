import { useMemo, useState } from 'react';
import { Check, Inbox, UserRound, WalletCards, X } from 'lucide-react';
import { formatDateTime } from '@shared/dates';
import type { ApprovalItem } from '@shared/types';
import { Page } from '@/app/Page';
import { decideLeave, decideProfileChange, decideSalaryChange } from '@/store/actions';
import { approvalItems, empById } from '@/store/selectors';
import { useStore } from '@/store/store';
import { Avatar, Button, Card, Chip, EmptyState } from '@/ui/primitives';
import { SearchBox, TextArea } from '@/ui/form';
import { Modal } from '@/ui/overlays';
import { useToast } from '@/ui/toast';

const TYPE_ICON = { LEAVE: Inbox, PROFILE: UserRound, SALARY: WalletCards } as const;

export function ApprovalsPage() {
  const state = useStore();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<ApprovalItem | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const items = useMemo(() => approvalItems(state).filter((item) => {
    const employee = empById(state, item.employeeId);
    return `${employee?.fullName} ${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase());
  }), [state, query]);

  const decide = (decision: 'APPROVED' | 'REFUSED') => {
    if (!active) return;
    const result = active.type === 'LEAVE'
      ? decideLeave(active.refId, decision, note)
      : active.type === 'PROFILE'
        ? decideProfileChange(active.refId, decision, note)
        : decideSalaryChange(active.refId, decision, note);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.result(result);
    setActive(null);
    setNote('');
    setError('');
  };

  return (
    <Page title="Approval Inbox" crumbs={['Overview', 'Approvals']} actions={<Chip tone="info">{items.length} waiting</Chip>}>
      <Card padding="tight">
        <SearchBox value={query} onChange={setQuery} placeholder="Search people or requests" ariaLabel="Search approvals" />
      </Card>
      {items.length === 0 ? (
        <Card><EmptyState icon={Check} title="All caught up" description="There are no pending requests matching this view." /></Card>
      ) : (
        <div className="grid grid-2">
          {items.map((item) => {
            const employee = empById(state, item.employeeId)!;
            const Icon = TYPE_ICON[item.type];
            return (
              <Card key={item.id} title={<span className="row"><Icon size={16} aria-hidden />{item.title}</span>} action={<Chip tone="warning">Pending</Chip>}>
                <div className="col gap3">
                  <div className="row">
                    <Avatar initials={employee.initials} />
                    <div className="grow"><strong>{employee.fullName}</strong><div className="muted">{employee.employeeCode}</div></div>
                  </div>
                  <p className="secondary">{item.detail}</p>
                  <span className="muted">Submitted {formatDateTime(item.submittedAt)}</span>
                  <div className="row wrap">
                    <Button variant="primary" icon={Check} onClick={() => { setActive(item); setError(''); }}>Review & approve</Button>
                    <Button icon={X} onClick={() => { setActive(item); setError(''); }}>Review decision</Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal open={Boolean(active)} onClose={() => setActive(null)} title="Review approval" footer={
        <><Button onClick={() => setActive(null)}>Cancel</Button><Button variant="danger" icon={X} onClick={() => decide('REFUSED')}>Refuse</Button><Button variant="success" icon={Check} onClick={() => decide('APPROVED')}>Approve</Button></>
      }>
        {active && <div className="col gap4"><div><strong>{empById(state, active.employeeId)?.fullName}</strong><p className="secondary">{active.title} · {active.detail}</p></div><TextArea label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} error={error} hint="Required when refusing; optional when approving." /></div>}
      </Modal>
    </Page>
  );
}
