/**
 * A tiny observable store over one immutable-by-convention state object.
 *
 * Components subscribe with `useStore(selector)` and re-render only when the
 * selected slice changes — no global re-render on every mutation.
 */
import { useSyncExternalStore } from 'react';
import type { BootstrapPayload } from '@/lib/api';
import { createInitialState, type AppState } from './state';

type Listener = () => void;

let state: AppState = createInitialState();
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(mutator: (draft: AppState) => void): void {
  const next: AppState = { ...state };
  mutator(next);
  next.seq = state.seq + 1;
  state = next;
  for (const l of listeners) l();
}

export function resetState(): void {
  state = createInitialState();
  for (const l of listeners) l();
}

/** Replace local demo records with the server-authorized snapshot in one render. */
export function hydrateFromServer(payload: BootstrapPayload): void {
  setState((draft) => {
    const user = payload.session.user;
    const priorPayrun = draft.payruns.find((item) => item.id === draft.activePayrunId);
    const recordKeys = [
      'departments',
      'jobPositions',
      'schedules',
      'holidays',
      'leaveTypes',
      'employees',
      'contracts',
      'attendance',
      'leaveAllocations',
      'leaveRequests',
      'decisionReceipts',
      'payslips',
      'documents',
      'audit',
    ] as const;

    for (const key of recordKeys) {
      const value = payload[key];
      if (value) draft[key] = value as never;
    }

    draft.users = [user];
    draft.currentUserId = user.id;
    draft.counts = payload.counts ?? null;
    draft.attendanceSummary = payload.attendanceSummary ?? null;

    if (payload.payruns?.length) {
      draft.payruns = payload.payruns;
      draft.activePayrunId = payload.payruns.at(-1)!.id;
    } else if (priorPayrun) {
      draft.payruns = [
        {
          ...priorPayrun,
          status: 'DRAFT',
          isFrozen: false,
          frozenAt: null,
          computedAt: null,
          validatedAt: null,
          paidAt: null,
          inputSnapshotHash: null,
          employeeIds: user.employeeId ? [user.employeeId] : [],
        },
      ];
      draft.activePayrunId = priorPayrun.id;
    }
  });
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const identity = (value: AppState): AppState => value;

export function useStore(): AppState;
export function useStore<T>(selector: (s: AppState) => T): T;
export function useStore<T = AppState>(selector?: (s: AppState) => T): T | AppState {
  const select = selector ?? identity;
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(state),
  );
}

/** Stable id generator — deterministic within a session, no Math.random. */
export function nextId(prefix: string): string {
  state.seq += 1;
  return `${prefix}-${state.seq}`;
}
