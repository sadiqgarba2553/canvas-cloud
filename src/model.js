export const COLORS = {
  note: ["#fff0ac", "#c6a951"],
  rect: ["#e8e1f5", "#967cba"],
  ellipse: ["#dceee9", "#81a998"],
  diamond: ["#fce3db", "#c58e7d"],
  text: ["#ffffff", "#ffffff"],
};
export const uid = () => crypto.randomUUID();
export function createBoard(name = "Untitled board") {
  return {
    version: 1,
    id: uid(),
    name,
    updatedAt: Date.now(),
    nodes: [],
    view: { x: 0, y: 0, scale: 1 },
  };
}
export function bounds(nodes) {
  const boxes = nodes
    .filter((n) => n.type !== "connector")
    .map((n) =>
      n.type === "pen"
        ? {
            x: Math.min(...n.points.map((p) => p.x)),
            y: Math.min(...n.points.map((p) => p.y)),
            r: Math.max(...n.points.map((p) => p.x)),
            b: Math.max(...n.points.map((p) => p.y)),
          }
        : { x: n.x, y: n.y, r: n.x + n.w, b: n.y + n.h },
    );
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.r)) - x,
    h: Math.max(...boxes.map((b) => b.b)) - y,
  };
}
export function center(node) {
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
}
export function connectionEndpoints(a, b) {
  function edge(node, toward) {
    const origin = center(node),
      dx = toward.x - origin.x,
      dy = toward.y - origin.y;
    if (!dx && !dy) return origin;
    const rx = node.w / 2,
      ry = node.h / 2;
    const divisor =
      node.type === "ellipse"
        ? Math.hypot(dx / rx, dy / ry)
        : node.type === "diamond"
          ? Math.abs(dx / rx) + Math.abs(dy / ry)
          : Math.max(Math.abs(dx / rx), Math.abs(dy / ry));
    return { x: origin.x + dx / divisor, y: origin.y + dy / divisor };
  }
  return [edge(a, center(b)), edge(b, center(a))];
}
export function removeNode(board, id) {
  board.nodes = board.nodes.filter(
    (n) => n.id !== id && n.from !== id && n.to !== id,
  );
}
export function moveNode(node, dx, dy) {
  if (node.type === "pen")
    node.points = node.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  else {
    node.x += dx;
    node.y += dy;
  }
}
export function validateBoard(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 5000
  )
    throw Error("This is not a supported Canvas Cloud board.");
  const copy = structuredClone(value);
  copy.name = String(value.name || "Imported board").slice(0, 100);
  copy.id = uid();
  copy.view = { x: 0, y: 0, scale: 1 };
  const ids = new Set();
  for (const n of copy.nodes) {
    if (typeof n.id !== "string" || ids.has(n.id))
      throw Error("The board contains duplicate or missing object IDs.");
    ids.add(n.id);
    if (
      ![
        "note",
        "rect",
        "ellipse",
        "diamond",
        "text",
        "pen",
        "connector",
        "image",
      ].includes(n.type)
    )
      throw Error("Unsupported object type.");
    if (n.type === "connector") {
      n.stroke = /^#[0-9a-f]{6}$/i.test(n.stroke) ? n.stroke : "#777084";
      continue;
    }
    if (n.type === "pen") {
      if (
        !Array.isArray(n.points) ||
        n.points.length < 2 ||
        n.points.length > 10000 ||
        n.points.some(
          (p) =>
            ![p.x, p.y].every((v) => Number.isFinite(v) && Math.abs(v) < 1e6),
        )
      )
        throw Error("Invalid drawing points.");
    } else if (
      ![n.x, n.y, n.w, n.h].every(
        (v) => Number.isFinite(v) && Math.abs(v) < 1e6,
      ) ||
      n.w < 5 ||
      n.h < 5
    )
      throw Error("Invalid object dimensions.");
    if (
      n.type === "image" &&
      (!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(n.src) ||
        n.src.length > 20000000)
    )
      throw Error("Unsupported image data.");
    n.text = String(n.text || "").slice(0, 50000);
    n.fill = /^#[0-9a-f]{6}$/i.test(n.fill) ? n.fill : "#eee7f7";
    n.stroke = /^#[0-9a-f]{6}$/i.test(n.stroke) ? n.stroke : "#967cba";
    n.fontSize = [16, 20, 24, 32, 48, 64].includes(n.fontSize)
      ? n.fontSize
      : 20;
  }
  const anchors = new Set(
    copy.nodes
      .filter((n) => !["pen", "connector"].includes(n.type))
      .map((n) => n.id),
  );
  copy.nodes = copy.nodes.filter(
    (n) =>
      n.type !== "connector" ||
      (anchors.has(n.from) && anchors.has(n.to) && n.from !== n.to),
  );
  return copy;
}
export class History {
  constructor() {
    this.past = [];
    this.future = [];
  }
  push(board) {
    this.past.push(structuredClone(board));
    if (this.past.length > 80) this.past.shift();
    this.future = [];
  }
  undo(board) {
    if (!this.past.length) return board;
    this.future.push(structuredClone(board));
    return this.past.pop();
  }
  redo(board) {
    if (!this.future.length) return board;
    this.past.push(structuredClone(board));
    return this.future.pop();
  }
}
