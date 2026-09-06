import { useState } from 'react';
import { Pencil, Search, ShieldCheck } from 'lucide-react';
import { permissionsFor } from '@shared/permissions';
import { ROLES, ROLE_LABEL, type Role, type User } from '@shared/types';
import { formatDateTime } from '@shared/dates';
import { Page } from '@/app/Page';
import { updateUser } from '@/store/actions';
import { useStore } from '@/store/store';
import { Avatar, Button, Card, Chip, EmptyState } from '@/ui/primitives';
import { SearchBox, Select, Switch } from '@/ui/form';
import { Drawer } from '@/ui/overlays';
import { DataTable, type Column } from '@/ui/table';
import { useToast } from '@/ui/toast';

export function UsersPage() {
  const state = useStore();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('EMPLOYEE');
  const [active, setActive] = useState(true);
  const rows = state.users.filter((u) => `${u.displayName} ${u.email} ${ROLE_LABEL[u.role]}`.toLowerCase().includes(query.toLowerCase()));
  const open = (user: User) => { setEditing(user); setRole(user.role); setActive(user.isActive); };
  const save = async () => { if (!editing) return; const result = await updateUser(editing.id, { role, isActive: active }); toast.result(result); if (result.ok) setEditing(null); };
  const columns: Column<User>[] = [
    { key: 'name', header: 'User', render: (u) => <span className="row"><Avatar initials={u.initials} /><span><strong>{u.displayName}</strong><span className="muted" style={{ display: 'block' }}>{u.email}</span></span></span>, sortValue: (u) => u.displayName },
    { key: 'role', header: 'Role', render: (u) => <Chip tone="info">{ROLE_LABEL[u.role]}</Chip> },
    { key: 'permissions', header: 'Permissions', render: (u) => `${permissionsFor(u.role).length} granted`, secondary: true },
    { key: 'last', header: 'Last login', render: (u) => u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Not recorded', secondary: true },
    { key: 'status', header: 'Status', render: (u) => <Chip tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Active' : 'Inactive'}</Chip> },
    { key: 'actions', header: '', align: 'right', render: (u) => <Button size="sm" icon={Pencil} onClick={() => open(u)}>Manage</Button> },
  ];
  return <Page title="Users & Roles" crumbs={['System', 'Access']}><Card padding="tight"><SearchBox value={query} onChange={setQuery} placeholder="Search users or roles" /></Card><Card padding="flush"><DataTable rows={rows} columns={columns} rowKey={(u) => u.id} caption="Application users" empty={<EmptyState icon={Search} title="No users found" />} mobileCard={(u) => <div className="col gap3"><div className="row"><Avatar initials={u.initials} /><div><strong>{u.displayName}</strong><div className="muted">{u.email}</div></div></div><div className="row between"><Chip tone="info">{ROLE_LABEL[u.role]}</Chip><Chip tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Active' : 'Inactive'}</Chip></div><Button icon={Pencil} onClick={() => open(u)}>Manage access</Button></div>} /></Card><Card><div className="row-t"><ShieldCheck size={20} color="var(--brand)" /><div><strong>One role per user in this prototype</strong><p className="secondary">The server permission matrix remains the enforcement boundary. This screen changes assignments, not permission definitions.</p></div></div></Card><Drawer open={Boolean(editing)} onClose={() => setEditing(null)} title="Manage user access" footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save access</Button></>}>{editing && <div className="col gap4"><div className="row"><Avatar initials={editing.initials} size="lg" /><div><h3>{editing.displayName}</h3><p className="muted">{editing.email}</p></div></div><Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /><Switch checked={active} onChange={setActive} label="Account active" /><div><div className="eyebrow mb2">Granted capabilities</div><div className="row wrap">{permissionsFor(role).map((p) => <Chip key={p} tone="neutral">{p}</Chip>)}</div></div></div>}</Drawer></Page>;
}
