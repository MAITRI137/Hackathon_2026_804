import {
  Activity,
  BadgeIndianRupee,
  CalendarDays,
  CalendarOff,
  ChartNoAxesColumn,
  ClipboardList,
  Clock,
  FileText,
  FolderOpen,
  Gauge,
  Inbox,
  LayoutDashboard,
  Receipt,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { can, type Permission } from '@shared/permissions';
import type { Role } from '@shared/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: Permission | null;
  /** 'exceptions' | 'approvals' — resolved against live state. */
  badge?: 'exceptions' | 'approvals';
  /** Label shown to the Employee role, which sees the same route self-scoped. */
  selfLabel?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        to: '/',
        label: 'Dashboard',
        icon: LayoutDashboard,
        permission: null,
        selfLabel: 'My Dashboard',
      },
      {
        to: '/approvals',
        label: 'Approval Inbox',
        icon: Inbox,
        permission: 'approval.read',
        badge: 'approvals',
      },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/employees', label: 'Employees', icon: Users, permission: 'employee.read.all' },
      {
        to: '/contracts',
        label: 'Contracts',
        icon: FileText,
        permission: 'contract.read.self',
        selfLabel: 'My Contract',
      },
      {
        to: '/schedules',
        label: 'Working Schedules',
        icon: CalendarDays,
        permission: 'schedule.read',
      },
      {
        to: '/documents',
        label: 'Documents',
        icon: FolderOpen,
        permission: 'document.read.self',
        selfLabel: 'My Documents',
      },
    ],
  },
  {
    label: 'Time',
    items: [
      {
        to: '/attendance',
        label: 'Attendance',
        icon: Clock,
        permission: 'attendance.read.self',
        selfLabel: 'My Attendance',
      },
      {
        to: '/timeoff',
        label: 'Time Off',
        icon: CalendarOff,
        permission: 'timeoff.request.self',
        selfLabel: 'My Time Off',
      },
    ],
  },
  {
    label: 'Payroll',
    items: [
      { to: '/payroll', label: 'Payroll', icon: BadgeIndianRupee, permission: 'payrun.read' },
      {
        to: '/payslips',
        label: 'Payslips',
        icon: Receipt,
        permission: 'payslip.read.self',
        selfLabel: 'My Payslips',
      },
      {
        to: '/payroll/exceptions',
        label: 'Exception Centre',
        icon: TriangleAlert,
        permission: 'payrun.read',
        badge: 'exceptions',
      },
      {
        to: '/salary',
        label: 'Salary Config',
        icon: SlidersHorizontal,
        permission: 'salary.structure.read',
      },
      { to: '/simulation', label: 'Simulation', icon: Activity, permission: 'simulation.run' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: ChartNoAxesColumn, permission: 'report.self' },
      { to: '/audit', label: 'Audit Trail', icon: ShieldCheck, permission: 'audit.read' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/users', label: 'Users & Roles', icon: ClipboardList, permission: 'admin.users' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: 'admin.settings' },
      { to: '/ops', label: 'System Health', icon: Gauge, permission: 'ops.dashboard' },
    ],
  },
];

/** Navigation is filtered by the same matrix the server enforces. */
export function navFor(role: Role): NavGroup[] {
  return GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => i.permission === null || can(role, i.permission)),
  })).filter((g) => g.items.length > 0);
}

/**
 * True when another nav entry lives underneath this one (e.g. `/payroll` has
 * `/payroll/exceptions`). Such a parent must match its own path exactly,
 * otherwise both entries light up when the child route is open.
 */
export function isExactMatch(item: NavItem, groups: NavGroup[]): boolean {
  if (item.to === '/') return true;
  return groups.some((g) =>
    g.items.some((other) => other.to !== item.to && other.to.startsWith(`${item.to}/`)),
  );
}

export function labelFor(item: NavItem, role: Role): string {
  return role === 'EMPLOYEE' && item.selfLabel ? item.selfLabel : item.label;
}
