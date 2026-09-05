import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import clsx from 'clsx';

/* ── Readiness ring ────────────────────────────────────────── */

export function Ring({
  percent,
  size = 118,
  label = 'ready',
}: {
  percent: number;
  size?: number;
  label?: string;
}) {
  const r = size / 2 - 7;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circ * (1 - clamped / 100);
  const color =
    clamped >= 100 ? 'var(--success)' : clamped >= 80 ? 'var(--brand)' : 'var(--warning-strong)';

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={7} />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={7}
          stroke={color}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="ring-label">
        <b style={{ color }}>
          <CountUp value={clamped} suffix="%" />
        </b>
        <span>{label}</span>
      </span>
    </div>
  );
}

/** Animates only when the value genuinely changes. */
export function CountUp({
  value,
  suffix = '',
  duration = 550,
}: {
  value: number;
  suffix?: string;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (value === from.current) return;
    const start = performance.now();
    const a = from.current;
    const b = value;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      from.current = b;
      setShown(b);
      return;
    }
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(a + (b - a) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <>
      {shown}
      {suffix}
    </>
  );
}

/* ── State stepper ─────────────────────────────────────────── */

export function Stepper({
  steps,
  current,
}: {
  steps: { key: string; label: string; caption: string }[];
  current: string;
}) {
  const index = steps.findIndex((s) => s.key === current);
  return (
    <ol className="stepper" aria-label="Payrun lifecycle">
      {steps.map((s, i) => {
        const state = i < index ? 'done' : i === index ? 'current' : 'future';
        return (
          <li
            className="step"
            data-state={state}
            key={s.key}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <b>
              {state === 'done' && <Check size={13} strokeWidth={3} aria-hidden />}
              {s.label}
            </b>
            <span>
              {state === 'future' ? s.caption : state === 'done' ? 'Completed' : s.caption}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Tabs ──────────────────────────────────────────────────── */

export interface TabDef {
  key: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: TabDef[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === value);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(tabs[(i + 1) % tabs.length].key);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(tabs[(i - 1 + tabs.length) % tabs.length].key);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(tabs[0].key);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(tabs[tabs.length - 1].key);
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          id={`tab-${t.key}`}
          aria-selected={value === t.key}
          aria-controls={`panel-${t.key}`}
          tabIndex={value === t.key ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {typeof t.count === 'number' && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  tabKey,
  active,
  children,
}: {
  tabKey: string;
  active: string;
  children: ReactNode;
}) {
  if (tabKey !== active) return null;
  return (
    <div role="tabpanel" id={`panel-${tabKey}`} aria-labelledby={`tab-${tabKey}`} tabIndex={0}>
      {children}
    </div>
  );
}

/* ── Consequence preview (X08) ─────────────────────────────── */

export function ConsequencePreview({
  rows,
  note,
}: {
  rows: {
    label: string;
    before: ReactNode;
    after: ReactNode;
    delta?: { text: string; positive: boolean };
  }[];
  note?: ReactNode;
}) {
  return (
    <div className="preview">
      {rows.map((r) => (
        <div className="preview-row" key={r.label}>
          <span className="muted">{r.label}</span>
          <span className="row gap2 mono">
            <span className="muted">{r.before}</span>
            <span aria-hidden>→</span>
            <strong>{r.after}</strong>
            {r.delta && (
              <span className={clsx('delta', r.delta.positive ? 'pos' : 'neg')}>
                {r.delta.text}
              </span>
            )}
          </span>
        </div>
      ))}
      {note && <p style={{ fontSize: 'var(--fs-xs)' }}>{note}</p>}
    </div>
  );
}

/* ── Timeline ──────────────────────────────────────────────── */

export function Timeline({
  items,
}: {
  items: {
    id: string;
    title: ReactNode;
    caption: ReactNode;
    detail?: ReactNode;
    tone?: 'brand' | 'success' | 'warning' | 'danger';
  }[];
}) {
  return (
    <div className="timeline">
      {items.map((it) => (
        <div className="tl-item" key={it.id}>
          <span className={clsx('tl-dot', it.tone)} aria-hidden />
          <div className="tl-body">
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{it.caption}</div>
            <div style={{ fontWeight: 600 }}>{it.title}</div>
            {it.detail && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                {it.detail}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
