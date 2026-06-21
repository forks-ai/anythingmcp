'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { knowledgeGraph, type KgNode, type KgEdge } from '@/lib/api';
import { NavBar } from '@/components/nav-bar';
import { Footer } from '@/components/footer';
import { KgGraph } from '@/components/kg-graph';

const SOURCES = ['STATIC', 'OBSERVED', 'MANUAL', 'LLM'] as const;
const KIND_LABEL: Record<string, string> = {
  references: 'references',
  produces_consumes: 'data flow',
  parent_child: 'parent / child',
  same_identity: 'same identity',
  related: 'related',
};
const KIND_OPTIONS = [
  'references',
  'produces_consumes',
  'same_identity',
  'parent_child',
  'related',
] as const;

export default function KnowledgeGraphPage() {
  const { token, user } = useAuth();
  const [nodes, setNodes] = useState<KgNode[]>([]);
  const [edges, setEdges] = useState<KgEdge[]>([]);
  const [lastBuiltAt, setLastBuiltAt] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Filters
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set(SOURCES));
  const [showSuggested, setShowSuggested] = useState(true);
  const [minConfidence, setMinConfidence] = useState(0);

  const isAdmin = user?.role === 'ADMIN';

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    knowledgeGraph
      .get(token)
      .then((g) => {
        setNodes(g.nodes);
        setEdges(g.edges);
        setLastBuiltAt(g.lastBuiltAt);
        setEnabled(g.enabled);
      })
      .catch((e) => setStatus(e.message || 'Failed to load graph'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    knowledgeGraph.getSettings(token).then((s) => setLlmEnabled(s.llmEnabled)).catch(() => {});
  }, [token]);

  const enrich = async () => {
    if (!token) return;
    setEnriching(true);
    setStatus('Asking the model for relationship suggestions…');
    try {
      const r = await knowledgeGraph.enrich(token);
      setStatus(
        r.skipped
          ? 'No changes since the last enrichment.'
          : `AI suggested ${r.suggested} relationship(s)${r.model ? ` (${r.model})` : ''}. Review them in the “suggested” layer.`,
      );
      load();
    } catch (e: any) {
      setStatus(e.message || 'Enrichment failed');
    } finally {
      setEnriching(false);
    }
  };

  const rebuild = async () => {
    if (!token) return;
    setRebuilding(true);
    setStatus('Rebuilding graph…');
    try {
      const r = await knowledgeGraph.rebuild(token);
      setStatus(`Rebuilt: ${r.nodes} entities, ${r.edges} relationships from ${r.connectors} connectors.`);
      load();
    } catch (e: any) {
      setStatus(e.message || 'Rebuild failed');
    } finally {
      setRebuilding(false);
    }
  };

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const visibleEdges = useMemo(
    () =>
      edges.filter((e) => {
        if (!activeSources.has(e.source)) return false;
        if (e.status === 'suggested' && !showSuggested) return false;
        if (e.confidence < minConfidence) return false;
        return true;
      }),
    [edges, activeSources, showSuggested, minConfidence],
  );

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : null;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : null;

  const nodeEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return visibleEdges.filter(
      (e) => e.sourceNodeId === selectedNodeId || e.targetNodeId === selectedNodeId,
    );
  }, [selectedNodeId, visibleEdges]);

  const toggleSource = (s: string) => {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const setEdgeStatus = async (id: string, st: 'active' | 'rejected') => {
    if (!token) return;
    await knowledgeGraph.setEdgeStatus(token, id, st);
    load();
    setSelectedEdgeId(null);
  };
  const deleteEdge = async (id: string) => {
    if (!token) return;
    await knowledgeGraph.deleteEdge(token, id);
    load();
    setSelectedEdgeId(null);
  };
  const saveEdge = async (
    id: string,
    body: { kind?: string; note?: string | null; status?: 'active' | 'rejected' | 'suggested' },
  ) => {
    if (!token) return;
    try {
      await knowledgeGraph.updateEdge(token, id, body);
      setStatus('Saved');
      load();
    } catch (e: any) {
      setStatus(e.message || 'Save failed');
    }
  };
  const saveNode = async (id: string, body: { label?: string; description?: string | null }) => {
    if (!token) return;
    try {
      await knowledgeGraph.updateNode(token, id, body);
      setStatus('Saved');
      load();
    } catch (e: any) {
      setStatus(e.message || 'Save failed');
    }
  };
  const createEdge = async (body: {
    sourceNodeId: string;
    targetNodeId: string;
    kind?: string;
    note?: string;
  }) => {
    if (!token) return;
    try {
      await knowledgeGraph.createEdge(token, body);
      setStatus('Connection added');
      load();
    } catch (e: any) {
      setStatus(e.message || 'Create failed');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      <NavBar
        title="Knowledge Graph"
        actions={
          isAdmin && enabled ? (
            <div className="flex items-center gap-2">
              {llmEnabled && (
                <button
                  onClick={enrich}
                  disabled={enriching || rebuilding}
                  className="px-3 py-1.5 rounded-md text-sm border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand-light)] disabled:opacity-50"
                >
                  {enriching ? 'Enriching…' : 'Enrich with AI'}
                </button>
              )}
              <button
                onClick={rebuild}
                disabled={rebuilding || enriching}
                className="px-3 py-1.5 rounded-md text-sm bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {rebuilding ? 'Rebuilding…' : 'Rebuild graph'}
              </button>
            </div>
          ) : undefined
        }
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-4">
        {/* Header / stats */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            {nodes.length} entities · {visibleEdges.length} relationships
            {lastBuiltAt && (
              <> · built {new Date(lastBuiltAt).toLocaleString()}</>
            )}
          </p>
          <div className="flex items-center gap-3">
            {status && <p className="text-xs text-[var(--muted-foreground)]">{status}</p>}
            <Link
              href="/knowledge-graph/skills"
              className="text-xs text-[var(--brand)] hover:underline whitespace-nowrap"
            >
              Skills →
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 mb-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[var(--muted-foreground)]">Layer:</span>
            {SOURCES.map((s) => (
              <button
                key={s}
                onClick={() => toggleSource(s)}
                className={`px-2 py-0.5 rounded text-xs border ${
                  activeSources.has(s)
                    ? 'bg-[var(--brand-light)] text-[var(--brand)] border-[var(--brand)]'
                    : 'text-[var(--muted-foreground)] border-[var(--border)]'
                }`}
              >
                {s.toLowerCase()}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showSuggested} onChange={(e) => setShowSuggested(e.target.checked)} />
            <span>show suggested</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[var(--muted-foreground)]">min confidence</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
            />
            <span className="tabular-nums w-8">{minConfidence.toFixed(2)}</span>
          </label>
          <Legend />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          {/* Graph canvas */}
          <div className="border border-[var(--border)] rounded-lg bg-white overflow-hidden h-[68vh]">
            {loading ? (
              <div className="h-full flex items-center justify-center text-[var(--muted-foreground)]">
                Loading graph…
              </div>
            ) : !enabled ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                <p className="font-medium">The Knowledge Graph is disabled for this workspace.</p>
                <p className="text-[var(--muted-foreground)] text-sm">
                  An admin can enable it in Settings → Organization → Features.
                </p>
              </div>
            ) : nodes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                <p className="text-[var(--muted-foreground)]">
                  No graph yet. {isAdmin ? 'Click “Rebuild graph” to generate it from your connectors and usage.' : 'Ask an admin to build the graph.'}
                </p>
              </div>
            ) : (
              <KgGraph
                nodes={nodes}
                edges={visibleEdges}
                selectedNodeId={selectedNodeId}
                onSelectNode={(id) => {
                  setSelectedNodeId(id);
                  setSelectedEdgeId(null);
                }}
                onSelectEdge={(id) => {
                  setSelectedEdgeId(id);
                  setSelectedNodeId(null);
                }}
              />
            )}
          </div>

          {/* Side panel */}
          <aside className="border border-[var(--border)] rounded-lg p-4 h-[68vh] overflow-y-auto text-sm">
            {selectedNode ? (
              <NodePanel
                key={selectedNode.id}
                node={selectedNode}
                edges={nodeEdges}
                nodeById={nodeById}
                isAdmin={isAdmin}
                onSave={(body) => saveNode(selectedNode.id, body)}
              />
            ) : selectedEdge ? (
              <EdgePanel
                key={selectedEdge.id}
                edge={selectedEdge}
                nodeById={nodeById}
                isAdmin={isAdmin}
                onConfirm={() => setEdgeStatus(selectedEdge.id, 'active')}
                onReject={() => setEdgeStatus(selectedEdge.id, 'rejected')}
                onDelete={() => deleteEdge(selectedEdge.id)}
                onSave={(body) => saveEdge(selectedEdge.id, body)}
              />
            ) : (
              <div className="text-[var(--muted-foreground)]">
                <p className="font-medium text-[var(--foreground)] mb-1">Explore</p>
                <p>Click an entity to see its fields and links, or an edge to inspect (and edit) a relationship.</p>
                {isAdmin && nodes.length >= 2 && (
                  <AddEdgeForm nodes={nodes} onCreate={createEdge} />
                )}
              </div>
            )}
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Legend() {
  const items = [
    ['references', '#6366f1'],
    ['data flow', '#16a34a'],
    ['parent / child', '#94a3b8'],
    ['same identity', '#f59e0b'],
    ['related', '#a855f7'],
  ] as const;
  return (
    <div className="flex items-center gap-3 ml-auto">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
          <span className="inline-block w-3 h-0.5" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function NodePanel({
  node,
  edges,
  nodeById,
  isAdmin,
  onSave,
}: {
  node: KgNode;
  edges: KgEdge[];
  nodeById: Map<string, KgNode>;
  isAdmin: boolean;
  onSave: (body: { label?: string; description?: string | null }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(node.label);
  const [description, setDescription] = useState(node.description ?? '');
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {node.connectorName ?? 'connector'} · {String(node.source).toLowerCase()}
      </p>

      {editing ? (
        <div className="mb-3 space-y-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-2 py-1 rounded border border-[var(--border)] text-sm"
            placeholder="Label"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-2 py-1 rounded border border-[var(--border)] text-[13px]"
            placeholder="Description (shown to AI clients reading the graph)"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                onSave({ label, description: description.trim() ? description : null });
                setEditing(false);
              }}
              className="px-2.5 py-1 rounded text-xs bg-[var(--brand)] text-white"
            >
              Save
            </button>
            <button
              onClick={() => {
                setLabel(node.label);
                setDescription(node.description ?? '');
                setEditing(false);
              }}
              className="px-2.5 py-1 rounded text-xs border border-[var(--border)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{node.label}</h2>
            {node.description && (
              <p className="text-[13px] text-[var(--muted-foreground)] mt-0.5">{node.description}</p>
            )}
          </div>
          {isAdmin && (
            <button
              onClick={() => setEditing(true)}
              className="shrink-0 px-2 py-0.5 rounded text-xs border border-[var(--border)]"
            >
              Edit
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-[var(--muted-foreground)] mb-1">Fields ({node.fields.length})</p>
      <div className="flex flex-wrap gap-1 mb-3">
        {node.fields.slice(0, 40).map((f) => (
          <span key={f.name} className="px-1.5 py-0.5 rounded bg-[var(--accent)] text-[11px]">
            {f.name}
          </span>
        ))}
        {node.fields.length === 0 && <span className="text-[var(--muted-foreground)]">—</span>}
      </div>

      <p className="text-xs text-[var(--muted-foreground)] mb-1">Relationships ({edges.length})</p>
      <ul className="space-y-1">
        {edges.map((e) => {
          const other = e.sourceNodeId === node.id ? nodeById.get(e.targetNodeId) : nodeById.get(e.sourceNodeId);
          const dir = e.sourceNodeId === node.id ? '→' : '←';
          return (
            <li key={e.id} className="text-[13px]">
              <span className="text-[var(--muted-foreground)]">{dir}</span> {other?.label ?? '?'}{' '}
              <span className="text-[10px] text-[var(--muted-foreground)]">
                ({KIND_LABEL[e.kind] ?? e.kind}{e.matchKey ? ` · ${e.matchKey}` : ''})
              </span>
            </li>
          );
        })}
        {edges.length === 0 && <li className="text-[var(--muted-foreground)]">—</li>}
      </ul>

      <p className="text-xs text-[var(--muted-foreground)] mt-3 mb-1">Tools ({node.toolNames.length})</p>
      <div className="flex flex-wrap gap-1">
        {node.toolNames.slice(0, 30).map((t) => (
          <span key={t} className="px-1.5 py-0.5 rounded bg-[var(--accent)] text-[10px] font-mono">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function EdgePanel({
  edge,
  nodeById,
  isAdmin,
  onConfirm,
  onReject,
  onDelete,
  onSave,
}: {
  edge: KgEdge;
  nodeById: Map<string, KgNode>;
  isAdmin: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onDelete: () => void;
  onSave: (body: { kind?: string; note?: string | null }) => void;
}) {
  const src = nodeById.get(edge.sourceNodeId);
  const tgt = nodeById.get(edge.targetNodeId);
  const [kind, setKind] = useState(edge.kind);
  const [note, setNote] = useState(edge.note ?? '');
  const dirty = kind !== edge.kind || (note ?? '') !== (edge.note ?? '');
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {String(edge.source).toLowerCase()} · {edge.status}
      </p>
      <h2 className="text-base font-semibold mb-2">
        {src?.label ?? '?'} <span className="text-[var(--muted-foreground)]">{KIND_LABEL[edge.kind] ?? edge.kind}</span> {tgt?.label ?? '?'}
      </h2>
      <dl className="space-y-1 text-[13px]">
        <Row k="Kind" v={KIND_LABEL[edge.kind] ?? edge.kind} />
        {edge.matchKey && <Row k="Match key" v={edge.matchKey} />}
        <Row k="Confidence" v={edge.confidence.toFixed(2)} />
        <Row k="Observations" v={String(edge.observations)} />
      </dl>

      {isAdmin ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-[var(--muted-foreground)]">
            Kind
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="mt-0.5 w-full px-2 py-1 rounded border border-[var(--border)] text-sm bg-white"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k] ?? k}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--muted-foreground)]">
            Description (served to AI clients)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-0.5 w-full px-2 py-1 rounded border border-[var(--border)] text-[13px]"
              placeholder="Why these entities are linked…"
            />
          </label>
          <button
            onClick={() => onSave({ kind, note: note.trim() ? note : null })}
            disabled={!dirty}
            className="px-2.5 py-1 rounded text-xs bg-[var(--brand)] text-white disabled:opacity-40"
          >
            Save changes
          </button>
        </div>
      ) : (
        edge.note && (
          <p className="mt-2 text-[13px] text-[var(--muted-foreground)] italic">
            &ldquo;{edge.note}&rdquo;
          </p>
        )
      )}

      {isAdmin && (
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-[var(--border)]">
          {edge.status === 'suggested' && (
            <button onClick={onConfirm} className="px-2.5 py-1 rounded text-xs bg-green-600 text-white">
              Confirm
            </button>
          )}
          <button onClick={onReject} className="px-2.5 py-1 rounded text-xs border border-[var(--border)]">
            Reject
          </button>
          <button onClick={onDelete} className="px-2.5 py-1 rounded text-xs text-[var(--destructive)] border border-[var(--border)]">
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function AddEdgeForm({
  nodes,
  onCreate,
}: {
  nodes: KgNode[];
  onCreate: (body: { sourceNodeId: string; targetNodeId: string; kind?: string; note?: string }) => void;
}) {
  const sorted = useMemo(
    () => [...nodes].sort((a, b) => a.label.localeCompare(b.label)),
    [nodes],
  );
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState<string>('references');
  const [note, setNote] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 px-2.5 py-1 rounded text-xs bg-[var(--brand)] text-white"
      >
        + Add connection
      </button>
    );
  }

  const valid = source && target && source !== target;
  return (
    <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-3">
      <p className="font-medium text-[var(--foreground)]">New connection</p>
      <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full px-2 py-1 rounded border border-[var(--border)] text-sm bg-white">
        <option value="">From entity…</option>
        {sorted.map((n) => (
          <option key={n.id} value={n.id}>{n.label} ({n.connectorName ?? '—'})</option>
        ))}
      </select>
      <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full px-2 py-1 rounded border border-[var(--border)] text-sm bg-white">
        {KIND_OPTIONS.map((k) => (
          <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>
        ))}
      </select>
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full px-2 py-1 rounded border border-[var(--border)] text-sm bg-white">
        <option value="">To entity…</option>
        {sorted.map((n) => (
          <option key={n.id} value={n.id}>{n.label} ({n.connectorName ?? '—'})</option>
        ))}
      </select>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Description (optional, served to AI clients)"
        className="w-full px-2 py-1 rounded border border-[var(--border)] text-[13px]"
      />
      <div className="flex gap-2">
        <button
          disabled={!valid}
          onClick={() => {
            onCreate({ sourceNodeId: source, targetNodeId: target, kind, note: note.trim() || undefined });
            setSource('');
            setTarget('');
            setNote('');
            setOpen(false);
          }}
          className="px-2.5 py-1 rounded text-xs bg-[var(--brand)] text-white disabled:opacity-40"
        >
          Add
        </button>
        <button onClick={() => setOpen(false)} className="px-2.5 py-1 rounded text-xs border border-[var(--border)]">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--muted-foreground)]">{k}</dt>
      <dd className="font-medium text-right">{v}</dd>
    </div>
  );
}
