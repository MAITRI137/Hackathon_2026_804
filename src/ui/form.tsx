import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle, Check, ChevronDown, Search, X } from 'lucide-react';
import clsx from 'clsx';

/* ── Field wrapper ─────────────────────────────────────────── */

export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-l" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="req" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <span className="field-err" role="alert">
          <AlertCircle size={12} aria-hidden />
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

/* ── Text input ────────────────────────────────────────────── */

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
  money?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, error, hint, money, required, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const input = (
    <input
      ref={ref}
      id={inputId}
      className={clsx('input', money && 'money', className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${inputId}-err` : undefined}
      required={required}
      {...rest}
    />
  );
  if (!label) return input;
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={inputId}>
      {input}
    </Field>
  );
});

/** Money input — decimal keypad on touch, tabular alignment, right-aligned. */
export const MoneyInput = forwardRef<HTMLInputElement, TextInputProps>(
  function MoneyInput(props, ref) {
    return (
      <TextInput
        ref={ref}
        money
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        {...props}
      />
    );
  },
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label?: ReactNode;
    error?: string;
    hint?: ReactNode;
  }
>(function TextArea({ label, error, hint, required, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  const el = (
    <textarea
      ref={ref}
      id={inputId}
      className="textarea"
      aria-invalid={error ? true : undefined}
      required={required}
      {...rest}
    />
  );
  if (!label) return el;
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={inputId}>
      {el}
    </Field>
  );
});

/* ── Select ────────────────────────────────────────────────── */
/* Native <select> for semantics and keyboard; custom chrome around it. */

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
  size2?: 'md' | 'sm';
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, required, options, placeholder, children, id, size2 = 'md', ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const control = (
    <div className={clsx('select-wrap', size2 === 'sm' && 'sm')}>
      <select
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        required={required}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <span className="select-caret" aria-hidden>
        <ChevronDown size={15} />
      </span>
    </div>
  );
  if (!label) return control;
  return (
    <Field label={label} required={required} hint={hint} error={error} htmlFor={inputId}>
      {control}
    </Field>
  );
});

/* ── Checkbox / radio / switch ─────────────────────────────── */

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate && !checked);
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="box" aria-hidden>
        <Check size={12} strokeWidth={3} />
      </span>
      {label}
    </label>
  );
}

export function Radio({
  name,
  value,
  checked,
  onChange,
  label,
  disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="check radio">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span className="box" aria-hidden />
      {label}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label className="switch" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="track" aria-hidden />
      {label}
    </label>
  );
}

/* ── Search box ────────────────────────────────────────────── */

export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="searchbox">
      <Search size={15} aria-hidden />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search">
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ── Segmented control ─────────────────────────────────────── */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ComponentType<{ size?: number }> }[];
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {Icon && <Icon size={14} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
