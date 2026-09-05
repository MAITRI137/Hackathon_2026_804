import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarDays,
  Check,
  ChevronsUpDown,
  LogOut,
  Menu,
  Search,
  Settings,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { ROLES, ROLE_LABEL, type Role } from '@shared/types';
import { monthLabel, relativeTime } from '@shared/dates';
import { useStore } from '@/store/store';
import {
  activePayrun,
  currentRole,
  currentUser,
  exceptionsFor,
  notifications,
  pendingApprovalCount,
  unreadNotificationCount,
} from '@/store/selectors';
import { markNotificationsRead, switchRole } from '@/store/actions';
import { connectDemoRole, signOut } from '@/lib/api';
import { bootstrapPayroll } from '@/store/actions';
import { hydrateFromServer } from '@/store/store';
import { Avatar, Button } from '@/ui/primitives';
import { SidecarHost, useLayer } from '@/ui/overlays';
import { useToast } from '@/ui/toast';
import { labelFor, navFor } from './nav';
import { CommandLauncher } from './CommandLauncher';
import { useAppActions } from './actions-context';

export function Shell() {
  const state = useStore();
  const role = currentRole(state);
  const user = currentUser(state);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const appActions = useAppActions();

  const [navOpen, setNavOpen] = useState(false);
  const [roleMenu, setRoleMenu] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [launcher, setLauncher] = useState(false);
  const [switchingRole, setSwitchingRole] = useState(false);

  const payrun = activePayrun(state);
  const groups = useMemo(() => navFor(role), [role]);
  const badges = useMemo(
    () => ({
      approvals: pendingApprovalCount(state),
      exceptions: exceptionsFor(state, payrun).filter((e) => e.blocking).length,
    }),
    [state, payrun],
  );
  const notifs = useMemo(() => notifications(state), [state]);
  const unread = unreadNotificationCount(state);

  useLayer('nav', navOpen, () => setNavOpen(false));
  useLayer('menu', roleMenu, () => setRoleMenu(false));
  useLayer('menu', notifOpen, () => setNotifOpen(false));

  /* Ctrl/Cmd+K anywhere. Never hijacks a browser shortcut. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setLauncher(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* Selecting a destination closes the mobile drawer. */
  useEffect(() => {
    setNavOpen(false);
    setNotifOpen(false);
    setRoleMenu(false);
  }, [location.pathname]);

  const onRoleChange = useCallback(
    async (next: Role) => {
      if (switchingRole || next === role) return;
      setSwitchingRole(true);
      try {
        const payload = await connectDemoRole(next);
        hydrateFromServer(payload);
        if (next === 'HR_PAYROLL_USER' || next === 'HR_PAYROLL_MANAGER' || next === 'ADMIN') {
          bootstrapPayroll();
        }
        setRoleMenu(false);
        navigate('/');
        toast.show(`Now securely signed in as ${ROLE_LABEL[next]}`, 'success');
      } catch (error) {
        switchRole(next);
        setRoleMenu(false);
        navigate('/');
        toast.show(
          error instanceof Error
            ? `${error.message} Using the offline demo persona.`
            : 'Using the offline demo persona.',
          'warning',
        );
      } finally {
        setSwitchingRole(false);
      }
    },
    [navigate, role, switchingRole, toast],
  );

  return (
    <div className="app">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />}

      <aside
        className="app-sidebar"
        data-open={navOpen || undefined}
        aria-label="Primary navigation"
      >
        <div className="app-brand">
          <span className="brand-mark" aria-hidden>
            P
          </span>
          <span className="brand-text">
            <strong>PeoplePay360</strong>
            <span>HR &amp; Payroll OS</span>
          </span>
          <button
            type="button"
            className="tb-btn mobile-only-inline"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            style={{ marginLeft: 'auto' }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <nav className="nav scroll-y">
          {groups.map((g) => (
            <div className="nav-group" key={g.label}>
              <div className="nav-label">{g.label}</div>
              {g.items.map((item) => {
                const count = item.badge ? badges[item.badge] : 0;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => clsx('nav-item', isActive && 'active')}
                    title={labelFor(item, role)}
                  >
                    <item.icon size={18} aria-hidden />
                    <span>{labelFor(item, role)}</span>
                    {count > 0 && (
                      <span className={clsx('nav-badge', item.badge === 'approvals' && 'warn')}>
                        {count}
                        <span className="sr-only"> items need attention</span>
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button
            type="button"
            className="role-switch"
            aria-haspopup="listbox"
            aria-expanded={roleMenu}
            aria-controls="role-menu"
            onClick={() => setRoleMenu((v) => !v)}
          >
            <Avatar initials={user.initials} />
            <span className="info">
              <strong>{user.displayName}</strong>
              <span>{ROLE_LABEL[role]}</span>
            </span>
            <ChevronsUpDown size={15} aria-hidden />
          </button>

          {roleMenu && (
            <div className="role-menu" id="role-menu" role="listbox" aria-label="Switch role">
              {ROLES.map((r) => {
                const u = state.users.find((x) => x.role === r);
                return (
                  <button
                    key={r}
                    type="button"
                    role="option"
                    aria-selected={r === role}
                    className="role-opt"
                    disabled={switchingRole}
                    onClick={() => onRoleChange(r)}
                  >
                    <span className="rdot" aria-hidden />
                    <span className="grow">
                      <b>{ROLE_LABEL[r]}</b>
                      <span>{u?.displayName}</span>
                    </span>
                    {r === role && <Check size={14} aria-hidden />}
                  </button>
                );
              })}
              <div className="role-menu-foot">
                <button
                  type="button"
                  className="role-opt"
                  onClick={() => {
                    void signOut().finally(() => window.location.reload());
                  }}
                >
                  <LogOut size={15} aria-hidden />
                  <span className="grow">
                    <b>Sign out</b>
                    <span>End this server session</span>
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="tb-btn mobile-only-inline"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
          >
            <Menu size={19} aria-hidden />
          </button>

          <button
            type="button"
            className="tb-search"
            onClick={() => setLauncher(true)}
            aria-haspopup="dialog"
          >
            <Search size={15} aria-hidden />
            <span>Search and commands</span>
            <kbd aria-hidden>Ctrl K</kbd>
          </button>

          <span className="tb-period" title="Active payroll period">
            <CalendarDays size={14} aria-hidden />
            {monthLabel(payrun.periodStart)}
          </span>

          <div className="row gap1" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className="tb-btn"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
              aria-expanded={notifOpen}
              aria-haspopup="dialog"
            >
              <Bell size={18} aria-hidden />
              {unread > 0 && <span className="pip" aria-hidden />}
            </button>
            <button
              type="button"
              className="tb-btn"
              onClick={() => navigate('/settings')}
              aria-label="Settings"
            >
              <Settings size={18} aria-hidden />
            </button>
          </div>
        </header>

        {notifOpen && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 110 }}
              onClick={() => setNotifOpen(false)}
              aria-hidden
            />
            <div className="notif-panel" role="dialog" aria-label="Notifications">
              <div className="notif-h">
                <strong style={{ fontSize: 'var(--fs-sm)' }}>Notifications</strong>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={unread === 0}
                  onClick={() => {
                    const r = markNotificationsRead(notifs.map((n) => n.id));
                    toast.result(r);
                  }}
                >
                  Mark all read
                </Button>
              </div>
              <div className="notif-list scroll-y">
                {notifs.length === 0 ? (
                  <p className="empty" style={{ padding: 'var(--s6)' }}>
                    Nothing needs your attention.
                  </p>
                ) : (
                  notifs.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className="notif-item"
                      data-unread={!n.readAt || undefined}
                      onClick={() => {
                        markNotificationsRead([n.id]);
                        setNotifOpen(false);
                        if (n.link) navigate(n.link);
                      }}
                    >
                      <span
                        className={clsx(
                          'avatar sm',
                          n.severity === 'warning' && 'warning',
                          n.severity === 'danger' && 'danger',
                          n.severity === 'success' && 'success',
                        )}
                        aria-hidden
                      >
                        <Bell size={13} />
                      </span>
                      <span className="nb">
                        <strong>{n.title}</strong>
                        <span>{n.body}</span>
                      </span>
                      <span className="notif-time">{relativeTime(n.createdAt)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        <div className="workspace">
          <main className="page scroll-y" id="main">
            <Outlet />
          </main>
          <SidecarHost />
        </div>
      </div>

      <CommandLauncher
        open={launcher}
        onClose={() => setLauncher(false)}
        onAction={(a) => {
          setLauncher(false);
          appActions.run(a);
        }}
      />
    </div>
  );
}
