/**
 * Payslip delivery and the simulated payout run.
 *
 * Two integrations are deliberately faked at the boundary and completely real
 * inside the product. Nothing here sends mail and nothing here moves money —
 * every screen on this page says so — but the outbox, the payment batch, the
 * failure reasons and the retry counts are persisted rows: they survive a
 * refresh, they respect RBAC, and an employee sees the state of their own
 * payslip without seeing anybody else's.
 *
 * Delivery runs beside payroll, never through it: a failed message is recorded
 * here and can never change a computed amount.
 */
import { useMemo, useState } from 'react';
import { Banknote, Download, Inbox, Mail, RotateCw, Send, TriangleAlert } from 'lucide-react';
import { formatMoney, money, addMoney, toMoneyString } from '@shared/money';
import { formatDateTime, monthLabel } from '@shared/dates';
import { useStore } from '@/store/store';
import { activePayrun, empById, payslipsOf } from '@/store/selectors';
import { retryDelivery, retryDemoPayment, runDemoPaymentBatch, sendPayslips } from '@/store/actions';
import { Page } from '@/app/Page';
import { Avatar, Banner, Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { DataTable, type Column } from '@/ui/table';
import { useToast } from '@/ui/toast';
import { downloadCsv } from '@/lib/export';
import type { DemoPaymentBatchView } from '@/store/state';
import type { OutboxMessage, Payslip } from '@shared/types';

type PaymentItem = DemoPaymentBatchView['items'][number] & { reference: string };

const deliveryChip = (status: Payslip['delivery']) =>
  status === 'SENT' ? (
    <Chip tone="success" dot>
      Sent (simulated)
    </Chip>
  ) : status === 'FAILED' ? (
    <Chip tone="danger" dot>
      Failed (simulated)
    </Chip>
  ) : (
    <Chip tone="neutral" dot>
      Not sent
    </Chip>
  );

export function DeliveryPage() {
  const state = useStore();
  const toast = useToast();
  const payrun = activePayrun(state);
  const [busy, setBusy] = useState<'send' | 'pay' | null>(null);

  const slips = useMemo(() => payslipsOf(state, payrun.id), [state, payrun.id]);
  const messages = useMemo(
    () => state.outbox.filter((m) => slips.some((s) => s.id === m.payslipId)),
    [state.outbox, slips],
  );
  const batches = useMemo(
    () => state.demoPayments.filter((batch) => batch.payrunId === payrun.id),
    [state.demoPayments, payrun.id],
  );
  const paymentItems = useMemo<PaymentItem[]>(
    () => batches.flatMap((batch) => batch.items.map((item) => ({ ...item, reference: batch.reference }))),
    [batches],
  );

  const sent = slips.filter((s) => s.delivery === 'SENT').length;
  const failed = slips.filter((s) => s.delivery === 'FAILED').length;
  const settled = paymentItems.filter((item) => item.status === 'SIMULATED_SUCCESS').length;
  const rejected = paymentItems.filter((item) => item.status === 'SIMULATED_FAILURE').length;
  const decided = payrun.status === 'VALIDATED' || payrun.status === 'PAID';

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
      render: (p) => deliveryChip(p.delivery),
    },
    {
      key: 'when',
      header: 'When',
      secondary: true,
      render: (p) => (p.deliveredAt ? formatDateTime(p.deliveredAt) : (p.deliveryError ?? '—')),
    },
  ];

  const outboxColumns: Column<OutboxMessage>[] = [
    { key: 'to', header: 'To', render: (m) => <span className="truncate">{m.to}</span> },
    { key: 'subject', header: 'Subject', render: (m) => m.subject },
    {
      key: 'status',
      header: 'Status',
      render: (m) =>
        m.status === 'SIMULATED_SENT' ? (
          <Chip tone="success" dot>
            Sent (simulated)
          </Chip>
        ) : m.status === 'QUEUED' ? (
          <Chip tone="neutral" dot>
            Queued
          </Chip>
        ) : (
          <Chip tone="danger" dot>
            Failed (simulated)
          </Chip>
        ),
    },
    {
      key: 'error',
      header: 'Detail',
      secondary: true,
      render: (m) => (
        <span className="muted">{m.error ?? formatDateTime(m.sentAt ?? m.createdAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (m) =>
        m.status === 'SIMULATED_FAILED' ? (
          <Button size="sm" icon={RotateCw} onClick={() => toast.result(retryDelivery(m.id))}>
            Retry
          </Button>
        ) : null,
    },
  ];

  const paymentColumns: Column<PaymentItem>[] = [
    {
      key: 'employee',
      header: 'Employee',
      sortValue: (item) => empById(state, item.employeeId)?.fullName ?? '',
      render: (item) => {
        const e = empById(state, item.employeeId);
        return (
          <span className="person">
            <Avatar initials={e?.initials ?? '??'} size="sm" />
            <span className="truncate">
              <span className="person-name">{e?.fullName ?? item.employeeId}</span>
              <span className="person-meta mono">{item.accountMasked}</span>
            </span>
          </span>
        );
      },
    },
    { key: 'reference', header: 'Batch', secondary: true, render: (item) => <span className="mono">{item.reference}</span> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortValue: (item) => money(item.amount).toNumber(),
      render: (item) => formatMoney(item.amount),
    },
    {
      key: 'status',
      header: 'Outcome',
      render: (item) =>
        item.status === 'SIMULATED_SUCCESS' ? (
          <Chip tone="success" dot>
            Settled (simulated)
          </Chip>
        ) : item.status === 'QUEUED' ? (
          <Chip tone="neutral" dot>
            Queued
          </Chip>
        ) : (
          <Chip tone="danger" dot>
            Rejected (simulated)
          </Chip>
        ),
    },
    {
      key: 'detail',
      header: 'Detail',
      secondary: true,
      render: (item) => (
        <span className="muted">
          {item.failureReason ?? (item.retryCount > 0 ? `Settled after ${item.retryCount} retry` : '—')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (item) =>
        item.status === 'SIMULATED_FAILURE' ? (
          <Button size="sm" icon={RotateCw} onClick={() => toast.result(retryDemoPayment(item.id))}>
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
        account_number_masked: e.bank!.accountNumberMasked,
        ifsc: e.bank!.ifsc,
        amount: s.net,
        reference: s.payslipRef,
      };
    });
    const total = toMoneyString(payable.reduce((acc, s) => addMoney(acc, s.net), money(0)));
    downloadCsv(`demo-bank-advice-${payrun.periodStart.slice(0, 7)}.csv`, rows, [
      `# PeoplePay360 DEMO bank advice · ${monthLabel(payrun.periodStart)}`,
      '# Masked account details only. This file cannot be used to transfer money.',
      `# rows=${rows.length} total=${total}`,
    ]);
    toast.success(`Demo bank advice exported — ${rows.length} rows, masked account details only`);
  };

  return (
    <Page title="Delivery and payout" crumbs={['Payroll', 'Delivery']}>
      <Banner tone="info" icon={Mail} title="Both integrations on this page are simulated">
        No email is sent and no money is transferred. The queue, the statuses, the failure reasons
        and the retries are real persisted records, so the workflow behaves exactly as it would
        against a live provider.
      </Banner>

      {!decided ? (
        <Banner tone="info" icon={Mail} title="Delivery opens after validation">
          {monthLabel(payrun.periodStart)} is {payrun.status.toLowerCase()}. Payslips can be sent and
          the payout simulated once the payroll run is validated.
        </Banner>
      ) : failed > 0 || rejected > 0 ? (
        <Banner
          tone="danger"
          icon={TriangleAlert}
          title={`${failed} deliveries and ${rejected} payments failed in the simulation`}
        >
          Payroll amounts are unaffected — the computed net for every employee is unchanged. Retry
          the individual rows below; each retry is recorded against the same persisted record.
        </Banner>
      ) : null}

      <div className="grid grid-4">
        <Metric label="Payslips" value={slips.length} />
        <Metric label="Delivered (simulated)" value={sent} tone="success" />
        <Metric label="Settled (simulated)" value={settled} tone={settled > 0 ? 'success' : undefined} />
        <Metric
          label="Net payroll"
          value={formatMoney(netTotal)}
          tone="brand"
          sub="Unchanged by delivery or payout"
        />
      </div>

      <div className="row gap2 wrap">
        <Button
          variant="primary"
          icon={Send}
          pending={busy === 'send'}
          disabled={!decided}
          onClick={async () => {
            setBusy('send');
            toast.result(await sendPayslips(payrun.id));
            setBusy(null);
          }}
        >
          {sent > 0 ? 'Resend all payslips' : 'Send all payslips'}
        </Button>
        <Button
          icon={Banknote}
          pending={busy === 'pay'}
          disabled={!decided}
          onClick={async () => {
            setBusy('pay');
            toast.result(await runDemoPaymentBatch(payrun.id));
            setBusy(null);
          }}
        >
          Run demo payment batch
        </Button>
        <Button icon={Download} onClick={exportBankAdvice} disabled={payable.length === 0}>
          Export demo bank advice ({payable.length})
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
          empty={
            <EmptyState icon={Inbox} title="No payslips yet" description="Compute the payroll run first." />
          }
          mobileCard={(p) => {
            const e = empById(state, p.employeeId);
            return (
              <>
                <div className="row between">
                  <span className="person">
                    <Avatar initials={e?.initials ?? '??'} size="sm" />
                    <span className="person-name">{e?.fullName}</span>
                  </span>
                  {deliveryChip(p.delivery)}
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
        title="Demo payment simulation"
        subtitle="No money is transferred. Outcomes are deterministic, so the same run always produces the same rejections — and a retry resolves them."
        padding="flush"
      >
        <DataTable
          rows={paymentItems}
          columns={paymentColumns}
          rowKey={(item) => item.id}
          pageSize={8}
          empty={
            <EmptyState
              icon={Banknote}
              title="No payment batch yet"
              description="Run the demo payment batch once the payroll run is validated."
            />
          }
        />
      </Card>

      <Card
        title="Demo email outbox"
        subtitle="No email was sent. Every queued message, failure reason and retry is stored, so nothing is silently lost."
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
