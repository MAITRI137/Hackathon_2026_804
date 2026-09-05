/**
 * One overlay manager owns the whole stack: launcher, modal, drawer, sidecar,
 * notifications, dropdown, mobile navigation.
 *
 * Escape closes exactly ONE layer — the topmost — and returns focus to the
 * control that opened it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './primitives';

type LayerKind = 'launcher' | 'modal' | 'drawer' | 'sidecar' | 'menu' | 'nav';

interface Layer {
  id: string;
  kind: LayerKind;
  close: () => void;
}

interface OverlayApi {
  push: (layer: Layer) => void;
  pop: (id: string) => void;
  top: () => Layer | undefined;
  has: (kind: LayerKind) => boolean;
}

const OverlayCtx = createContext<OverlayApi | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const stack = useRef<Layer[]>([]);
  const [, force] = useState(0);

  const api = useMemo<OverlayApi>(
    () => ({
      push: (layer) => {
        stack.current = [...stack.current.filter((l) => l.id !== layer.id), layer];
        force((n) => n + 1);
      },
      pop: (id) => {
        stack.current = stack.current.filter((l) => l.id !== id);
        force((n) => n + 1);
      },
      top: () => stack.current[stack.current.length - 1],
      has: (kind) => stack.current.some((l) => l.kind === kind),
    }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const top = stack.current[stack.current.length - 1];
      if (!top) return;
      e.stopPropagation();
      e.preventDefault();
      top.close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return <OverlayCtx.Provider value={api}>{children}</OverlayCtx.Provider>;
}

export function useOverlayStack(): OverlayApi {
  const ctx = useContext(OverlayCtx);
  if (!ctx) throw new Error('useOverlayStack must be used inside OverlayProvider');
  return ctx;
}

/** Registers a layer while `open`, and restores focus to the trigger on close. */
export function useLayer(kind: LayerKind, open: boolean, close: () => void) {
  const stack = useOverlayStack();
  const id = useId();
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    trigger.current = document.activeElement as HTMLElement | null;
    stack.push({ id, kind, close });
    return () => {
      stack.pop(id);
      const el = trigger.current;
      if (el && document.contains(el)) {
        window.requestAnimationFrame(() => el.focus({ preventScroll: true }));
      }
    };
    // `close` is intentionally excluded — layers are keyed by id, not identity.
  }, [open, id, kind]);
}

/** Traps Tab inside the container while it is mounted. */
export function useFocusTrap(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !ref.current) return;
    const root = ref.current;
    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const first = focusables()[0];
    window.requestAnimationFrame(() => first?.focus({ preventScroll: true }));

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [open]);

  return ref;
}

/** Locks background scroll and preserves the scroll position. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

/* ── Modal ─────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  footer,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  useLayer('modal', open, onClose);
  useScrollLock(open);
  const ref = useFocusTrap(open);
  const titleId = useId();
  if (!open) return null;

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div className="modal-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div
          className={wide ? 'modal wide' : 'modal'}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          ref={ref}
        >
          <header className="modal-h">
            <div className="row between">
              <div>
                {eyebrow && <div className="eyebrow">{eyebrow}</div>}
                <h3 id={titleId}>{title}</h3>
              </div>
              <Button variant="ghost" iconOnly icon={X} onClick={onClose} aria-label="Close dialog" />
            </div>
          </header>
          <div className="modal-b">{children}</div>
          {footer && <footer className="modal-f">{footer}</footer>}
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ── Drawer ────────────────────────────────────────────────── */

export function Drawer({
  open,
  onClose,
  title,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useLayer('drawer', open, onClose);
  useScrollLock(open);
  const ref = useFocusTrap(open);
  const titleId = useId();
  if (!open) return null;

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div className="drawer-layer">
        <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
          <header className="drawer-h">
            <h3 id={titleId}>{title}</h3>
            <Button variant="ghost" iconOnly icon={X} onClick={onClose} aria-label="Close panel" />
          </header>
          <div className="drawer-b">{children}</div>
          {footer && <footer className="drawer-f">{footer}</footer>}
        </aside>
      </div>
    </>,
    document.body,
  );
}

/* ── Confirm with consequence preview ──────────────────────── */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  variant = 'primary',
  pending,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  confirmLabel: string;
  variant?: 'primary' | 'danger' | 'success';
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={variant} onClick={onConfirm} pending={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/* ── Sidecar (X02) ─────────────────────────────────────────── */

export interface SidecarState {
  title: string;
  content: ReactNode;
}

const SidecarCtx = createContext<{
  open: (state: SidecarState) => void;
  close: () => void;
  state: SidecarState | null;
} | null>(null);

export function SidecarProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SidecarState | null>(null);
  const close = useCallback(() => setState(null), []);
  const value = useMemo(() => ({ open: setState, close, state }), [state, close]);
  return <SidecarCtx.Provider value={value}>{children}</SidecarCtx.Provider>;
}

export function useSidecar() {
  const ctx = useContext(SidecarCtx);
  if (!ctx) throw new Error('useSidecar must be used inside SidecarProvider');
  return ctx;
}

export function SidecarHost() {
  const { state, close } = useSidecar();
  useLayer('sidecar', Boolean(state), close);
  const titleId = useId();
  const isNarrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 1099px)').matches;
  if (!state) return null;

  const panel = (
    <aside className="sidecar" role="dialog" aria-labelledby={titleId} aria-modal={isNarrow || undefined}>
      <header className="sidecar-h">
        <h3 id={titleId}>{state.title}</h3>
        <Button variant="ghost" iconOnly icon={X} onClick={close} aria-label="Close details" />
      </header>
      <div className="sidecar-b">{state.content}</div>
    </aside>
  );

  // On tablet and phone the sidecar overlays; it must never shift the workspace.
  if (isNarrow) {
    return createPortal(
      <>
        <div className="scrim" onClick={close} aria-hidden />
        {panel}
      </>,
      document.body,
    );
  }
  return panel;
}
