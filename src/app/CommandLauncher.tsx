/**
 * X01 — Universal Action Launcher.
 *
 * Role-aware, generated from live state, fuzzy, keyboard-first, and incapable
 * of surfacing a record or action the signed-in role may not reach.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  BadgeIndianRupee,
  CalendarOff,
  FileText,
  Play,
  Receipt,
  Search,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { can } from '@shared/permissions';
import { formatMoneyShort } from '@shared/money';
import { monthLabel } from '@shared/dates';
import { useStore } from '@/store/store';
import {
  currentRole,
  currentEmployee,
  deptName,
  exceptionsFor,
  positionName,
  visibleEmployees,
} from '@/store/selectors';
import { useLayer, useFocusTrap } from '@/ui/overlays';
import { navFor, labelFor } from './nav';

export interface LauncherResult {
  id: string;
  kind: 'Employee' | 'Contract' | 'Payrun' | 'Payslip' | 'Module' | 'Action';
  title: string;
  subtitle: string;
  icon: LucideIcon;
  run: () => void;
}

/** Subsequence match — "arp" finds "Aarav Patel". */
function fuzzy(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i += 1;
    if (i === n.length) return true;
  }
  return false;
}

export function CommandLauncher({
  open,
  onClose,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  onAction: (action: 'new-employee' | 'request-leave' | 'compute') => void;
}) {
  const state = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useLayer('launcher', open, onClose);
  const trapRef = useFocusTrap(open);

  const role = currentRole(state);

  const results = useMemo<LauncherResult[]>(() => {
    if (!open) return [];
    const out: LauncherResult[] = [];
    const go = (to: string) => () => navigate(to);

    /* Modules — exactly the routes this role may open. */
    for (const group of navFor(role)) {
      for (const item of group.items) {
        out.push({
          id: `mod-${item.to}`,
          kind: 'Module',
          title: labelFor(item, role),
          subtitle: group.label,
          icon: item.icon,
          run: go(item.to),
        });
      }
    }

    /* Actions */
    if (can(role, 'employee.write')) {
      out.push({
        id: 'act-new-employee',
        kind: 'Action',
        title: 'Create employee',
        subtitle: 'Add a person and start onboarding',
        icon: UserPlus,
        run: () => onAction('new-employee'),
      });
    }
    if (can(role, 'timeoff.request.self')) {
      out.push({
        id: 'act-leave',
        kind: 'Action',
        title: 'Request leave',
        subtitle: 'Submit a new time-off request',
        icon: CalendarOff,
        run: () => onAction('request-leave'),
      });
    }
    if (can(role, 'payrun.compute')) {
      out.push({
        id: 'act-compute',
        kind: 'Action',
        title: 'Compute active payroll',
        subtitle: 'Recalculate payslips for the open period',
        icon: Play,
        run: () => onAction('compute'),
      });
    }

    /* Employees — from live state, self-scoped for the Employee role. */
    for (const e of visibleEmployees(state)) {
      out.push({
        id: `emp-${e.id}`,
        kind: 'Employee',
        title: e.fullName,
        subtitle: `${positionName(state, e.jobPositionId)} · ${deptName(state, e.departmentId)}`,
        icon: Users,
        run: go(`/employees/${e.id}`),
      });
    }

    /* Contracts */
    if (can(role, 'contract.read.all')) {
      for (const c of state.contracts.filter((x) => x.status === 'ACTIVE')) {
        const emp = state.employees.find((e) => e.id === c.employeeId);
        if (!emp) continue;
        out.push({
          id: `ct-${c.id}`,
          kind: 'Contract',
          title: c.contractRef,
          subtitle: `${emp.fullName} · ${formatMoneyShort(c.wage)}/month`,
          icon: FileText,
          run: go('/contracts'),
        });
      }
    } else if (can(role, 'contract.read.self')) {
      const me = currentEmployee(state);
      for (const c of state.contracts.filter((x) => x.employeeId === me?.id)) {
        out.push({
          id: `ct-${c.id}`,
          kind: 'Contract',
          title: c.contractRef,
          subtitle: `My contract · ${c.startDate} → ${c.endDate ?? 'open-ended'}`,
          icon: FileText,
          run: go('/contracts'),
        });
      }
    }

    /* Payruns */
    if (can(role, 'payrun.read')) {
      for (const p of state.payruns) {
        const blockers =
          p.id === state.activePayrunId
            ? exceptionsFor(state, p).filter((x) => x.blocking).length
            : 0;
        out.push({
          id: `pr-${p.id}`,
          kind: 'Payrun',
          title: p.name,
          subtitle:
            p.status === 'COMPUTED' && blockers > 0
              ? `${p.status} · ${blockers} blocker${blockers === 1 ? '' : 's'}`
              : p.status,
          icon: BadgeIndianRupee,
          run: go('/payroll'),
        });
      }
    }

    /* Payslips — own only, unless the role may read all. */
    const me = currentEmployee(state);
    const slips = can(role, 'payslip.read.all')
      ? state.payslips.filter((p) => !p.isDuplicate).slice(0, 60)
      : state.payslips.filter((p) => p.employeeId === me?.id && !p.isDuplicate);
    for (const s of slips) {
      const emp = state.employees.find((e) => e.id === s.employeeId);
      out.push({
        id: `ps-${s.id}`,
        kind: 'Payslip',
        title: `${emp?.fullName ?? s.employeeId} — ${monthLabel(s.periodStart)}`,
        subtitle: `Net ${formatMoneyShort(s.net)} · ${s.payslipRef}`,
        icon: Receipt,
        run: go(`/payslips/${s.id}`),
      });
    }

    return out;
  }, [open, state, role, navigate, onAction]);

  const filtered = useMemo(() => {
    const q = query.trim();
    const matched = results.filter((r) => fuzzy(`${r.title} ${r.subtitle} ${r.kind}`, q));
    const order = ['Action', 'Module', 'Employee', 'Payrun', 'Payslip', 'Contract'];
    return matched.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).slice(0, 40);
  }, [results, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const runAt = (i: number) => {
    const item = filtered[i];
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(index);
    }
  };

  let lastKind = '';

  return createPortal(
    <div
      className="launcher-layer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ background: 'var(--overlay)' }}
    >
      <div
        className="launcher"
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        ref={trapRef}
        onKeyDown={onKeyDown}
      >
        <div className="launcher-input">
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="launcher-list"
            aria-activedescendant={filtered[index] ? `cmd-${filtered[index].id}` : undefined}
            aria-autocomplete="list"
            placeholder="Search people, payruns, payslips, modules and actions…"
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="launcher-results" id="launcher-list" role="listbox" ref={listRef}>
          {filtered.length === 0 ? (
            <p className="empty" style={{ padding: 'var(--s6)' }}>
              No results for “{query}”. Try a name, a module or an action.
            </p>
          ) : (
            filtered.map((r, i) => {
              const header = r.kind !== lastKind ? r.kind : null;
              lastKind = r.kind;
              const Icon = r.icon;
              return (
                <div key={r.id}>
                  {header && (
                    <div className="launcher-group" role="presentation">
                      {header === 'Module' ? 'Go to' : header}
                    </div>
                  )}
                  <button
                    type="button"
                    id={`cmd-${r.id}`}
                    role="option"
                    aria-selected={i === index}
                    className="launcher-item"
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => runAt(i)}
                  >
                    <Icon size={17} aria-hidden />
                    <span className="li-main">
                      <b>{r.title}</b>
                      <span>{r.subtitle}</span>
                    </span>
                    <span className="launcher-kind">{r.kind}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="launcher-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
