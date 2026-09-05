import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

/* ── Button ────────────────────────────────────────────────── */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  /** Disables the control and shows a spinner. Double-click protection is a prop, not a habit. */
  pending?: boolean;
  icon?: LucideIcon;
  iconOnly?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', pending, icon: Icon, iconOnly, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 15 : 16;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={clsx(
        'btn',
        `btn-${variant}`,
        size === 'sm' && 'btn-sm',
        iconOnly && 'btn-icon',
        block && 'btn-block',
        className,
      )}
      {...rest}
    >
      {pending ? (
        <Loader2 size={iconSize} className="spin" aria-hidden />
      ) : Icon ? (
        <Icon size={iconSize} aria-hidden />
      ) : null}
      {!iconOnly && children}
    </button>
  );
});

/* ── Chip ──────────────────────────────────────────────────── */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function Chip({
  tone = 'neutral',
  icon: Icon,
  dot,
  children,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`chip chip-${tone}`}>
      {Icon ? <Icon size={12} aria-hidden /> : dot ? <span className="dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

/* ── Avatar ────────────────────────────────────────────────── */

export function Avatar({
  initials,
  size = 'md',
  tone,
}: {
  initials: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'warning' | 'danger' | 'success';
}) {
  return (
    <span className={clsx('avatar', size !== 'md' && size, tone)} aria-hidden>
      {initials}
    </span>
  );
}

/* ── Card ──────────────────────────────────────────────────── */

export function Card({
  title,
  action,
  subtitle,
  padding = 'normal',
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  padding?: 'normal' | 'tight' | 'flush';
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('card', className)}>
      {(title || action) && (
        <header className="card-h">
          <div style={{ minWidth: 0 }}>
            {title && <h3>{title}</h3>}
            {subtitle && <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{subtitle}</div>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx('card-b', padding === 'tight' && 'tight', padding === 'flush' && 'flush')}>
        {children}
      </div>
    </section>
  );
}

/* ── Banner ────────────────────────────────────────────────── */

export function Banner({
  tone,
  icon: Icon,
  title,
  children,
  action,
}: {
  tone: 'info' | 'warning' | 'danger' | 'success';
  icon: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div className="grow">
        {title && <strong>{title}</strong>}
        {children}
      </div>
      {action}
    </div>
  );
}

/* ── Empty / error / skeleton ──────────────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={20} aria-hidden />
      </span>
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="col gap3" style={{ padding: 'var(--s4)' }} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={18} width={`${100 - i * 6}%`} />
      ))}
    </div>
  );
}

/* ── Info grid ─────────────────────────────────────────────── */

export function InfoGrid({ items }: { items: { label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <div className="info-grid">
      {items.map((it) => (
        <div className="info-item" key={it.label}>
          <label>{it.label}</label>
          <div className={clsx('v', it.mono && 'mono')}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Metric tile ───────────────────────────────────────────── */

export function Metric({
  label,
  value,
  tone,
  sub,
  icon: Icon,
  why,
}: {
  label: string;
  value: ReactNode;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
  sub?: ReactNode;
  icon?: LucideIcon;
  /** An explicit, labelled control. The tile itself is never a hidden link. */
  why?: { onClick: () => void; label: string };
}) {
  return (
    <div className="metric">
      <div className={clsx('metric-v', tone)}>{value}</div>
      <div className="metric-k">
        {Icon && <Icon size={14} aria-hidden />}
        {label}
      </div>
      {sub && <div className="metric-sub">{sub}</div>}
      {why && (
        <span className="metric-why">
          <Button size="sm" variant="ghost" onClick={why.onClick} aria-label={why.label} title={why.label}>
            Why?
          </Button>
        </span>
      )}
    </div>
  );
}

/* ── Section heading ───────────────────────────────────────── */

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="row between" style={{ marginBottom: 'var(--s2)' }}>
      <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 650 }}>{children}</h3>
      {action}
    </div>
  );
}
