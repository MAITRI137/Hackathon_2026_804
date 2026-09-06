/**
 * The only way the browser changes anything.
 *
 * Every function here is one authenticated server command. The browser holds
 * no business state of its own: it sends a command, the server validates it,
 * runs it in a transaction, writes the audit row and publishes an event, and
 * the client then reloads its own permission-scoped snapshot. There is no
 * local fallback that quietly mutates a store when a request fails — a failed
 * command has to look failed.
 */
import type { Attendance, Role } from '@shared/types';

import type { AppState, StoredNotification } from '@/store/state';

/**
 * Demo sign-in shortcuts.
 *
 * These exist only for the demo build. `import.meta.env.DEV` is false in a
 * production bundle, so the persona buttons and the shared password are
 * compiled out rather than shipped behind a hidden flag.
 */
export const DEMO_MODE = import.meta.env.DEV;
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
  error?: {
    code?: string;
    message?: string;
    recovery?: string;
    details?: { currentVersion?: number };
  };
}

export interface BootstrapPayload extends Partial<AppState> {
  session: { user: AppState['users'][number] };
  counts?: AppState['counts'];
  attendanceSummary?: AppState['attendanceSummary'];
  manageableUsers?: AppState['users'];
  demoPayments?: AppState['demoPayments'];
  notifications?: StoredNotification[];
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

export interface PayrollComputeResult {
  payrunId: string;
  status: 'DRAFT' | 'COMPUTED' | 'VALIDATED' | 'PAID';
  version: number;
  snapshotHash: string;
  readinessScore: number;
  blockingExceptionCount: number;
  employeeCount: number;
  memberCount: number;
  payslipCount: number;
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
    public readonly recovery?: string,
    /** For a 409, the version the server currently holds. */
    public readonly currentVersion?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the write lost a race and the client must reload before retrying. */
  get isConflict() {
    return this.status === 409;
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
      body.error?.recovery,
      body.error?.details?.currentVersion,
    );
  }

  if (response.status === 204) return undefined as T;
  return ((await response.json()) as ApiEnvelope<T>).data;
}

const send = <T>(path: string, body?: unknown, method = 'POST', idempotencyKey?: string) =>
  api<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });

/**
 * A key that makes one user action idempotent.
 *
 * The same command with the same key runs once however many times it is sent,
 * which is what stops an impatient second click from paying payroll twice.
 */
