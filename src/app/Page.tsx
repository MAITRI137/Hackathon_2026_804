import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Lock } from 'lucide-react';
import { can, type Permission } from '@shared/permissions';
import { useStore } from '@/store/store';
import { currentRole } from '@/store/selectors';
import { ROLE_LABEL } from '@shared/types';
import { Button, EmptyState } from '@/ui/primitives';

export function Page({
  title,
  crumbs,
  actions,
  children,
}: {
  title: string;
  crumbs?: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="page-head">
        <div style={{ minWidth: 0 }}>
          {crumbs && crumbs.length > 0 && (
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.map((c, i) => (
                <span key={c} className="row gap1">
                  {i > 0 && <ChevronRight size={11} aria-hidden />}
                  {c}
                </span>
              ))}
            </nav>
          )}
          <h2>{title}</h2>
        </div>
        {actions && <div className="row gap2 wrap">{actions}</div>}
      </header>
      <div className="page-body">{children}</div>
    </>
  );
}

/**
 * A real Permission Denied surface — never a silent redirect that hides the
 * boundary, and never a blank page.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const state = useStore();
  const role = currentRole(state);
  if (can(role, permission)) return <>{children}</>;

  return (
    <Page title="Permission denied" crumbs={['Access']}>
      <div className="card">
        <div className="card-b">
          <EmptyState
            icon={Lock}
            title="You do not have access to this area"
            description={`Signed in as ${ROLE_LABEL[role]}. This screen requires the "${permission}" permission. Authorisation is enforced on the server — this is not a display setting.`}
            action={
              <Link to="/">
                <Button variant="primary">Back to my dashboard</Button>
              </Link>
            }
          />
        </div>
      </div>
    </Page>
  );
}
