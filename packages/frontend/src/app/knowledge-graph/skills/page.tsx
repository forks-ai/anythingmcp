'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import {
  knowledgeGraph,
  mcpServers as mcpServersApi,
  connectors as connectorsApi,
  type KgSkill,
} from '@/lib/api';
import { NavBar } from '@/components/nav-bar';
import { Footer } from '@/components/footer';

const PAGE_SIZE = 25;

const TABS: Array<{ key: string; label: string; countKey: 'pending' | 'applied' | 'dismissed' | null }> = [
  { key: '', label: 'All', countKey: null },
  { key: 'pending', label: 'Suggested', countKey: 'pending' },
  { key: 'applied', label: 'Active', countKey: 'applied' },
  { key: 'dismissed', label: 'Dismissed', countKey: 'dismissed' },
];

export default function SkillsPage() {
  const { token, user } = useAuth();
  const [items, setItems] = useState<KgSkill[]>([]);
  const [counts, setCounts] = useState({ pending: 0, applied: 0, dismissed: 0 });
  const [total, setTotal] = useState(0);
  const [servers, setServers] = useState<Array<{ id: string; name: string }>>([]);
  const [connectorList, setConnectorList] = useState<Array<{ id: string; name: string }>>([]);
  const [target, setTarget] = useState<string>(''); // '' = connectors, else mcpServerId
  const [statusFilter, setStatusFilter] = useState<string>(''); // tab
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [status, setStatus] = useState('');
  const isAdmin = user?.role === 'ADMIN';
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    knowledgeGraph.skills
      .list(token, {
        status: statusFilter || undefined,
        q: debouncedQuery || undefined,
        take: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      })
      .then((r) => {
        setItems(r.items);
        setCounts(r.counts);
        setTotal(r.total);
      })
      .catch((e) => setStatus(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, statusFilter, debouncedQuery, page]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    if (!token) return;
    mcpServersApi.list(token).then((s: any[]) => setServers(s.map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
    connectorsApi.list(token).then((c: any[]) => setConnectorList(c.map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
  }, [token]);

  // Debounce the search box → commit to debouncedQuery (which load depends on)
  const onSearch = (v: string) => {
    setQuery(v);
    setPage(0);
  };
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setDebouncedQuery(query), 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  const generate = async () => {
    if (!token) return;
    setGenerating(true);
    setStatus(target ? 'Analyzing the server context…' : 'Analyzing captured intents…');
    try {
      const r = await knowledgeGraph.skills.generate(token, target || undefined);
      setStatus(r.created > 0 ? `Generated ${r.created} suggestion(s).` : 'No new patterns found yet.');
      setPage(0);
      load();
    } catch (e: any) {
      setStatus(e.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const consolidate = async () => {
    if (!token) return;
    setConsolidating(true);
    setStatus('Consolidating active skills with AI…');
    try {
      const r = await knowledgeGraph.skills.consolidate(token, target || undefined);
      setStatus(
        r.after < r.before
          ? `Consolidated ${r.before} active skills into ${r.after}.`
          : `Nothing to consolidate (${r.before} active skill(s)).`,
      );
      load();
    } catch (e: any) {
      setStatus(e.message || 'Consolidation failed');
    } finally {
      setConsolidating(false);
    }
  };

  const onChanged = () => load();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const everEmpty = counts.pending + counts.applied + counts.dismissed === 0;

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
                title="Scope for Generate / Consolidate"
              >
                <option value="">From connectors</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    For server: {s.name}
                  </option>
                ))}
              </select>
              <button
                onClick={consolidate}
                disabled={consolidating || generating}
                title="Merge the active skills in this scope into fewer, non-redundant ones"
                className="px-3 py-1.5 rounded-md text-sm border border-[var(--border)] hover:bg-[var(--accent)] disabled:opacity-50"
              >
                {consolidating ? 'Consolidating…' : 'Consolidate with AI'}
              </button>
              <button
                onClick={generate}
                disabled={generating || consolidating}
                className="px-3 py-1.5 rounded-md text-sm border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand-light)] disabled:opacity-50"
              >
                {generating ? 'Generating…' : 'Generate with AI'}
              </button>
              <button
                onClick={() => setShowNew((v) => !v)}
                className="px-3 py-1.5 rounded-md text-sm bg-[var(--brand)] text-white hover:opacity-90"
              >
                {showNew ? 'Close' : '+ New skill'}
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

        {isAdmin && showNew && (
          <NewSkillForm
            token={token!}
            servers={servers}
            connectors={connectorList}
            onCreated={() => {
              setShowNew(false);
              setStatus('Skill created (live for MCP).');
              setPage(0);
              load();
            }}
          />
        )}

        {everEmpty && !loading ? (
          <div className="border border-[var(--border)] rounded-lg p-6 text-center text-sm text-[var(--muted-foreground)]">
            No skills yet. Enable “Capture user intent” and “AI enrichment”, let some tool calls flow,
            then {isAdmin ? 'click “Generate with AI”.' : 'ask an admin to generate them.'}
          </div>
        ) : (
          <>
            {/* Status tabs with counts + search */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] p-0.5">
                {TABS.map((t) => {
                  const n = t.countKey ? counts[t.countKey] : counts.pending + counts.applied + counts.dismissed;
                  const activeTab = statusFilter === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => {
                        setStatusFilter(t.key);
                        setPage(0);
                      }}
                      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                        activeTab
                          ? 'bg-[var(--brand)] text-white'
                          : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)]'
                      }`}
                    >
                      {t.label}
                      <span className={`ml-1.5 text-xs ${activeTab ? 'opacity-90' : 'opacity-70'}`}>{n}</span>
                    </button>
                  );
                })}
              </div>
              <input
                value={query}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search skills…"
                className="px-3 py-1.5 rounded-md text-sm bg-[var(--background)] border border-[var(--border)] w-full sm:w-56"
              />
            </div>

            {loading ? (
              <p className="text-[var(--muted-foreground)]">Loading…</p>
            ) : items.length === 0 ? (
              <div className="border border-[var(--border)] rounded-lg p-6 text-center text-sm text-[var(--muted-foreground)]">
                No skills match this filter.
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((s) => (
                  <SkillCard key={s.id} s={s} isAdmin={isAdmin} token={token!} onChanged={onChanged} />
                ))}
              </div>
            )}

            {/* Pagination */}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-5 text-sm">
                <span className="text-[var(--muted-foreground)]">
                  {from}–{to} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="px-3 py-1.5 rounded-md border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--accent)]"
                  >
                    ← Prev
                  </button>
                  <span className="text-[var(--muted-foreground)]">
                    Page {page + 1} / {totalPages}
                  </span>
                  <button
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1.5 rounded-md border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--accent)]"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
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

function NewSkillForm({
  token,
  servers,
  connectors,
  onCreated,
}: {
  token: string;
  servers: Array<{ id: string; name: string }>;
  connectors: Array<{ id: string; name: string }>;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [whenToUse, setWhenToUse] = useState('');
  const [instruction, setInstruction] = useState('');
  const [scope, setScope] = useState(''); // "srv:<id>" | "con:<id>" | ""
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = title.trim() && instruction.trim() && scope;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    setErr('');
    const body: any = { title, whenToUse, instruction };
    if (scope.startsWith('srv:')) body.mcpServerId = scope.slice(4);
    else if (scope.startsWith('con:')) body.connectorId = scope.slice(4);
    try {
      await knowledgeGraph.skills.create(token, body);
      setTitle('');
      setWhenToUse('');
      setInstruction('');
      setScope('');
      onCreated();
    } catch (e: any) {
      setErr(e.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-[var(--border)] rounded-lg p-4 mb-5 space-y-2 bg-[var(--accent)]/40">
      <p className="font-medium text-sm">New skill</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (e.g. Always confirm the delivery address)"
        className="w-full px-2 py-1.5 rounded border border-[var(--border)] text-sm"
      />
      <input
        value={whenToUse}
        onChange={(e) => setWhenToUse(e.target.value)}
        placeholder="When to use (optional)"
        className="w-full px-2 py-1.5 rounded border border-[var(--border)] text-sm"
      />
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={3}
        placeholder="Instruction for the agent (imperative guidance)"
        className="w-full px-2 py-1.5 rounded border border-[var(--border)] text-sm"
      />
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        className="w-full px-2 py-1.5 rounded border border-[var(--border)] text-sm bg-white"
      >
        <option value="">Scope… (where this skill applies)</option>
        {servers.length > 0 && (
          <optgroup label="MCP servers">
            {servers.map((s) => (
              <option key={s.id} value={`srv:${s.id}`}>Server: {s.name}</option>
            ))}
          </optgroup>
        )}
        {connectors.length > 0 && (
          <optgroup label="Connectors">
            {connectors.map((c) => (
              <option key={c.id} value={`con:${c.id}`}>Connector: {c.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      {err && <p className="text-xs text-[var(--destructive)]">{err}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={!valid || saving}
          className="px-3 py-1.5 rounded text-sm bg-[var(--brand)] text-white disabled:opacity-40"
        >
          {saving ? 'Creating…' : 'Create skill'}
        </button>
        <span className="text-xs text-[var(--muted-foreground)]">
          Created as active → immediately available to the MCP server.
        </span>
      </div>
    </div>
  );
}
