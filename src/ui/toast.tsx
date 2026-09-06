/**
 * Toasts confirm a completed mutation. A toast is never the mutation itself.
 * Undo is offered only where the action is genuinely reversible (X06).
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Info, XCircle } from 'lucide-react';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';

interface CommandResult {
  ok: boolean;
  message?: string;
  error?: string;
  recovery?: string;
}

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  undo?: () => void;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind, undo?: () => void) => void;
  success: (message: string, undo?: () => void) => void;
  error: (message: string) => void;
  /**
   * Convenience for command results: shows the right tone automatically.
   *
   * Commands are server round trips, so this accepts the promise directly and
   * every call site stays a one-liner. A rejected promise is still reported —
   * silence after a click is the one outcome a control must never have.
   */
  result: (r: CommandResult | Promise<CommandResult>, undo?: () => void) => void;
}

const Ctx = createContext<ToastApi | null>(null);

const ICON = { info: Info, success: Check, error: XCircle, warning: AlertTriangle } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    (message, kind = 'info', undo) => {
      if (!message) return;
      seq.current += 1;
      const id = seq.current;
      setItems((cur) => [...cur.slice(-3), { id, kind, message, undo }]);
      window.setTimeout(() => dismiss(id), undo ? 7000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m, undo) => show(m, 'success', undo),
      error: (m) => show(m, 'error'),
      result: (r, undo) => {
        void Promise.resolve(r)
          .then((value) =>
            value.ok
              ? show(value.message ?? 'Done', 'success', undo)
              : show(
                  value.recovery ? `${value.error} ${value.recovery}` : (value.error ?? 'Something went wrong'),
                  'error',
                ),
          )
          .catch(() => show('The server could not be reached. Nothing was changed.', 'error'));
      },
    }),
    [show],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {items.map((t) => {
            const Icon = ICON[t.kind];
            return (
              <div className="toast" data-kind={t.kind} key={t.id}>
                <Icon size={16} aria-hidden />
                <span className="grow">{t.message}</span>
                {t.undo && (
                  <button
                    type="button"
                    className="undo"
                    onClick={() => {
                      t.undo?.();
                      dismiss(t.id);
                    }}
                  >
                    Undo
                  </button>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
