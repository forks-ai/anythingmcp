'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { knowledgeGraph, mcpServers as mcpServersApi, type KgSkill } from '@/lib/api';
import { NavBar } from '@/components/nav-bar';
import { Footer } from '@/components/footer';

export default function SkillsPage() {
  const { token, user } = useAuth();
  const [skills, setSkills] = useState<KgSkill[]>([]);
  const [servers, setServers] = useState<Array<{ id: string; name: string }>>([]);
  const [target, setTarget] = useState<string>(''); // '' = connectors, else mcpServerId
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
  useEffect(() => {
    if (!token) return;
    mcpServersApi.list(token).then((s: any[]) => setServers(s.map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
  }, [token]);

  const generate = async () => {
    if (!token) return;
    setGenerating(true);
    setStatus(target ? 'Analyzing the server context…' : 'Analyzing captured intents…');
    try {
      const r = await knowledgeGraph.skills.generate(token, target || undefined);
      setStatus(r.created > 0 ? `Generated ${r.created} suggestion(s).` : 'No new patterns found yet.');
      load();
    } catch (e: any) {
      setStatus(e.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const onChanged = () => load();

  const pending = skills.filter((s) => s.status === 'pending');
  const active = skills.filter((s) => s.status === 'applied');
  const dismissed = skills.filter((s) => s.status === 'dismissed');

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      <NavBar
        breadcrumbs={[{ label: 'Knowledge Graph', href: '/knowledge-graph' }]}
        title="Skills"
        actions={
          isAdmin && (
            <div className="flex items-center gap-2">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="px-2 py-1.5 rounded-md text-sm bg-[var(--background)] border border-[var(--border)]"
              >
                <option value="">From connectors</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    For server: {s.name}
                  </option>
                ))}
              </select>
              <button
                onClick={generate}
                disabled={generating}
                className="px-3 py-1.5 rounded-md text-sm bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          )
        }
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-5">
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Reusable rules inferred from the user intents captured on your tool calls — per connector or
          for a whole MCP server (combined context). Active skills are composed into the server&apos;s
          instructions automatically.{' '}
          <Link href="/knowledge-graph" className="text-[var(--brand)] hover:underline">
            Back to graph
          </Link>
        </p>
        {status && <p className="text-xs text-[var(--muted-foreground)] mb-3">{status}</p>}

        {loading ? (
          <p className="text-[var(--muted-foreground)]">Loading…</p>
        ) : skills.length === 0 ? (
          <div className="border border-[var(--border)] rounded-lg p-6 text-center text-sm text-[var(--muted-foreground)]">
            No skills yet. Enable “Capture user intent” and “AI enrichment”, let some tool calls flow,
            then {isAdmin ? 'click “Generate”.' : 'ask an admin to generate them.'}
          </div>
        ) : (
          <div className="space-y-5">
            <Section title="Suggested" items={pending} isAdmin={isAdmin} token={token!} onChanged={onChanged} />
            <Section title="Active" items={active} isAdmin={isAdmin} token={token!} onChanged={onChanged} />
            <Section title="Dismissed" items={dismissed} isAdmin={isAdmin} token={token!} onChanged={onChanged} />
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Section({
  title,
  items,
  isAdmin,
  token,
  onChanged,
}: {
  title: string;
  items: KgSkill[];
  isAdmin: boolean;
  token: string;
  onChanged: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">{title}</p>
      {items.map((s) => (
        <SkillCard key={s.id} s={s} isAdmin={isAdmin} token={token} onChanged={onChanged} />
      ))}
    </div>
  );
}

function SkillCard({
  s,
  isAdmin,
  token,
  onChanged,
}: {
  s: KgSkill;
  isAdmin: boolean;
  token: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [whenToUse, setWhenToUse] = useState(s.whenToUse);
  const [instruction, setInstruction] = useState(s.instruction);
  const [busy, setBusy] = useState(false);

  const scope = s.mcpServer?.name
    ? `server: ${s.mcpServer.name}`
    : s.connector?.name
      ? `connector: ${s.connector.name}`
      : 'workspace';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="border border-[var(--border)] rounded-lg p-4 space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--background)]"
          placeholder="Title"
        />
        <input
          value={whenToUse}
          onChange={(e) => setWhenToUse(e.target.value)}
          className="w-full px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--background)]"
          placeholder="When to use"
        />
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          className="w-full px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--background)]"
          placeholder="Instruction"
        />
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await knowledgeGraph.skills.update(token, s.id, { title, whenToUse, instruction });
                setEditing(false);
              })
            }
            className="px-2.5 py-1 rounded text-xs bg-[var(--brand)] text-white"
          >
            Save
          </button>
          <button onClick={() => setEditing(false)} className="px-2.5 py-1 rounded text-xs border border-[var(--border)]">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`border border-[var(--border)] rounded-lg p-4 ${s.status === 'dismissed' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{s.title}</h3>
          <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
            {scope} · confidence {s.confidence.toFixed(2)}
            {s.evidenceCount ? ` · ${s.evidenceCount} example(s)` : ''}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-1.5 flex-shrink-0">
            {s.status !== 'applied' && (
              <button
                disabled={busy}
                onClick={() => run(() => knowledgeGraph.skills.apply(token, s.id))}
                className="px-2 py-1 rounded text-xs bg-green-600 text-white"
              >
                {s.status === 'dismissed' ? 'Activate' : 'Apply'}
              </button>
            )}
            {s.status === 'applied' && (
              <button
                disabled={busy}
                onClick={() => run(() => knowledgeGraph.skills.dismiss(token, s.id))}
                className="px-2 py-1 rounded text-xs border border-[var(--border)]"
              >
                Deactivate
              </button>
            )}
            <button onClick={() => setEditing(true)} className="px-2 py-1 rounded text-xs border border-[var(--border)]">
              Edit
            </button>
            <button
              disabled={busy}
              onClick={() => run(() => knowledgeGraph.skills.remove(token, s.id))}
              className="px-2 py-1 rounded text-xs text-[var(--destructive)] border border-[var(--border)]"
            >
              Delete
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
