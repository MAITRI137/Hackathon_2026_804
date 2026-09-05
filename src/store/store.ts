/**
 * A tiny observable store over one immutable-by-convention state object.
 *
 * Components subscribe with `useStore(selector)` and re-render only when the
 * selected slice changes — no global re-render on every mutation.
 */
import { useSyncExternalStore } from 'react';
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
