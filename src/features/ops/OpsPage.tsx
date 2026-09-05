import { useEffect, useMemo, useState } from 'react';
import { Activity, CircleCheck, Database, HardDrive, Network, Server, Users } from 'lucide-react';
import { Page } from '@/app/Page';
import { useStore } from '@/store/store';
import { Banner, Card, Chip, Metric } from '@/ui/primitives';
import { HBars, LineChart } from '@/ui/charts';

interface Tick { id: string; label: string; value: number }

export function OpsPage() {
  const state = useStore();
  const [tick, setTick] = useState(0);
  const [history, setHistory] = useState<Tick[]>(() => Array.from({ length: 12 }, (_, i) => ({ id: `boot-${i}`, label: `${i * 5}s`, value: 90 + ((i * 7) % 24) })));
  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
      setHistory((rows) => [...rows.slice(-23), { id: `live-${Date.now()}`, label: 'now', value: 92 + ((rows.length * 11) % 29) }]);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  const latency = 42 + (tick % 6) * 3;
  const requests = 96 + (tick * 11) % 31;
  const connected = 7 + (tick % 4);
  const storage = Math.min(100, Math.round((state.attendance.length + state.payslips.length * 8) / 24));
  const routes = useMemo(() => [
    { id: 'dashboard', label: 'Dashboard', percent: 92, caption: `${3 + tick % 2} users` },
    { id: 'payroll', label: 'Payroll', percent: 68, caption: '2 users' },
    { id: 'people', label: 'Employees', percent: 44, caption: '2 users' },
    { id: 'reports', label: 'Reports', percent: 24, caption: '1 user' },
  ], [tick]);
  return (
    <Page title="System Health" crumbs={['System', 'Operations']} actions={<Chip tone="success" dot>Live · updated {tick ? 'just now' : 'on open'}</Chip>}>
      <Banner tone="info" icon={Activity} title="Prototype telemetry"><p>This frontend view refreshes once per second from deterministic demo signals. The production contract uses an admin-only SSE stream and omits names and IP addresses.</p></Banner>
      <div className="grid grid-4"><Metric icon={Server} label="API availability" value="99.99%" tone="success" sub="Last 30 days" /><Metric icon={Activity} label="p95 latency" value={`${latency} ms`} tone="brand" sub="Application requests" /><Metric icon={Database} label="Database connections" value="18 / 100" sub="Pool healthy" /><Metric icon={Users} label="Active sessions" value={connected} sub="Role + route only" /></div>
      <Card className="ops-flow" title="Live request flow" subtitle="One calm motion surface; rate reflects requests per minute">
        <div className="flow-map" role="img" aria-label={`${requests} requests per minute flowing from clients through the web application to PostgreSQL`}>
          <div className="flow-node"><Users size={22} aria-hidden /><strong>Clients</strong><span>{connected} active</span></div>
          <div className="flow-line"><i style={{ animationDelay: '-.8s' }} /><i style={{ animationDelay: '-1.8s' }} /><i style={{ animationDelay: '-2.8s' }} /></div>
          <div className="flow-node brand-node"><Server size={22} aria-hidden /><strong>Web + API</strong><span>{requests} req/min</span></div>
          <div className="flow-line"><i style={{ animationDelay: '-.3s' }} /><i style={{ animationDelay: '-1.3s' }} /></div>
          <div className="flow-node"><Database size={22} aria-hidden /><strong>PostgreSQL</strong><span>18 connections</span></div>
        </div>
      </Card>
      <div className="grid grid-2"><Card title="Request rate · last two minutes"><LineChart data={history} unit="requests/min" /></Card><Card title="Client activity by route"><HBars rows={routes} /></Card><Card title="Capacity"><div className="col gap4"><Capacity icon={Database} label="Connection pool" used={18} total={100} /><Capacity icon={HardDrive} label="Demo record footprint" used={storage} total={100} /><Capacity icon={Network} label="SSE subscribers" used={connected} total={50} /></div></Card><Card title="Service checks"><div className="col gap3"><Health label="Web application" detail={`${latency} ms`} /><Health label="API service" detail="Healthy" /><Health label="PostgreSQL" detail="Accepting queries" /><Health label="Job worker" detail="Queue empty" /></div></Card></div>
    </Page>
  );
}

function Capacity({ icon: Icon, label, used, total }: { icon: typeof Database; label: string; used: number; total: number }) {
  return <div><div className="row between mb2"><span className="row"><Icon size={15} aria-hidden />{label}</span><span className="mono">{used} / {total}</span></div><div className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, used / total * 100)}%` }} /></div></div>;
}

function Health({ label, detail }: { label: string; detail: string }) {
  return <div className="row between"><span className="row"><CircleCheck size={16} color="var(--success)" aria-hidden /><strong>{label}</strong></span><span className="muted">{detail}</span></div>;
}
