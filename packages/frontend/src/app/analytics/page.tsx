'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { audit, type AuditBreakdowns } from '@/lib/api';
import { NavBar } from '@/components/nav-bar';
import { Footer } from '@/components/footer';

type Analytics = Awaited<ReturnType<typeof audit.analytics>>;

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export default function AnalyticsPage() {
  const { token } = useAuth();
  const [days, setDays] = useState(30);
  const [bd, setBd] = useState<AuditBreakdowns | null>(null);
  const [an, setAn] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([audit.breakdowns(token, days), audit.analytics(token, days)])
      .then(([b, a]) => {
        setBd(b);
        setAn(a);
      })
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, days]);

  useEffect(() => load(), [load]);

  const hasRates = !!bd && (bd.rates.callMicros > 0 || bd.rates.proxyCallMicros > 0);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      <NavBar
        title="Analytics"
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  days === r.days
                    ? 'bg-[var(--brand)] text-white'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-5">
        {error && <p className="text-sm text-[var(--destructive)] mb-4">{error}</p>}
        {loading ? (
          <p className="text-[var(--muted-foreground)]">Loading…</p>
        ) : !bd ? null : (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card label={`Tool calls (${bd.days}d)`} value={bd.total.toLocaleString()} />
              <Card
                label="Success rate"
                value={bd.total > 0 ? `${Math.round(((bd.total - bd.errors) / bd.total) * 100)}%` : '—'}
                sub={`${bd.errors.toLocaleString()} errors`}
              />
              <Card label="Proxy calls" value={bd.proxyCalls.toLocaleString()} sub="metered" />
              <Card
                label="Est. cost"
                value={hasRates ? formatCost(bd.estCostMicros) : '—'}
                sub={hasRates ? 'volume-based' : 'set COST_PER_CALL_MICROS'}
              />
            </div>

            {/* Daily timeline */}
            {an && (
              <Section title={`Invocations (last ${bd.days} days)`}>
                <DailyTimeline daily={an.daily} />
              </Section>
            )}

            {/* Breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Breakdown title="By connector" rows={bd.byConnector} />
              <Breakdown title="By MCP server" rows={bd.byServer} />
              <Breakdown title="By user" rows={bd.byUser} />
            </div>

            <p className="text-xs text-[var(--muted-foreground)]">
              Cost is volume-based (no LLM tokens): calls × COST_PER_CALL_MICROS + proxy calls ×
              COST_PER_PROXY_CALL_MICROS. Configure the rates as environment variables.
            </p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-[var(--border)] rounded-lg p-4">
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="text-2xl font-semibold mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[var(--border)] rounded-lg p-4">
      <h3 className="text-sm font-medium mb-3">{title}</h3>
      {children}
    </div>
  );
}

function DailyTimeline({
  daily,
}: {
  daily: Array<{ date: string; success: number; error: number; timeout: number }>;
}) {
  const max = Math.max(1, ...daily.map((d) => d.success + d.error + d.timeout));
  // Thin the x-axis labels so they don't overlap on 30/90-day ranges.
  const labelEvery = Math.ceil(daily.length / 8);
  return (
    <div className="flex items-end gap-1 h-40">
      {daily.map((d, i) => {
        const total = d.success + d.error + d.timeout;
        const h = (n: number) => `${(n / max) * 100}%`;
        const showLabel = i % labelEvery === 0 || i === daily.length - 1;
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${d.date}: ${total} calls`}>
            <div className="w-full flex flex-col justify-end h-full">
              {d.error > 0 && <div style={{ height: h(d.error) }} className="w-full bg-red-500/80 rounded-t-sm" />}
              {d.timeout > 0 && <div style={{ height: h(d.timeout) }} className="w-full bg-amber-500/80" />}
              {d.success > 0 && <div style={{ height: h(d.success) }} className="w-full bg-[var(--brand)] rounded-b-sm" />}
              {total === 0 && <div className="w-full h-px bg-[var(--border)]" />}
            </div>
            <span className="text-[10px] text-[var(--muted-foreground)] h-3 whitespace-nowrap">
              {showLabel ? d.date.slice(5) : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string | null; label: string; count: number; errors: number }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="border border-[var(--border)] rounded-lg p-4">
      <h3 className="text-sm font-medium mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No data in range.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.id ?? r.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="truncate pr-2" title={r.label}>{r.label}</span>
                <span className="tabular-nums text-[var(--muted-foreground)] flex-shrink-0">
                  {r.count.toLocaleString()}
                  {r.errors > 0 && <span className="text-[var(--destructive)]"> · {r.errors} err</span>}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--accent)] overflow-hidden">
                <div
                  className="h-full bg-[var(--brand)] rounded-full"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Micros = millionths of a currency unit. Show a compact monetary-ish value. */
function formatCost(micros: number): string {
  const units = micros / 1_000_000;
  return units >= 1 ? units.toFixed(2) : units.toFixed(4);
}
