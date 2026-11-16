/**
 * Layered left-to-right layout for the agent workflow graph.
 * Pure and dependency-free so it can be unit tested and rendered as plain SVG.
 */
export type GraphEdge = { from: string; to: string };
export type LaidOutNode = { id: string; layer: number; row: number; x: number; y: number };
export type Layout = {
  nodes: LaidOutNode[];
  /** Node ids that have no links at all (rendered separately). */
  unlinked: string[];
  width: number;
  height: number;
  layers: number;
};

export const NODE_W = 216;
export const NODE_H = 76;
const GAP_X = 136;
const GAP_Y = 28;
const PAD = 24;

export function layoutGraph(nodeIds: string[], edges: GraphEdge[]): Layout {
  const ids = new Set(nodeIds);
  const valid = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const linked = new Set<string>();
  for (const e of valid) {
    linked.add(e.from);
    linked.add(e.to);
  }
  const unlinked = nodeIds.filter((id) => !linked.has(id));
  const order = nodeIds.filter((id) => linked.has(id));

  // Drop back-edges (cycles) for layering only, via DFS in stable order.
  const out = new Map<string, string[]>();
  for (const id of order) out.set(id, []);
  for (const e of valid) out.get(e.from)!.push(e.to);
  const state = new Map<string, 0 | 1 | 2>();
  const forward: GraphEdge[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id)!) {
      const st = state.get(to) ?? 0;
      if (st === 1) continue; // back edge → ignored for layering
      forward.push({ from: id, to });
      if (st === 0) visit(to);
    }
    state.set(id, 2);
  };
  const hasIncoming = new Set(valid.map((e) => e.to));
  for (const id of [...order.filter((i) => !hasIncoming.has(i)), ...order]) if (!state.get(id)) visit(id);

  // Longest-path layering.
  const layer = new Map<string, number>(order.map((id) => [id, 0]));
  for (let pass = 0; pass < order.length; pass++) {
    let changed = false;
    for (const e of forward) {
      const want = layer.get(e.from)! + 1;
      if (layer.get(e.to)! < want) {
        layer.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Order within a layer by the average row of predecessors (barycenter), then by input order.
  const layers: string[][] = [];
  for (const id of order) (layers[layer.get(id)!] ??= []).push(id);
  const row = new Map<string, number>();
  layers.forEach((col, li) => {
    if (li > 0) {
      const bary = (id: string) => {
        const preds = forward.filter((e) => e.to === id && row.has(e.from)).map((e) => row.get(e.from)!);
        return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : Number.MAX_SAFE_INTEGER;
      };
      col.sort((a, b) => bary(a) - bary(b) || order.indexOf(a) - order.indexOf(b));
    }
    col.forEach((id, i) => row.set(id, i));
  });

  const maxRows = Math.max(1, ...layers.map((c) => c.length));
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y;
  const nodes: LaidOutNode[] = [];
  layers.forEach((col, li) => {
    const colH = col.length * NODE_H + (col.length - 1) * GAP_Y;
    const top = (height - colH) / 2;
    col.forEach((id, i) => nodes.push({ id, layer: li, row: i, x: PAD + li * (NODE_W + GAP_X), y: top + i * (NODE_H + GAP_Y) }));
  });
  const width = layers.length ? PAD * 2 + layers.length * NODE_W + (layers.length - 1) * GAP_X : 0;
  return { nodes, unlinked, width, height: layers.length ? height : 0, layers: layers.length };
}

/** Smooth horizontal connector between two nodes (handles right-to-left back edges). */
export function edgePath(a: LaidOutNode, b: LaidOutNode): { d: string; labelX: number; labelY: number } {
  const y1 = a.y + NODE_H / 2;
  const y2 = b.y + NODE_H / 2;
  if (b.x > a.x) {
    const x1 = a.x + NODE_W;
    const x2 = b.x;
    const mid = (x1 + x2) / 2;
    return { d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`, labelX: mid, labelY: (y1 + y2) / 2 };
  }
  // back edge or same layer: loop underneath
  const x1 = a.x + NODE_W / 2;
  const x2 = b.x + NODE_W / 2;
  const dip = Math.max(a.y, b.y) + NODE_H + 34;
  return {
    d: `M ${x1} ${a.y + NODE_H} C ${x1} ${dip}, ${x2} ${dip}, ${x2} ${b.y + NODE_H}`,
    labelX: (x1 + x2) / 2,
    labelY: dip - 10,
  };
}
