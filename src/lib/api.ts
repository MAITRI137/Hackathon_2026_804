import type { Attendance, Role } from '@shared/types';

import type { AppState } from '@/store/state';

export const DEMO_PASSWORD = 'PeoplePay360!2026';
export const ROLE_EMAIL: Record<Role, string> = {
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
  counts?: AppState['counts'];
  attendanceSummary?: AppState['attendanceSummary'];
}

/** Measured operations telemetry. Every field comes from a real observation. */
export interface OpsMetrics {
  capturedAt: string;
  database: {
    online: boolean;
    roundTripMs: number;
    totalRecords: number;
    tables: { table: string; rows: number }[];
  };
  process: {
    uptimeSeconds: number;
    heapUsedMb: number;
    heapTotalMb: number;
    nodeVersion: string;
  };
  uptimeSeconds: number;
  requests: { total: number; errors: number; perSecond: number; series: number[] };
  reads: { total: number; series: number[] };
  latency: { p50: number; p95: number; p99: number };
  queryActivity: { queries: number; averageMs: number };
  routes: { route: string; count: number; errors: number; averageMs: number; maxMs: number }[];
}

export interface PayrollDecisionCommand {
  payrunId: string;
  status: 'DRAFT' | 'COMPUTED' | 'VALIDATED' | 'PAID';
  snapshotHash: string;
  readinessScore: number;
  blockingExceptionCount: number;
  employeeCount: number;
  netTotal: string;
}

export interface ReadinessScan {
  totalRecords: number;
  payrunsScanned: number;
  employeesScanned: number;
  readyPayruns: number;
  blockingExceptions: number;
  durationMs: number;
  scannedAt: string;
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

/** Sign in with real credentials, then load the caller's authorised snapshot. */
export async function signIn(email: string, password: string): Promise<BootstrapPayload> {
  await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  return api<BootstrapPayload>('/bootstrap');
}

/** Resume an existing server session, or reject if there is none. */
export async function restoreSession(): Promise<BootstrapPayload> {
  await api('/auth/me');
  return api<BootstrapPayload>('/bootstrap');
}

/** Fetch a fresh server-authorised snapshot after a state-changing command. */
export function refreshBootstrap(): Promise<BootstrapPayload> {
  return api<BootstrapPayload>('/bootstrap');
}

export async function connectDemoRole(role: Role): Promise<BootstrapPayload> {
  await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ROLE_EMAIL[role], password: DEMO_PASSWORD }),
  });
  return api<BootstrapPayload>('/bootstrap');
}

export function fetchOpsMetrics(): Promise<OpsMetrics> {
  return api<OpsMetrics>('/ops/metrics');
}

export function computePayrun(payrunId: string): Promise<PayrollDecisionCommand> {
  return api<PayrollDecisionCommand>(`/payruns/${payrunId}/compute`, { method: 'POST' });
}

export function validatePayrun(payrunId: string): Promise<{ receipt: AppState['decisionReceipts'][number] }> {
  return api(`/payruns/${payrunId}/validate`, { method: 'POST' });
}

export function markPayrunPaid(payrunId: string): Promise<{ receipt: AppState['decisionReceipts'][number] }> {
  return api(`/payruns/${payrunId}/mark-paid`, { method: 'POST' });
}

export function resolvePayrunBank(
  payrunId: string,
  input: { employeeId: string; accountName: string; accountNumber: string; ifsc: string; bankName: string },
): Promise<{ payrunId: string; employeeId: string; resolved: string }> {
  return api(`/payruns/${payrunId}/blockers/bank/resolve`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function resolvePayrunAttendance(
  payrunId: string,
  input: { attendanceId: string; checkOut: string; reason: string },
): Promise<{ payrunId: string; attendanceId: string; resolved: string }> {
  return api(`/payruns/${payrunId}/blockers/attendance/resolve`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function attendanceCheckIn(): Promise<Attendance> {
  return api<Attendance>('/attendance/check-in', { method: 'POST' });
}

export function attendanceCheckOut(): Promise<Attendance> {
  return api<Attendance>('/attendance/check-out', { method: 'POST' });
}

export function correctAttendanceRecord(
  attendanceId: string,
  input: { checkIn: string | null; checkOut: string | null; reason: string; version: number },
): Promise<Attendance> {
  return api<Attendance>(`/attendance/${attendanceId}/correction`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function regularizeAttendance(
  records: { id: string; checkOut: string; reason: string; version: number }[],
): Promise<{ recordIds: string[] }> {
  return api('/attendance/regularizations', { method: 'POST', body: JSON.stringify({ records }) });
}

export function runReadinessScan(): Promise<ReadinessScan> {
  return api<ReadinessScan>('/ops/readiness-scan', { method: 'POST' });
}

export function signOut() {
  return api<void>('/auth/logout', { method: 'POST' });
}
