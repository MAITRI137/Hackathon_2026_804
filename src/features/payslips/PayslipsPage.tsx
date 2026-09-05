import { useMemo, useState } from 'react';
import { Download, Receipt, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { can } from '@shared/permissions';
import { formatMoney } from '@shared/money';
import { monthLabel } from '@shared/dates';
import type { Payslip } from '@shared/types';
import { Page } from '@/app/Page';
import { currentEmployee, currentRole, empById } from '@/store/selectors';
import { useStore } from '@/store/store';
import { Avatar, Button, Card, Chip, EmptyState } from '@/ui/primitives';
import { SearchBox, Select } from '@/ui/form';
import { DataTable, type Column } from '@/ui/table';

export function PayslipsPage() {
  const state = useStore();
  const navigate = useNavigate();
  const role = currentRole(state);
  const me = currentEmployee(state);
  const [query, setQuery] = useState('');
  const [payrunId, setPayrunId] = useState('ALL');
  const canReadAll = can(role, 'payslip.read.all');
  const rows = useMemo(
    () =>
      state.payslips.filter((p) => {
        if (p.isDuplicate || p.status === 'CANCELLED') return false;
        if (!canReadAll && p.employeeId !== me?.id) return false;
        if (payrunId !== 'ALL' && p.payrunId !== payrunId) return false;
        const employee = empById(state, p.employeeId);
        return `${employee?.fullName} ${employee?.employeeCode} ${p.payslipRef}`
          .toLowerCase()
          .includes(query.toLowerCase());
      }),
    [state, canReadAll, me?.id, payrunId, query],
  );
  const columns: Column<Payslip>[] = [
    {
      key: 'employee',
      header: 'Employee',
      render: (p) => {
        const e = empById(state, p.employeeId)!;
        return (
          <span className="row">
            <Avatar initials={e.initials} size="sm" />
            <span>
              <strong>{e.fullName}</strong>
              <span className="muted" style={{ display: 'block' }}>
                {e.employeeCode}
              </span>
            </span>
          </span>
        );
      },
      sortValue: (p) => empById(state, p.employeeId)?.fullName ?? '',
    },
    {
      key: 'period',
      header: 'Period',
      render: (p) => monthLabel(p.periodStart),
      sortValue: (p) => p.periodStart,
    },
    {
      key: 'gross',
      header: 'Gross',
      align: 'right',
      render: (p) => formatMoney(p.gross),
      sortValue: (p) => Number(p.gross),
    },
    {
      key: 'deductions',
      header: 'Deductions',
      align: 'right',
      secondary: true,
      render: (p) => formatMoney(p.totalDeductions),
    },
    {
      key: 'net',
      header: 'Net pay',
      align: 'right',
      render: (p) => <strong>{formatMoney(p.net)}</strong>,
      sortValue: (p) => Number(p.net),
    },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <Chip tone={p.status === 'PAID' ? 'success' : 'info'}>{p.status}</Chip>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) => (
        <Button size="sm" icon={Download} onClick={() => navigate(`/payslips/${p.id}`)}>
          Open
        </Button>
      ),
    },
  ];
  return (
    <Page title={canReadAll ? 'Payslips' : 'My Payslips'} crumbs={['Payroll', 'Payslips']}>
      <Card padding="tight">
        <div className="filters">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Search payslips"
            ariaLabel="Search payslips"
          />
          <Select
            value={payrunId}
            onChange={(e) => setPayrunId(e.target.value)}
            options={[
              { value: 'ALL', label: 'All periods' },
              ...state.payruns
                .slice()
                .reverse()
                .map((p) => ({ value: p.id, label: monthLabel(p.periodStart) })),
            ]}
          />
        </div>
      </Card>
      <Card padding="flush">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          initialSort={{ key: 'period', dir: -1 }}
          onRowClick={(p) => navigate(`/payslips/${p.id}`)}
          caption="Payslips"
          empty={
            <EmptyState
              icon={Search}
              title="No payslips found"
              description="Try another period or search term."
            />
          }
          mobileCard={(p) => {
            const e = empById(state, p.employeeId)!;
            return (
              <div className="col gap3">
                <div className="row between">
                  <span className="row">
                    <Avatar initials={e.initials} size="sm" />
                    <strong>{e.fullName}</strong>
                  </span>
                  <Chip tone="success">{p.status}</Chip>
                </div>
                <div className="row between">
                  <span className="muted">{monthLabel(p.periodStart)}</span>
                  <strong>{formatMoney(p.net)}</strong>
                </div>
                <Button
                  variant="primary"
                  icon={Receipt}
                  block
                  onClick={() => navigate(`/payslips/${p.id}`)}
                >
                  Open payslip
                </Button>
              </div>
            );
          }}
        />
      </Card>
    </Page>
  );
}
