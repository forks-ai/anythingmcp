'use client';

import { useMemo, useRef, useState } from 'react';
import type { KgNode, KgEdge } from '@/lib/api';

const NODE_PALETTE = [
  '#6366f1', '#16a34a', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6',
  '#ef4444', '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#d946ef',
];

const EDGE_STYLE: Record<string, { color: string; dashed?: boolean; arrow?: boolean }> = {
  references: { color: '#6366f1', arrow: true },
  produces_consumes: { color: '#16a34a', arrow: true },
  parent_child: { color: '#94a3b8', arrow: true },
  same_identity: { color: '#f59e0b', dashed: true },
};

interface Pos {
  x: number;
  y: number;
}

interface Props {
  nodes: KgNode[];
  edges: KgEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
}

/** Deterministic cluster layout: one circular cluster per connector, clusters on a grid. */
function layout(nodes: KgNode[]): { pos: Map<string, Pos>; colorByConnector: Map<string, string> } {
  const byConnector = new Map<string, KgNode[]>();
  for (const n of nodes) {
    const list = byConnector.get(n.connectorId) ?? [];
    list.push(n);
    byConnector.set(n.connectorId, list);
  }
  const connectorIds = [...byConnector.keys()].sort();
  const colorByConnector = new Map(
    connectorIds.map((id, i) => [id, NODE_PALETTE[i % NODE_PALETTE.length]]),
  );

  const pos = new Map<string, Pos>();
  const cols = Math.max(1, Math.ceil(Math.sqrt(connectorIds.length)));
  const CELL = 520;
  connectorIds.forEach((cid, ci) => {
    const cx = (ci % cols) * CELL + CELL / 2;
    const cy = Math.floor(ci / cols) * CELL + CELL / 2;
    const group = byConnector.get(cid)!;
    const radius = Math.min(190, 60 + group.length * 14);
    group.forEach((node, i) => {
      if (group.length === 1) {
        pos.set(node.id, { x: cx, y: cy });
      } else {
        const angle = (i / group.length) * Math.PI * 2 - Math.PI / 2;
        pos.set(node.id, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        });
      }
    });
  });
  return { pos, colorByConnector };
}

export function KgGraph({ nodes, edges, selectedNodeId, onSelectNode, onSelectEdge }: Props) {
  const { pos, colorByConnector } = useMemo(() => layout(nodes), [nodes]);

  const bounds = useMemo(() => {
    const xs = [...pos.values()].map((p) => p.x);
    const ys = [...pos.values()].map((p) => p.y);
    if (!xs.length) return { x: 0, y: 0, w: 800, h: 600 };
    const pad = 120;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX + pad,
      h: Math.max(...ys) - minY + pad,
    };
  }, [pos]);

  const [view, setView] = useState(bounds);
  // Re-fit when the node set changes.
  const fitKey = `${nodes.length}:${bounds.x}:${bounds.y}:${bounds.w}:${bounds.h}`;
  const lastFit = useRef('');
  if (lastFit.current !== fitKey) {
    lastFit.current = fitKey;
    queueMicrotask(() => setView(bounds));
  }

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    setView((v) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const px = rect ? (e.clientX - rect.left) / rect.width : 0.5;
      const py = rect ? (e.clientY - rect.top) / rect.height : 0.5;
      const nw = Math.min(12000, Math.max(120, v.w * factor));
      const nh = Math.min(12000, Math.max(90, v.h * factor));
      return { x: v.x + (v.w - nw) * px, y: v.y + (v.h - nh) * py, w: nw, h: nh };
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = ((e.clientX - drag.current.x) / rect.width) * view.w;
    const dy = ((e.clientY - drag.current.y) / rect.height) * view.h;
    setView((v) => ({ ...v, x: drag.current!.vx - dx, y: drag.current!.vy - dy }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="w-full h-full cursor-grab active:cursor-grabbing select-none"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onClick={() => onSelectNode(null)}
    >
      <defs>
        {Object.entries(EDGE_STYLE)
          .filter(([, s]) => s.arrow)
          .map(([kind, s]) => (
            <marker
              key={kind}
              id={`arrow-${kind}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={s.color} />
            </marker>
          ))}
      </defs>

      {/* Edges */}
      {edges.map((edge) => {
        const a = pos.get(edge.sourceNodeId);
        const b = pos.get(edge.targetNodeId);
        if (!a || !b) return null;
        const style = EDGE_STYLE[edge.kind] ?? EDGE_STYLE.references;
        const opacity = 0.25 + Math.min(0.7, edge.confidence) * 0.75;
        return (
          <line
            key={edge.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={style.color}
            strokeWidth={1 + edge.confidence * 2.5}
            strokeOpacity={opacity}
            strokeDasharray={style.dashed ? '6 5' : undefined}
            markerEnd={style.arrow ? `url(#arrow-${edge.kind})` : undefined}
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEdge(edge.id);
            }}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => {
        const p = pos.get(node.id);
        if (!p) return null;
        const color = colorByConnector.get(node.connectorId) ?? '#6366f1';
        const selected = node.id === selectedNodeId;
        const r = selected ? 13 : 9;
        return (
          <g
            key={node.id}
            transform={`translate(${p.x} ${p.y})`}
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectNode(node.id);
            }}
          >
            <circle
              r={r}
              fill={color}
              stroke={selected ? '#111827' : 'white'}
              strokeWidth={selected ? 3 : 1.5}
              fillOpacity={node.source === 'OBSERVED' ? 1 : 0.85}
            />
            <text
              x={0}
              y={r + 13}
              textAnchor="middle"
              fontSize="12"
              fontWeight={selected ? 700 : 500}
              fill="#1f2937"
              style={{ pointerEvents: 'none' }}
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
