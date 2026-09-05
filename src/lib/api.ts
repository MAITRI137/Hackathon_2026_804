import type { Role } from '@shared/types';

import type { AppState } from '@/store/state';

const DEMO_PASSWORD = 'PeoplePay360!2026';
const ROLE_EMAIL: Record<Role, string> = {
  EMPLOYEE: 'aarav.patel@peoplepay360.com',
  HR_MANAGER: 'priya.desai@peoplepay360.com',
  HR_PAYROLL_USER: 'isha.mehta@peoplepay360.com',
  HR_PAYROLL_MANAGER: 'maitri.shah@peoplepay360.com',
  ADMIN: 'admin@peoplepay360.com',
};

interface ApiEnvelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; recovery?: string };
}

export interface BootstrapPayload extends Partial<AppState> {
  session: { user: AppState['users'][number] };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = 'API_ERROR',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    throw new ApiError(
      body.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      body.error?.code,
    );
  }

  if (response.status === 204) return undefined as T;
  return ((await response.json()) as ApiEnvelope<T>).data;
}

export async function connectDemoRole(role: Role): Promise<BootstrapPayload> {
  await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ROLE_EMAIL[role], password: DEMO_PASSWORD }),
  });
  return api<BootstrapPayload>('/bootstrap');
}

export function signOut() {
  return api<void>('/auth/logout', { method: 'POST' });
}
