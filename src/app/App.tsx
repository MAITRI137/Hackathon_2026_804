import { useCallback, useEffect, useState } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { OverlayProvider, SidecarProvider } from '@/ui/overlays';
import { ToastProvider, useToast } from '@/ui/toast';
import { ApiError } from '@/lib/api';
import { computeActivePayrun } from '@/store/actions';
import { refreshBootstrap, restoreSession, type BootstrapPayload } from '@/lib/api';
import { hydrateFromServer } from '@/store/store';
import { AppActionsProvider, useAppActions } from './actions-context';
import { Shell } from './Shell';
import { RequirePermission } from './Page';
import { AddEmployeeDialog } from '@/features/employees/AddEmployeeDialog';
import { RequestLeaveDialog } from '@/features/timeoff/RequestLeaveDialog';

import { HomePage } from '@/features/home/HomePage';
import { EmployeesPage } from '@/features/employees/EmployeesPage';
import { EmployeeDetailPage } from '@/features/employees/EmployeeDetailPage';
import { ContractsPage } from '@/features/contracts/ContractsPage';
import { SchedulesPage } from '@/features/schedules/SchedulesPage';
import { AttendancePage } from '@/features/attendance/AttendancePage';
import { TimeOffPage } from '@/features/timeoff/TimeOffPage';
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage';
import { PayrollPage } from '@/features/payroll/PayrollPage';
import { ExceptionsPage } from '@/features/payroll/ExceptionsPage';
import { DeliveryPage } from '@/features/payroll/DeliveryPage';
import { PayslipsPage } from '@/features/payslips/PayslipsPage';
import { PayslipDocumentPage } from '@/features/payslips/PayslipDocumentPage';
import { SalaryConfigPage } from '@/features/salary/SalaryConfigPage';
import { SimulationPage } from '@/features/simulation/SimulationPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { DocumentsPage } from '@/features/documents/DocumentsPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { UsersPage } from '@/features/settings/UsersPage';
import { OpsPage } from '@/features/ops/OpsPage';
import { NotFoundPage } from '@/features/home/NotFoundPage';
import { LoginPage } from '@/features/auth/LoginPage';

/** Global dialogs the launcher and every screen can open. */
function GlobalDialogs() {
  const { active, close } = useAppActions();
  return (
    <>
      <AddEmployeeDialog open={active === 'new-employee'} onClose={close} />
      <RequestLeaveDialog open={active === 'request-leave'} onClose={close} />
    </>
  );
}

function ShellWithActions() {
  const toast = useToast();
  const onCompute = useCallback(() => {
    toast.result(computeActivePayrun());
  }, [toast]);

  return (
    <AppActionsProvider onCompute={onCompute}>
      <Shell />
      <GlobalDialogs />
    </AppActionsProvider>
  );
}

