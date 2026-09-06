/**
 * A tiny observable cache over one immutable-by-convention snapshot.
 *
 * Components subscribe with `useStore(selector)` and re-render only when the
 * selected slice changes. Nothing writes business data into this store except
 * `hydrateFromServer`, which replaces it wholesale with what the server just
 * said — so there is no path by which the browser can believe something the
 * database does not.
 */
import { useSyncExternalStore } from 'react';
import type { BootstrapPayload } from '@/lib/api';
import { createInitialState, DEFAULT_SETTINGS, type AppState } from './state';

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

/** Every collection the server owns. Anything not listed here is view state. */
const SERVER_COLLECTIONS = [
  'departments',
  'jobPositions',
  'schedules',
  'holidays',
  'leaveTypes',
  'salaryStructures',
  'salaryRules',
  'employees',
  'contracts',
  'attendance',
  'leaveAllocations',
  'leaveRequests',
  'decisionReceipts',
  'payslips',
  'documents',
  'checklists',
  'profileChangeRequests',
  'salaryChangeRequests',
  'outbox',
  'audit',
  'savedViews',
] as const;

/**
 * Replace this browser's view of the world with the server snapshot.
 *
 * Called after sign-in, after every command, on window focus, on reconnect and
 * on every realtime event. A collection the caller is not entitled to arrives
 * empty, and it is emptied here too — a role switch must never leave the
 * previous role's rows on screen.
 */
export function hydrateFromServer(payload: BootstrapPayload): void {
  setState((draft) => {
    const user = payload.session.user;

    for (const key of SERVER_COLLECTIONS) {
      draft[key] = (payload[key] ?? []) as never;
    }

    // An administrator manages accounts, so they receive the account list;
    // everybody else receives only themselves, and the store says so.
    draft.users = payload.manageableUsers?.length ? payload.manageableUsers : [user];
    draft.currentUserId = user.id;
    draft.settings = payload.settings ?? { ...DEFAULT_SETTINGS };
    draft.storedNotifications = (payload.notifications ?? []) as never;
    draft.demoPayments = (payload.demoPayments ?? []) as never;
    draft.counts = payload.counts ?? null;
    draft.attendanceSummary = payload.attendanceSummary ?? null;
    draft.payruns = payload.payruns ?? [];

    // Keep looking at the same period across a refresh; fall back to the most
    // recent one the caller can see.
    const stillVisible = draft.payruns.some((payrun) => payrun.id === draft.activePayrunId);
    if (!stillVisible) draft.activePayrunId = draft.payruns.at(-1)?.id ?? '';

    // "Today" is the server's day, not the browser's clock and never a seeded
    // constant: attendance, leave and payroll all measure against it.
    draft.today = new Date().toISOString().slice(0, 10);
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
