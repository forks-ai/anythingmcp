'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { knowledgeGraph, type KgSkill } from '@/lib/api';
import { NavBar } from '@/components/nav-bar';
import { Footer } from '@/components/footer';

export default function SkillsPage() {
  const { token, user } = useAuth();
  const [skills, setSkills] = useState<KgSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const isAdmin = user?.role === 'ADMIN';

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    knowledgeGraph.skills
      .list(token)
      .then(setSkills)
      .catch((e) => setStatus(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => load(), [load]);

  const generate = async () => {
    if (!token) return;
    setGenerating(true);
    setStatus('Analyzing captured intents…');
    try {
      const r = await knowledgeGraph.skills.generate(token);
      setStatus(
        r.created > 0
          ? `Generated ${r.created} suggestion(s)${r.model ? ` (${r.model})` : ''}.`
          : 'No new skill patterns found in the captured intents yet.',
      );
      load();
    } catch (e: any) {
      setStatus(e.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const act = async (id: string, action: 'apply' | 'dismiss') => {
    if (!token) return;
    try {
      await knowledgeGraph.skills[action](token, id);
      load();
    } catch (e: any) {
      setStatus(e.message || 'Action failed');
    }
  };

  const pending = skills.filter((s) => s.status === 'pending');
  const resolved = skills.filter((s) => s.status !== 'pending');

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      <NavBar
        breadcrumbs={[{ label: 'Knowledge Graph', href: '/knowledge-graph' }]}
        title="Skills"
        actions={
          isAdmin && (
            <button
              onClick={generate}
              disabled={generating}
              className="px-3 py-1.5 rounded-md text-sm bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate suggestions'}
            </button>
          )
        }
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-5">
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Reusable rules inferred from the user intents captured on your tool calls. Applying one
          appends its guidance to the connector so future calls follow it.{' '}
          <Link href="/knowledge-graph" className="text-[var(--brand)] hover:underline">
            Back to graph
          </Link>
        </p>
        {status && <p className="text-xs text-[var(--muted-foreground)] mb-3">{status}</p>}

        {loading ? (
          <p className="text-[var(--muted-foreground)]">Loading…</p>
        ) : skills.length === 0 ? (
          <div className="border border-[var(--border)] rounded-lg p-6 text-center text-sm text-[var(--muted-foreground)]">
            No skill suggestions yet. Enable “Capture user intent” and “AI enrichment”, let some tool
            calls flow, then {isAdmin ? 'click “Generate suggestions”.' : 'ask an admin to generate them.'}
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((s) => (
              <SkillCard key={s.id} s={s} isAdmin={isAdmin} onAct={act} />
            ))}
            {resolved.length > 0 && (
              <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)] pt-4">
                Resolved
              </p>
            )}
            {resolved.map((s) => (
              <SkillCard key={s.id} s={s} isAdmin={isAdmin} onAct={act} />
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function SkillCard({
  s,
  isAdmin,
  onAct,
}: {
  s: KgSkill;
  isAdmin: boolean;
  onAct: (id: string, a: 'apply' | 'dismiss') => void;
}) {
  const muted = s.status !== 'pending';
  return (
    <div
      className={`border border-[var(--border)] rounded-lg p-4 ${muted ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{s.title}</h3>
          <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
            {s.connector?.name ? `${s.connector.name} · ` : ''}confidence {s.confidence.toFixed(2)}
            {s.evidenceCount ? ` · ${s.evidenceCount} example(s)` : ''}
            {muted ? ` · ${s.status}` : ''}
          </p>
        </div>
        {isAdmin && s.status === 'pending' && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => onAct(s.id, 'apply')}
              className="px-2.5 py-1 rounded text-xs bg-green-600 text-white"
            >
              Apply
            </button>
            <button
              onClick={() => onAct(s.id, 'dismiss')}
              className="px-2.5 py-1 rounded text-xs border border-[var(--border)]"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
      <p className="text-[13px] mt-2">
        <span className="text-[var(--muted-foreground)]">When:</span> {s.whenToUse}
      </p>
      <p className="text-[13px] mt-1">
        <span className="text-[var(--muted-foreground)]">Do:</span> {s.instruction}
      </p>
    </div>
  );
}
