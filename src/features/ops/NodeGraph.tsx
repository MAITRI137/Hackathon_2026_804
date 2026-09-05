/**
 * Live system graph.
 *
 * A canvas view of the request path — browser, API, payroll engine, Prisma,
 * PostgreSQL, and the tables behind it. Packets travel the edges at the rate
 * the server actually reports, and a node flashes when a packet reaches it.
 *
 * Performance contract: one canvas, one requestAnimationFrame loop, all live
 * data read from a ref. React never re-renders for a frame, and the packet
 * pool is capped, so the console cannot become the load it is measuring.
 */
import { useEffect, useRef } from 'react';

export interface GraphSignal {
  /** Requests per second observed by the server. */
  requestsPerSecond: number;
  /** Database rows served per second. */
  readsPerSecond: number;
  /** Round-trip time to the database, milliseconds. */
  databaseMs: number;
  /** API p95 latency, milliseconds. */
  latencyMs: number;
  online: boolean;
  databaseOnline: boolean;
  /** Largest tables, biggest first — drawn as the storage layer. */
  tables: { table: string; rows: number }[];
  totalRecords: number;
  recordsLoaded: number;
}

interface NodeSpec {
  id: string;
  label: string;
  detail: () => string;
  /** Fractional position inside the drawing area. */
  x: number;
  y: number;
  w: number;
  h: number;
  accent: boolean;
  flash: number;
}

interface Packet {
  edge: number;
  t: number;
  speed: number;
  kind: 'request' | 'read';
}

const EDGES: [string, string][] = [
  ['clients', 'api'],
  ['api', 'engine'],
  ['engine', 'prisma'],
  ['prisma', 'db'],
];

