/**
 * Global quick actions, so the command launcher and any screen can open the
 * same dialog without prop-drilling. The dialogs themselves live in App.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type GlobalAction = 'new-employee' | 'request-leave' | 'compute';

interface Api {
  active: GlobalAction | null;
  run: (a: GlobalAction) => void;
  close: () => void;
}

const Ctx = createContext<Api | null>(null);

export function AppActionsProvider({
  children,
  onCompute,
}: {
  children: ReactNode;
  onCompute: () => void;
}) {
  const [active, setActive] = useState<GlobalAction | null>(null);

  const api = useMemo<Api>(
    () => ({
      active,
      run: (a) => {
        if (a === 'compute') onCompute();
        else setActive(a);
      },
      close: () => setActive(null),
    }),
    [active, onCompute],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAppActions(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppActions must be used inside AppActionsProvider');
  return ctx;
}
