import { EventEmitter } from 'node:events';

export type RealtimeEventType =
  | 'employee.created'
  | 'employee.updated'
  | 'employee.archived'
  | 'contract.updated'
  | 'attendance.created'
  | 'attendance.updated'
  | 'leave.requested'
  | 'leave.decided'
  | 'leave.allocation.updated'
  | 'payroll.updated'
  | 'payroll.computed'
  | 'payroll.validated'
  | 'payroll.paid'
  | 'payslip.updated'
  | 'document.updated'
  | 'notification.created'
  | 'user.updated'
  | 'settings.updated'
  | 'delivery.updated';

/**
 * Small, replaceable post-commit event boundary. The application is currently
 * a single local instance; production can replace this implementation with a
 * Postgres outbox or Redis adapter without changing routes or services.
 */
class RealtimePublisher {
  private readonly emitter = new EventEmitter();
  private version = 0;

  publish(input: Omit<RealtimeEvent, 'occurredAt' | 'version' | 'organisationId'>) {
    const event: RealtimeEvent = {
      ...input,
      organisationId: 'org-demo',
      occurredAt: new Date().toISOString(),
      version: ++this.version,
    };
    this.emitter.emit('event', event);
    return event;
  }

  subscribe(listener: (event: RealtimeEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}

export interface RealtimeEvent {
  type: RealtimeEventType;
  entityId: string;
  organisationId: string;
  affectedEmployeeIds: string[];
  occurredAt: string;
  version: number;
}

export const realtime = new RealtimePublisher();