const router = createHashRouter([
  {
    path: '/',
    element: <ShellWithActions />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'employees',
        element: (
          <RequirePermission permission="employee.read.all">
            <EmployeesPage />
          </RequirePermission>
        ),
      },
      { path: 'employees/:id', element: <EmployeeDetailPage /> },
      { path: 'contracts', element: <ContractsPage /> },
      {
        path: 'schedules',
        element: (
          <RequirePermission permission="schedule.read">
            <SchedulesPage />
          </RequirePermission>
        ),
      },
      { path: 'attendance', element: <AttendancePage /> },
      { path: 'timeoff', element: <TimeOffPage /> },
      {
        path: 'approvals',
        element: (
          <RequirePermission permission="approval.read">
            <ApprovalsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'payroll',
        element: (
          <RequirePermission permission="payrun.read">
            <PayrollPage />
          </RequirePermission>
        ),
      },
      {
        path: 'payroll/exceptions',
        element: (
          <RequirePermission permission="payrun.read">
            <ExceptionsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'payroll/delivery',
        element: (
          <RequirePermission permission="payslip.send">
            <DeliveryPage />
          </RequirePermission>
        ),
      },
      { path: 'payslips', element: <PayslipsPage /> },
      { path: 'payslips/:id', element: <PayslipDocumentPage /> },
      {
        path: 'salary',
        element: (
          <RequirePermission permission="salary.structure.read">
            <SalaryConfigPage />
          </RequirePermission>
        ),
      },
      {
        path: 'simulation',
        element: (
          <RequirePermission permission="simulation.run">
            <SimulationPage />
          </RequirePermission>
        ),
      },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'documents', element: <DocumentsPage /> },
      {
        path: 'audit',
        element: (
          <RequirePermission permission="audit.read">
            <AuditPage />
          </RequirePermission>
        ),
      },
      {
        path: 'settings',
        element: (
          <RequirePermission permission="admin.settings">
            <SettingsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'users',
        element: (
          <RequirePermission permission="admin.users">
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'ops',
        element: (
          <RequirePermission permission="ops.dashboard">
            <OpsPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

/**
 * Keeps this browser in step with everyone else.
 *
 * The server publishes only change metadata over server-sent events — a type,
 * an entity id, the employees it touched. It never publishes salary, bank or
 * document content, because a subscriber list is a poor place to enforce
 * permissions. On an event this client refetches its own scoped snapshot, so
 * what it ends up showing is exactly what it is allowed to see.
 *
 * A refetch also runs on window focus and on reconnect: if the stream drops,
 * a missed message must not leave stale numbers on screen. And an update
 * caused by someone else says so, quietly, rather than silently changing the
 * figures a person is looking at.
 */
function LiveSync({ onSessionLost }: { onSessionLost: () => void }) {
  const toast = useToast();

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let queued = false;

    const pull = (announce: boolean) => {
      if (inFlight) {
        queued = queued || announce;
        return;
      }
      inFlight = true;
      void refreshBootstrap()
        .then((payload) => {
          if (!active) return;
          hydrateFromServer(payload);
          if (announce) toast.show('Updated just now — another user changed this data.', 'info');
        })
        .catch((error: unknown) => {
          if (!active) return;
          // Only a lost session sends the person back to sign-in; a transient
          // network failure leaves the last known snapshot on screen.
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            onSessionLost();
          }
        })
        .finally(() => {
          inFlight = false;
          if (queued) {
            queued = false;
            pull(true);
          }
        });
    };

    const onDomainEvent = () => pull(true);
    const onRefocus = () => pull(false);

    const events = new EventSource('/api/events');
    events.addEventListener('domain', onDomainEvent);
    window.addEventListener('focus', onRefocus);
    window.addEventListener('online', onRefocus);
    return () => {
      active = false;
      events.close();
      window.removeEventListener('focus', onRefocus);
      window.removeEventListener('online', onRefocus);
    };
  }, [toast, onSessionLost]);

  return null;
}

export function App() {
  const [phase, setPhase] = useState<'checking' | 'signed-out' | 'ready'>('checking');

  const enter = useCallback((payload: BootstrapPayload) => {
    hydrateFromServer(payload);
    setPhase('ready');
  }, []);

  // Resume an existing server session on load. There is no automatic sign-in:
  // without a valid session cookie the app shows the sign-in screen.
  useEffect(() => {
    let active = true;
    void restoreSession()
      .then((payload) => {
        if (active) enter(payload);
      })
      .catch(() => {
        if (active) setPhase('signed-out');
      });
    return () => {
      active = false;
    };
  }, [enter]);

  if (phase === 'checking') {
    return (
      <div className="boot" role="status" aria-live="polite">
        <span className="brand-mark" aria-hidden>
          P
        </span>
        <p>Restoring your session…</p>
      </div>
    );
  }

  if (phase === 'signed-out') {
    return <LoginPage onSignedIn={enter} />;
  }

  return (
    <OverlayProvider>
      <ToastProvider>
        <SidecarProvider>
          <LiveSync onSessionLost={() => setPhase('signed-out')} />
          <RouterProvider router={router} />
        </SidecarProvider>
      </ToastProvider>
    </OverlayProvider>
  );
}