const MAX_PACKETS = 140;
/** Width reserved on the right for the table panel. */
const STORAGE_W = 196;
const STORAGE_GAP = 20;

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function NodeGraph({ signal }: { signal: GraphSignal }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef(signal);
  live.current = signal;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const theme = {
      ink: cssVar('--text', '#16232c'),
      muted: cssVar('--text-muted', '#6b8290'),
      line: cssVar('--border-strong', '#c6d5de'),
      surface: cssVar('--surface', '#ffffff'),
      surface2: cssVar('--surface-2', '#f7fafc'),
      brand: cssVar('--brand', '#2274a5'),
      brandLight: cssVar('--brand-light', '#e8f2f8'),
      accent: cssVar('--accent', '#6da2c2'),
      good: cssVar('--success', '#0f7b3d'),
      warn: cssVar('--warning-strong', '#d97706'),
      bad: cssVar('--danger', '#c02626'),
    };

    const nodes: Record<string, NodeSpec> = {
      clients: {
        id: 'clients',
        label: 'Browser clients',
        detail: () => `${live.current.recordsLoaded.toLocaleString('en-IN')} records loaded`,
        x: 0.095,
        y: 0.5,
        w: 128,
        h: 60,
        accent: false,
        flash: 0,
      },
      api: {
        id: 'api',
        label: 'Express API',
        detail: () =>
          `${live.current.requestsPerSecond.toFixed(1)} req/s · p95 ${Math.round(live.current.latencyMs)} ms`,
        x: 0.29,
        y: 0.5,
        w: 136,
        h: 60,
        accent: true,
        flash: 0,
      },
      engine: {
        id: 'engine',
        label: 'Payroll engine',
        detail: () => 'decimal · sequence-ordered rules',
        x: 0.5,
        y: 0.5,
        w: 144,
        h: 60,
        accent: false,
        flash: 0,
      },
      prisma: {
        id: 'prisma',
        label: 'Prisma',
        detail: () => `${live.current.readsPerSecond.toFixed(0)} rows/s`,
        x: 0.7,
        y: 0.5,
        w: 112,
        h: 60,
        accent: false,
        flash: 0,
      },
      db: {
        id: 'db',
        label: 'PostgreSQL',
        detail: () =>
          `${live.current.totalRecords.toLocaleString('en-IN')} records · ${live.current.databaseMs.toFixed(0)} ms`,
        x: 0.885,
        y: 0.5,
        w: 124,
        h: 60,
        accent: true,
        flash: 0,
      },
    };

    const packets: Packet[] = [];
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();
    let emitAccumulator = 0;
    let readAccumulator = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    /** Drawing area excludes the reserved storage column. */
    const flowWidth = () => Math.max(320, width - STORAGE_W - STORAGE_GAP);

    const nodeAt = (id: string) => {
      const n = nodes[id];
      return { cx: n.x * flowWidth(), cy: n.y * height, node: n };
    };

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const spawn = (kind: Packet['kind']) => {
      if (packets.length >= MAX_PACKETS) return;
      packets.push({
        edge: 0,
        t: 0,
        speed: kind === 'read' ? 0.85 + Math.random() * 0.5 : 0.6 + Math.random() * 0.35,
        kind,
      });
    };

    /** The storage layer, drawn in its own column so it can never overflow. */
    const drawStorage = () => {
      const tables = live.current.tables.slice(0, 8);
      if (tables.length === 0) return;
      const x0 = width - STORAGE_W;
      const max = Math.max(...tables.map((t) => t.rows), 1);
      const rowH = 22;
      const blockH = tables.length * rowH + 18;
      let y = Math.max(14, height / 2 - blockH / 2);

      ctx.textAlign = 'left';
      ctx.fillStyle = theme.muted;
      ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('TABLES BY ROW COUNT', x0, y);
      y += 16;

      for (const t of tables) {
        const barW = Math.max(2, (t.rows / max) * STORAGE_W);
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = theme.ink;
        ctx.textAlign = 'left';
        ctx.fillText(truncate(ctx, t.table, STORAGE_W - 58), x0, y + 8);
        ctx.fillStyle = theme.muted;
        ctx.textAlign = 'right';
        ctx.fillText(t.rows.toLocaleString('en-IN'), x0 + STORAGE_W, y + 8);

        ctx.fillStyle = theme.brandLight;
        roundRect(x0, y + 12, STORAGE_W, 4, 2);
        ctx.fill();
        ctx.fillStyle = theme.brand;
        roundRect(x0, y + 12, barW, 4, 2);
        ctx.fill();
        y += rowH;
      }
      ctx.textAlign = 'left';
    };

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = live.current;

      ctx.clearRect(0, 0, width, height);

      // ── edges ────────────────────────────────────────────
      ctx.lineWidth = 1.5;
      for (const [from, to] of EDGES) {
        const a = nodeAt(from);
        const b = nodeAt(to);
        const gradient = ctx.createLinearGradient(a.cx, a.cy, b.cx, b.cy);
        gradient.addColorStop(0, theme.line);
        gradient.addColorStop(0.5, s.online ? theme.accent : theme.line);
        gradient.addColorStop(1, theme.line);
        ctx.strokeStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(a.cx + a.node.w / 2, a.cy);
        ctx.lineTo(b.cx - b.node.w / 2, b.cy);
        ctx.stroke();
      }

      drawStorage();

      // ── packets ──────────────────────────────────────────
      if (!reduceMotion && s.online) {
        emitAccumulator += Math.min(24, Math.max(0.6, s.requestsPerSecond)) * dt;
        while (emitAccumulator >= 1) {
          spawn('request');
          emitAccumulator -= 1;
        }
        readAccumulator += Math.min(40, s.readsPerSecond / 12) * dt;
        while (readAccumulator >= 1) {
          spawn('read');
          readAccumulator -= 1;
        }
      }

      for (let i = packets.length - 1; i >= 0; i -= 1) {
        const p = packets[i];
        p.t += p.speed * dt * 1.6;
        if (p.t >= 1) {
          p.t = 0;
          p.edge += 1;
          const arrived = EDGES[Math.min(p.edge, EDGES.length - 1)]?.[0];
          if (arrived) nodes[arrived].flash = 1;
          if (p.edge >= EDGES.length) {
            nodes.db.flash = 1;
            packets.splice(i, 1);
            continue;
          }
        }
        const [from, to] = EDGES[p.edge];
        const a = nodeAt(from);
        const b = nodeAt(to);
        const x0 = a.cx + a.node.w / 2;
        const x1 = b.cx - b.node.w / 2;
        const x = x0 + (x1 - x0) * p.t;
        const y = a.cy + (b.cy - a.cy) * p.t;

        // trailing tail
        const tailX = x0 + (x1 - x0) * Math.max(0, p.t - 0.09);
        const tail = ctx.createLinearGradient(tailX, y, x, y);
        tail.addColorStop(0, 'rgba(34,116,165,0)');
        tail.addColorStop(1, p.kind === 'read' ? theme.accent : theme.brand);
        ctx.strokeStyle = tail;
        ctx.lineWidth = p.kind === 'read' ? 1.5 : 2.5;
        ctx.beginPath();
        ctx.moveTo(tailX, y);
        ctx.lineTo(x, y);
        ctx.stroke();

        ctx.fillStyle = p.kind === 'read' ? theme.accent : theme.brand;
        ctx.beginPath();
        ctx.arc(x, y, p.kind === 'read' ? 2 : 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── nodes ────────────────────────────────────────────
      for (const id of Object.keys(nodes)) {
        const n = nodes[id];
        const { cx, cy } = nodeAt(id);
        const x = cx - n.w / 2;
        const y = cy - n.h / 2;

        // flash ring on arrival
        if (n.flash > 0) {
          ctx.strokeStyle = theme.brand;
          ctx.globalAlpha = n.flash * 0.5;
          ctx.lineWidth = 2;
          roundRect(
            x - 6 * (1 - n.flash) - 2,
            y - 6 * (1 - n.flash) - 2,
            n.w + 12 * (1 - n.flash) + 4,
            n.h + 12 * (1 - n.flash) + 4,
            12,
          );
          ctx.stroke();
          ctx.globalAlpha = 1;
          n.flash = Math.max(0, n.flash - dt * 2.6);
        }

        const healthy = id === 'db' ? s.databaseOnline : s.online;
        ctx.fillStyle = n.accent ? theme.brandLight : theme.surface2;
        roundRect(x, y, n.w, n.h, 10);
        ctx.fill();
        ctx.strokeStyle = n.flash > 0.05 ? theme.brand : theme.line;
        ctx.lineWidth = 1;
        ctx.stroke();

        // status pip
        ctx.fillStyle = healthy ? theme.good : theme.bad;
        ctx.beginPath();
        ctx.arc(x + 12, y + 14, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.textAlign = 'left';
        ctx.fillStyle = n.accent ? theme.brand : theme.ink;
        ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(n.label, x + 22, y + 18);
        ctx.fillStyle = theme.muted;
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        wrapText(ctx, n.detail(), x + 12, y + 36, n.w - 20, 12);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const description =
    `Live system graph. Browser clients to Express API to payroll engine to Prisma to PostgreSQL. ` +
    `${signal.requestsPerSecond.toFixed(1)} requests per second, ` +
    `${signal.readsPerSecond.toFixed(0)} database rows per second, ` +
    `database round trip ${signal.databaseMs.toFixed(0)} milliseconds, ` +
    `${signal.totalRecords.toLocaleString('en-IN')} records stored, ` +
    `${signal.recordsLoaded.toLocaleString('en-IN')} loaded in this browser.`;

  return (
    <div className="node-graph">
      <canvas ref={canvasRef} role="img" aria-label={description} />
    </div>
  );
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(' ');
  let line = '';
  let cursorY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) ctx.fillText(line, x, cursorY);
}