export const commandKey = (scope: string) =>
  `${scope}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ── session ─────────────────────────────────────────────────────────────── */

export async function signIn(email: string, password: string): Promise<BootstrapPayload> {
  await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  return api<BootstrapPayload>('/bootstrap');
}

export async function restoreSession(): Promise<BootstrapPayload> {
  await api('/auth/me');
  return api<BootstrapPayload>('/bootstrap');
}

/** Reload the caller's authorised snapshot after a command or a live event. */
export function refreshBootstrap(): Promise<BootstrapPayload> {
  return api<BootstrapPayload>('/bootstrap');
}

export async function connectDemoRole(role: Role): Promise<BootstrapPayload> {
  if (!DEMO_MODE) throw new ApiError('Demo sign-in is disabled in this build.', 403, 'DEMO_DISABLED');
  await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: ROLE_EMAIL[role], password: DEMO_PASSWORD }),
  });
  return api<BootstrapPayload>('/bootstrap');
}

export function signOut() {
  return api<void>('/auth/logout', { method: 'POST' });
}

/* ── operations ──────────────────────────────────────────────────────────── */

export const fetchOpsMetrics = () => api<OpsMetrics>('/ops/metrics');
export const runReadinessScan = () => send<ReadinessScan>('/ops/readiness-scan');

/* ── payroll ─────────────────────────────────────────────────────────────── */

export const createPayrun = (input: { periodStart: string; salaryStructureId: string; includeAllActive?: boolean }) =>
  send<{ id: string }>('/payruns', input);

export const clonePayrun = (payrunId: string) => send<{ id: string }>(`/payruns/${payrunId}/clone`);

export const setPayrunMembership = (payrunId: string, input: { employeeIds: string[]; include: boolean; reason?: string }) =>
  send<{ changed: number }>(`/payruns/${payrunId}/membership`, input);

export const setPayrunFrozen = (payrunId: string, frozen: boolean, reason: string) =>
  send(`/payruns/${payrunId}/freeze`, { frozen, reason });

export const reopenPayrun = (payrunId: string, reason: string, version: number) =>
  send(`/payruns/${payrunId}/reopen`, { reason, version });

export const computePayrun = (payrunId: string) =>
  send<PayrollComputeResult>(`/payruns/${payrunId}/compute`, {}, 'POST', commandKey(`compute-${payrunId}`));

export const validatePayrun = (payrunId: string) =>
  send<{ receipt: AppState['decisionReceipts'][number] }>(
    `/payruns/${payrunId}/validate`,
    {},
    'POST',
    commandKey(`validate-${payrunId}`),
  );

export const markPayrunPaid = (payrunId: string) =>
  send<{ receipt: AppState['decisionReceipts'][number] }>(
    `/payruns/${payrunId}/mark-paid`,
    {},
    'POST',
    commandKey(`pay-${payrunId}`),
  );

export const resolvePayrunBank = (
  payrunId: string,
  input: { employeeId: string; accountName: string; accountNumber: string; ifsc: string; bankName: string },
) => send(`/payruns/${payrunId}/blockers/bank/resolve`, input);

export const resolvePayrunAttendance = (
  payrunId: string,
  input: { attendanceId: string; checkOut: string; reason: string },
) => send(`/payruns/${payrunId}/blockers/attendance/resolve`, input);

/* ── attendance ──────────────────────────────────────────────────────────── */

export const attendanceCheckIn = () => send<Attendance>('/attendance/check-in');
export const attendanceCheckOut = () => send<Attendance>('/attendance/check-out');

export const correctAttendanceRecord = (
  attendanceId: string,
  input: { checkIn: string | null; checkOut: string | null; reason: string; version: number },
) => send<Attendance>(`/attendance/${attendanceId}/correction`, input, 'PATCH');

export const regularizeAttendance = (records: { id: string; checkOut: string; reason: string; version: number }[]) =>
  send<{ recordIds: string[] }>('/attendance/regularizations', { records });

/* ── leave ───────────────────────────────────────────────────────────────── */

export const requestLeave = (input: {
  employeeId?: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  reason: string;
}) => send('/leave-requests', input);

export const approveLeave = (id: string, note = '') => send(`/leave-requests/${id}/approve`, { note });
export const refuseLeave = (id: string, note: string) => send(`/leave-requests/${id}/refuse`, { note });
export const cancelLeaveRequest = (id: string) => send(`/leave-requests/${id}/cancel`);

export const grantLeaveAllocation = (input: {
  employeeIds: string[];
  leaveTypeId: string;
  days: number;
  validFrom: string;
  validTo: string;
}) => send<{ granted: number }>('/leave-allocations/grant', input);

/* ── people ──────────────────────────────────────────────────────────────── */

export const createEmployee = (input: Record<string, unknown>) => send<{ id: string; fullName: string }>('/employees', input);

export const updateEmployee = (id: string, input: Record<string, unknown>) =>
  send(`/employees/${id}`, input, 'PATCH');

export const archiveEmployee = (id: string, reason: string, version: number) =>
  send(`/employees/${id}/archive`, { reason, version });

export const restoreEmployee = (id: string, status: string, version: number) =>
  send(`/employees/${id}/restore`, { status, version });

export const moveEmployeeDepartment = (id: string, departmentId: string, version: number) =>
  send(`/employees/${id}/move-department`, { departmentId, version });

export const batchAssignSchedule = (employeeIds: string[], workingScheduleId: string, reason: string) =>
  send<{ updated: number }>('/employees/batch/schedule', { employeeIds, workingScheduleId, reason });

export const batchAssignStructure = (employeeIds: string[], salaryStructureId: string, reason: string) =>
  send<{ updated: number }>('/employees/batch/salary-structure', { employeeIds, salaryStructureId, reason });

/* ── contracts ───────────────────────────────────────────────────────────── */

export const createContract = (input: Record<string, unknown>) => send<{ id: string }>('/contracts', input);

export const updateContract = (id: string, input: Record<string, unknown>) =>
  send(`/contracts/${id}`, input, 'PATCH');

export const terminateContract = (id: string, endDate: string, reason: string, version: number) =>
  send(`/contracts/${id}/terminate`, { endDate, reason, version });

/* ── salary configuration ────────────────────────────────────────────────── */

export const createSalaryRule = (input: Record<string, unknown>) => send<{ id: string }>('/salary-rules', input);

export const updateSalaryRule = (id: string, input: Record<string, unknown>) =>
  send(`/salary-rules/${id}`, input, 'PATCH');

export const versionSalaryRule = (id: string, effectiveFrom: string, reason: string) =>
  send(`/salary-rules/${id}/version`, { effectiveFrom, reason });

/* ── change requests ─────────────────────────────────────────────────────── */

export const requestProfileChange = (input: { field: string; proposedValue: string; reason: string; employeeId?: string }) =>
  send('/change-requests/profile', input);

export const decideProfileChange = (id: string, decision: 'APPROVED' | 'REFUSED', note: string, version: number) =>
  send(`/change-requests/profile/${id}/decide`, { decision, note, version });

export const requestSalaryChange = (input: {
  employeeId: string;
  proposedWage: string;
  effectiveFrom: string;
  reason: string;
}) => send('/change-requests/salary', input);

export const decideSalaryChange = (id: string, decision: 'APPROVED' | 'REFUSED', note: string, version: number) =>
  send(`/change-requests/salary/${id}/decide`, { decision, note, version });

/* ── simulated integrations ──────────────────────────────────────────────── */

export interface DemoPaymentBatch {
  id: string;
  payrunId: string;
  reference: string;
  status: 'QUEUED' | 'SIMULATED_SUCCESS' | 'SIMULATED_FAILURE';
  totalAmount: string;
  itemCount: number;
  successCount: number;
  failureCount: number;
  createdByName: string;
  createdAt: string;
  simulated: true;
  items: {
    id: string;
    payslipId: string;
    employeeId: string;
    amount: string;
    accountMasked: string;
    status: 'QUEUED' | 'SIMULATED_SUCCESS' | 'SIMULATED_FAILURE';
    failureReason: string | null;
    retryCount: number;
  }[];
}

export const runDemoPayment = (payrunId: string) =>
  send<DemoPaymentBatch>(`/payruns/${payrunId}/demo-payment-run`, {}, 'POST', commandKey(`demo-pay-${payrunId}`));

export const retryDemoPayment = (itemId: string) => send(`/demo-payments/${itemId}/retry`);

export const deliverPayslips = (payrunId: string) =>
  send<{ queued: number; sent: number; failed: number }>(
    `/payruns/${payrunId}/demo-deliver-payslips`,
    {},
    'POST',
    commandKey(`demo-deliver-${payrunId}`),
  );

export const retryDelivery = (messageId: string) => send(`/outbox/${messageId}/retry`);

/* ── documents ───────────────────────────────────────────────────────────── */

export const generateDocument = (input: { kind: string; employeeId?: string; payslipId?: string }) =>
  send<{ id: string; fileName: string }>('/documents/generate', input);

export const acknowledgeDocument = (id: string) => send(`/documents/${id}/acknowledge`);

/** The download URL for a generated document. The server enforces access. */
export const documentDownloadUrl = (id: string) => `/api/documents/${id}/download`;

/* ── administration ──────────────────────────────────────────────────────── */

export const updateUserAccount = (id: string, patch: { role?: Role; isActive?: boolean; reason: string }) =>
  send(`/users/${id}`, patch, 'PATCH');

export const updateSettings = (patch: Partial<AppState['settings']>) => send('/settings', patch, 'PATCH');

export const markNotificationsRead = (ids: string[]) => send<{ updated: number }>('/notifications/read', { ids });
export const dismissNotification = (id: string) => send(`/notifications/${id}/dismiss`);

export const saveView = (input: { view: string; name: string; config: Record<string, string>; isShared?: boolean }) =>
  send('/saved-views', input);

export const deleteSavedView = (id: string) => send<void>(`/saved-views/${id}`, undefined, 'DELETE');
