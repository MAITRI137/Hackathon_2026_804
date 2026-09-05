import { useMemo, useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { monthLabel } from '@shared/dates';
import type { ExceptionCategory, PayrollException } from '@shared/types';
import { useStore } from '@/store/store';
import { activePayrun, exceptionsFor, readinessFor } from '@/store/selectors';
import { Page } from '@/app/Page';
import { Banner, Card, EmptyState } from '@/ui/primitives';
import { Ring, Tabs } from '@/ui/feedback';
import { BlockerCard, ResolveDialog, useLeavingIds } from './BlockerResolve';

const CATEGORY_LABEL: Record<ExceptionCategory, string> = {
  CONTRACT: 'Contracts',
  BANK: 'Bank details',
  ATTENDANCE: 'Attendance',
  LEAVE: 'Leave',
  PAYSLIP: 'Payslip integrity',
  RULE: 'Salary rules',
};

export function ExceptionsPage() {
  const state = useStore();
  const payrun = activePayrun(state);
  const exceptions = useMemo(() => exceptionsFor(state, payrun), [state, payrun]);
  const readiness = useMemo(() => readinessFor(state, payrun), [state, payrun]);
  const [tab, setTab] = useState<'blocking' | 'warning' | 'all'>('blocking');
  const [resolving, setResolving] = useState<PayrollException | null>(null);
  const { leaving, markLeaving } = useLeavingIds();

  const blocking = exceptions.filter((e) => e.blocking);
  const warnings = exceptions.filter((e) => !e.blocking);
  const shown = tab === 'blocking' ? blocking : tab === 'warning' ? warnings : exceptions;

  const grouped = useMemo(() => {
    const map = new Map<ExceptionCategory, PayrollException[]>();
    for (const e of shown) {
      map.set(e.category, [...(map.get(e.category) ?? []), e]);
    }
    return [...map.entries()];
  }, [shown]);

  return (
    <Page title="Payroll Exception Centre" crumbs={['Payroll', 'Exceptions']}>
      {blocking.length === 0 ? (
        <Banner tone="success" icon={CircleCheck} title="All blocking exceptions are resolved">
          {monthLabel(payrun.periodStart)} payroll is at {readiness.score}% readiness and can be
          validated.
        </Banner>
      ) : (
        <Banner
          tone="warning"
          icon={TriangleAlert}
          title={`${blocking.length} exception${blocking.length === 1 ? '' : 's'} are blocking ${monthLabel(payrun.periodStart)} payroll`}
        >
          Each one is fixed by correcting the underlying record. Readiness updates as soon as it is.
        </Banner>
      )}

      <div className="grid split-main">
        <Card padding="tight">
          <Tabs
            ariaLabel="Exception filter"
            value={tab}
            onChange={(k) => setTab(k as typeof tab)}
            tabs={[
              { key: 'blocking', label: 'Blocking', count: blocking.length },
              { key: 'warning', label: 'Warnings', count: warnings.length },
              { key: 'all', label: 'All', count: exceptions.length },
            ]}
          />
          <div className="col gap5 mt4">
            {grouped.length === 0 ? (
              <EmptyState
                icon={CircleCheck}
                title="Nothing here"
                description={
                  tab === 'blocking'
                    ? 'No exception is blocking this payrun.'
                    : 'No warnings for this period.'
                }
              />
            ) : (
              grouped.map(([category, items]) => (
                <div key={category} className="col gap2">
                  <h4 className="eyebrow">
                    {CATEGORY_LABEL[category]} · {items.length}
                  </h4>
                  {items.map((e) => (
                    <BlockerCard
                      key={e.id}
                      exception={e}
                      leaving={leaving.has(e.id)}
                      onResolve={() => setResolving(e)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card title="Readiness" padding="tight">
          <div className="col" style={{ alignItems: 'center', gap: 'var(--s3)' }}>
            <Ring percent={readiness.score} />
            <p className="muted center" style={{ fontSize: 'var(--fs-sm)' }}>
              {blocking.length === 0
                ? 'Ready to validate.'
                : `Each open blocking exception subtracts its severity. Resolving these ${blocking.length} returns the score to 100%.`}
            </p>
          </div>
          <div className="col gap2 mt4">
            {readiness.categories.map((c) => (
              <div className="row between" key={c.category} style={{ fontSize: 'var(--fs-sm)' }}>
                <span className="muted">{c.label}</span>
                <span className="mono">
                  {c.passing}/{c.total}
                </span>
              </div>
            ))}
          </div>
          <p className="muted mt4" style={{ fontSize: 'var(--fs-xs)' }}>
            Counts are employees with clean inputs in that category for {monthLabel(payrun.periodStart)}.
          </p>
        </Card>
      </div>

      <ResolveDialog
        exception={resolving}
        onClose={() => {
          if (resolving) markLeaving(resolving.id);
          setResolving(null);
        }}
      />
    </Page>
  );
}
