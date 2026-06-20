'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { knowledgeGraph, type KgNode, type KgEdge } from '@/lib/api';
import { NavBar } from '@/components/nav-bar';
import { Footer } from '@/components/footer';
import { KgGraph } from '@/components/kg-graph';

const SOURCES = ['STATIC', 'OBSERVED', 'MANUAL'] as const;
const KIND_LABEL: Record<string, string> = {
  references: 'references',
  produces_consumes: 'data flow',
  parent_child: 'parent / child',
  same_identity: 'same identity',
};

export default function KnowledgeGraphPage() {
  const { token, user } = useAuth();
  const [nodes, setNodes] = useState<KgNode[]>([]);
  const [edges, setEdges] = useState<KgEdge[]>([]);
  const [lastBuiltAt, setLastBuiltAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
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
      })
      .catch((e) => setStatus(e.message || 'Failed to load graph'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <div className="min-h-screen flex flex-col bg-[var(--background)]">
      <NavBar
        title="Knowledge Graph"
        actions={
          isAdmin && (
            <button
              onClick={rebuild}
              disabled={rebuilding}
              className="px-3 py-1.5 rounded-md text-sm bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {rebuilding ? 'Rebuilding…' : 'Rebuild graph'}
            </button>
          )
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
          {status && <p className="text-xs text-[var(--muted-foreground)]">{status}</p>}
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
              <NodePanel node={selectedNode} edges={nodeEdges} nodeById={nodeById} />
            ) : selectedEdge ? (
              <EdgePanel
                edge={selectedEdge}
                nodeById={nodeById}
                isAdmin={isAdmin}
                onConfirm={() => setEdgeStatus(selectedEdge.id, 'active')}
                onReject={() => setEdgeStatus(selectedEdge.id, 'rejected')}
                onDelete={() => deleteEdge(selectedEdge.id)}
              />
            ) : (
              <div className="text-[var(--muted-foreground)]">
                <p className="font-medium text-[var(--foreground)] mb-1">Explore</p>
                <p>Click an entity to see its fields and links, or an edge to inspect (and confirm/reject) a relationship.</p>
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
}: {
  node: KgNode;
  edges: KgEdge[];
  nodeById: Map<string, KgNode>;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
        {node.connectorName ?? 'connector'} · {String(node.source).toLowerCase()}
      </p>
      <h2 className="text-lg font-semibold mb-2">{node.label}</h2>

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
}: {
  edge: KgEdge;
  nodeById: Map<string, KgNode>;
  isAdmin: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  const src = nodeById.get(edge.sourceNodeId);
  const tgt = nodeById.get(edge.targetNodeId);
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

      {isAdmin && (
        <div className="flex flex-wrap gap-2 mt-4">
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--muted-foreground)]">{k}</dt>
      <dd className="font-medium text-right">{v}</dd>
    </div>
  );
}
