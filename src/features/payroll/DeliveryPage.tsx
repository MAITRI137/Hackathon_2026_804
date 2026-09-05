/**
 * Payslip delivery and the persisted outbox.
 *
 * Delivery is a state machine that runs beside payroll, never through it:
 * a failed email is recorded here and cannot change a computed amount.
 */
import { useMemo, useState } from 'react';
import { Download, Inbox, Mail, RotateCw, Send, TriangleAlert } from 'lucide-react';
import { formatMoney, money, addMoney, toMoneyString } from '@shared/money';
import { formatDateTime, monthLabel } from '@shared/dates';
import { useStore } from '@/store/store';
import { activePayrun, empById, payslipsOf } from '@/store/selectors';
import { retryDelivery, sendPayslips } from '@/store/actions';
import { Page } from '@/app/Page';
import { Avatar, Banner, Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { DataTable, type Column } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { downloadCsv } from '@/lib/export';
import type { OutboxMessage, Payslip } from '@shared/types';

export function DeliveryPage() {
  const state = useStore();
  const toast = useToast();
  const payrun = activePayrun(state);
  const [busy, setBusy] = useState(false);

  const slips = useMemo(
    () => payslipsOf(state, payrun.id).filter((p) => !p.isDuplicate),
    [state, payrun.id],
  );
  const messages = useMemo(
    () => state.outbox.filter((m) => slips.some((s) => s.id === m.payslipId)),
    [state.outbox, slips],
  );

  const sent = slips.filter((s) => s.delivery === 'SENT').length;
  const failed = slips.filter((s) => s.delivery === 'FAILED').length;

  const netTotal = toMoneyString(slips.reduce((acc, s) => addMoney(acc, s.net), money(0)));
  const payable = slips.filter((s) => empById(state, s.employeeId)?.bank?.verifiedAt);
  const unbanked = slips.filter((s) => !empById(state, s.employeeId)?.bank?.verifiedAt);

  const columns: Column<Payslip>[] = [
    {
      key: 'employee',
      header: 'Employee',
      sortValue: (p) => empById(state, p.employeeId)?.fullName ?? '',
      render: (p) => {
        const e = empById(state, p.employeeId);
        return (
          <span className="person">
            <Avatar initials={e?.initials ?? '??'} size="sm" />
            <span className="truncate">
              <span className="person-name">{e?.fullName}</span>
              <span className="person-meta">{e?.email}</span>
            </span>
          </span>
        );
      },
    },
    { key: 'ref', header: 'Payslip', render: (p) => <span className="mono">{p.payslipRef}</span> },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      sortValue: (p) => money(p.net).toNumber(),
      render: (p) => formatMoney(p.net),
    },
    {
      key: 'status',
      header: 'Delivery',
      sortValue: (p) => p.delivery,
      render: (p) =>
        p.delivery === 'SENT' ? (
          <Chip tone="success" dot>
            Sent
          </Chip>
        ) : p.delivery === 'FAILED' ? (
          <Chip tone="danger" dot>
            Failed
          </Chip>
        ) : (
          <Chip tone="neutral" dot>
            Not sent
          </Chip>
        ),
    },
    {
      key: 'when',
      header: 'When',
      secondary: true,
      render: (p) => (p.deliveredAt ? formatDateTime(p.deliveredAt) : p.deliveryError ?? '—'),
    },
  ];

  const outboxColumns: Column<OutboxMessage>[] = [
    { key: 'to', header: 'To', render: (m) => <span className="truncate">{m.to}</span> },
    { key: 'subject', header: 'Subject', render: (m) => m.subject },
    {
      key: 'status',
      header: 'Status',
      render: (m) =>
        m.status === 'SENT' ? (
          <Chip tone="success" dot>
            Sent
          </Chip>
        ) : (
          <Chip tone="danger" dot>
            Failed
          </Chip>
        ),
    },
    {
      key: 'error',
      header: 'Detail',
      secondary: true,
      render: (m) => <span className="muted">{m.error ?? formatDateTime(m.sentAt ?? m.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (m) =>
        m.status === 'FAILED' ? (
          <Button size="sm" icon={RotateCw} onClick={() => toast.result(retryDelivery(m.id))}>
            Retry
          </Button>
        ) : null,
    },
  ];

  const exportBankAdvice = () => {
    const rows = payable.map((s) => {
      const e = empById(state, s.employeeId)!;
      return {
        employee_code: e.employeeCode,
        account_name: e.bank!.accountName,
        account_number: e.bank!.accountNumberMasked,
        ifsc: e.bank!.ifsc,
        amount: s.net,
        reference: `${s.payslipRef}`,
      };
    });
    const total = toMoneyString(payable.reduce((acc, s) => addMoney(acc, s.net), money(0)));
    downloadCsv(`bank-advice-${payrun.periodStart.slice(0, 7)}.csv`, rows, [
      `# PeoplePay360 bank advice · ${monthLabel(payrun.periodStart)}`,
      `# rows=${rows.length} total=${total}`,
    ]);
    toast.success(`Bank advice exported — ${rows.length} rows, ${formatMoney(total)}`);
  };

  return (
    <Page title="Payslip delivery" crumbs={['Payroll', 'Delivery']}>
      {payrun.status !== 'VALIDATED' && payrun.status !== 'PAID' ? (
        <Banner tone="info" icon={Mail} title="Delivery opens after validation">
          {monthLabel(payrun.periodStart)} is {payrun.status.toLowerCase()}. Payslips can be sent once
          the payrun is validated.
        </Banner>
      ) : failed > 0 ? (
        <Banner tone="danger" icon={TriangleAlert} title={`${failed} deliveries failed`}>
          Payroll amounts are unaffected — the computed net for every employee is unchanged. Fix the
          email address on the employee record, then retry from the outbox below.
        </Banner>
      ) : null}

      <div className="grid grid-4">
        <Metric label="Payslips" value={slips.length} />
        <Metric label="Sent" value={sent} tone="success" />
        <Metric label="Failed" value={failed} tone={failed > 0 ? 'danger' : undefined} />
        <Metric label="Net payroll" value={formatMoney(netTotal)} tone="brand" sub="Unchanged by delivery" />
      </div>

      <div className="row gap2 wrap">
        <Button
          variant="primary"
          icon={Send}
          pending={busy}
          disabled={payrun.status !== 'VALIDATED' && payrun.status !== 'PAID'}
          onClick={() => {
            setBusy(true);
            const r = sendPayslips(payrun.id);
            setBusy(false);
            toast.result(r);
          }}
        >
          {sent > 0 ? 'Resend all payslips' : 'Send all payslips'}
        </Button>
        <Button icon={Download} onClick={exportBankAdvice} disabled={payable.length === 0}>
          Export bank advice ({payable.length})
        </Button>
        {unbanked.length > 0 && (
          <Chip tone="warning" icon={TriangleAlert}>
            {unbanked.length} excluded — no verified bank account
          </Chip>
        )}
      </div>

      <Card title="Delivery status" padding="flush">
        <DataTable
          rows={slips}
          columns={columns}
          rowKey={(p) => p.id}
          pageSize={12}
          caption="Payslip delivery status"
          empty={<EmptyState icon={Inbox} title="No payslips yet" description="Compute the payrun first." />}
          mobileCard={(p) => {
            const e = empById(state, p.employeeId);
            return (
              <>
                <div className="row between">
                  <span className="person">
                    <Avatar initials={e?.initials ?? '??'} size="sm" />
                    <span className="person-name">{e?.fullName}</span>
                  </span>
                  {p.delivery === 'SENT' ? (
                    <Chip tone="success" dot>
                      Sent
                    </Chip>
                  ) : p.delivery === 'FAILED' ? (
                    <Chip tone="danger" dot>
                      Failed
                    </Chip>
                  ) : (
                    <Chip tone="neutral" dot>
                      Not sent
                    </Chip>
                  )}
                </div>
                <dl className="reccard-kv">
                  <dt>Net</dt>
                  <dd className="mono">{formatMoney(p.net)}</dd>
                  <dt>Payslip</dt>
                  <dd className="mono">{p.payslipRef}</dd>
                </dl>
              </>
            );
          }}
        />
      </Card>

      <Card
        title="Outbox"
        subtitle="Persisted locally, so the demo works with no mail server and nothing is silently lost"
        padding="flush"
      >
        <DataTable
          rows={messages}
          columns={outboxColumns}
          rowKey={(m) => m.id}
          pageSize={8}
          empty={
            <EmptyState
              icon={Inbox}
              title="Outbox is empty"
              description="Messages appear here as soon as payslips are sent."
            />
          }
        />
      </Card>
    </Page>
  );
}
