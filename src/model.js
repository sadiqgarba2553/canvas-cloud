export const COLORS = {
  note: ["#fff0ac", "#c6a951"],
  noteBlue: ["#d0e8ff", "#6ba4e8"],
  noteGreen: ["#d7f5dd", "#68b97d"],
  notePink: ["#ffd6e7", "#e578a8"],
  notePurple: ["#ede2fd", "#a47be4"],
  rect: ["#e8e1f5", "#967cba"],
  ellipse: ["#dceee9", "#81a998"],
  diamond: ["#fce3db", "#c58e7d"],
  triangle: ["#fef1d6", "#d89c3b"],
  star: ["#fef7cd", "#d1ab27"],
  hexagon: ["#e3ecfb", "#6d8ec5"],
  cloud: ["#e9f3fd", "#7caad9"],
  cylinder: ["#f0eaf7", "#987bb8"],
  callout: ["#fbf8d8", "#b8a642"],
  frame: ["#f6f5f9", "#c8c2d5"],
  table: ["#ffffff", "#cfc8dc"],
  kanban: ["#faf9fc", "#d3cce0"],
  text: ["#ffffff", "#ffffff"],
};

export const uid = () => crypto.randomUUID();

export function createBoard(name = "Untitled board") {
  return {
    version: 2,
    id: uid(),
    name,
    updatedAt: Date.now(),
    nodes: [],
    view: { x: 0, y: 0, scale: 1 },
    comments: [],
    groups: [],
    settings: {
      grid: true,
      gridSize: 20,
      snapToGrid: false,
      theme: "light",
      roughStyle: false,
    },
  };
}

export function bounds(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return null;
  const boxes = nodes
    .filter((n) => n.type !== "connector")
    .map((n) => {
      if (n.type === "pen" || n.type === "highlighter") {
        if (!n.points || !n.points.length) return null;
        return {
          x: Math.min(...n.points.map((p) => p.x)),
          y: Math.min(...n.points.map((p) => p.y)),
          r: Math.max(...n.points.map((p) => p.x)),
          b: Math.max(...n.points.map((p) => p.y)),
        };
      }
      return { x: n.x, y: n.y, r: n.x + (n.w || 0), b: n.y + (n.h || 0) };
    })
    .filter(Boolean);

  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(1, Math.max(...boxes.map((b) => b.r)) - x),
    h: Math.max(1, Math.max(...boxes.map((b) => b.b)) - y),
  };
}

export function center(node) {
  return { x: node.x + (node.w || 0) / 2, y: node.y + (node.h || 0) / 2 };
}

export function connectionEndpoints(a, b) {
  function edge(node, toward) {
    const origin = center(node);
    const dx = toward.x - origin.x;
    const dy = toward.y - origin.y;
    if (!dx && !dy) return origin;
    const rx = (node.w || 60) / 2;
    const ry = (node.h || 40) / 2;
    let divisor;
    if (node.type === "ellipse") {
      divisor = Math.hypot(dx / rx, dy / ry) || 1;
    } else if (node.type === "diamond") {
      divisor = (Math.abs(dx / rx) + Math.abs(dy / ry)) || 1;
    } else {
      divisor = Math.max(Math.abs(dx / rx), Math.abs(dy / ry)) || 1;
    }
    return { x: origin.x + dx / divisor, y: origin.y + dy / divisor };
  }
  return [edge(a, center(b)), edge(b, center(a))];
}

/**
 * Calculates elbow routing between two nodes
 */
export function elbowConnectionPath(a, b) {
  const ac = center(a), bc = center(b);
  const forward = bc.x >= ac.x;
  const start = { x: forward ? a.x + a.w : a.x, y: ac.y };
  const end = { x: forward ? b.x : b.x + b.w, y: bc.y };
  const midX = (start.x + end.x) / 2;
  return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
}

export function removeNode(board, id) {
  board.nodes = board.nodes.filter(
    (n) => n.id !== id && n.from !== id && n.to !== id,
  );
  if (board.comments) {
    board.comments = board.comments.filter((c) => c.nodeId !== id);
  }
}

export function moveNode(node, dx, dy) {
  if (node.type === "pen" || node.type === "highlighter") {
    node.points = node.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  } else {
    node.x += dx;
    node.y += dy;
  }
}

export function rotateNode(node, angleDelta) {
  node.rotation = ((node.rotation || 0) + angleDelta) % 360;
  if (node.rotation < 0) node.rotation += 360;
}

/**
 * Align an array of nodes
 * alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
 */
export function alignNodes(nodes, alignment) {
  const targetNodes = nodes.filter((n) => n.type !== "connector" && n.type !== "pen" && n.type !== "highlighter");
  if (targetNodes.length < 2) return;
  const b = bounds(targetNodes);
  if (!b) return;

  targetNodes.forEach((n) => {
    switch (alignment) {
      case "left":
        n.x = b.x;
        break;
      case "center":
        n.x = b.x + (b.w - n.w) / 2;
        break;
      case "right":
        n.x = b.x + b.w - n.w;
        break;
      case "top":
        n.y = b.y;
        break;
      case "middle":
        n.y = b.y + (b.h - n.h) / 2;
        break;
      case "bottom":
        n.y = b.y + b.h - n.h;
        break;
    }
  });
}

/**
 * Distribute nodes evenly
 * axis: 'horizontal' | 'vertical'
 */
export function distributeNodes(nodes, axis) {
  const targetNodes = nodes.filter((n) => n.type !== "connector" && n.type !== "pen" && n.type !== "highlighter");
  if (targetNodes.length < 3) return;

  if (axis === "horizontal") {
    targetNodes.sort((a, b) => a.x - b.x);
    const totalW = targetNodes.reduce((acc, n) => acc + n.w, 0);
    const first = targetNodes[0];
    const last = targetNodes[targetNodes.length - 1];
    const span = last.x + last.w - first.x;
    const gap = (span - totalW) / (targetNodes.length - 1);
    let curX = first.x;
    targetNodes.forEach((n) => {
      n.x = curX;
      curX += n.w + gap;
    });
  } else {
    targetNodes.sort((a, b) => a.y - b.y);
    const totalH = targetNodes.reduce((acc, n) => acc + n.h, 0);
    const first = targetNodes[0];
    const last = targetNodes[targetNodes.length - 1];
    const span = last.y + last.h - first.y;
    const gap = (span - totalH) / (targetNodes.length - 1);
    let curY = first.y;
    targetNodes.forEach((n) => {
      n.y = curY;
      curY += n.h + gap;
    });
  }
}

const SUPPORTED_TYPES = [
  "note",
  "rect",
  "ellipse",
  "diamond",
  "triangle",
  "star",
  "hexagon",
  "cloud",
  "cylinder",
  "callout",
  "text",
  "pen",
  "highlighter",
  "connector",
  "image",
  "frame",
  "table",
  "kanban",
];

export function validateBoard(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.nodes) || value.nodes.length > 10000) {
    throw Error("This is not a supported Canvas Cloud board.");
  }

  // Version check & migration: support version 1 and 2
  if (value.version !== 1 && value.version !== 2) {
    throw Error("This is not a supported Canvas Cloud board.");
  }

  const copy = structuredClone(value);
  copy.version = 2;
  copy.name = String(value.name || "Imported board").slice(0, 100);
  copy.id = uid();
  copy.view = value.view && [value.view.x, value.view.y, value.view.scale].every(Number.isFinite) && value.view.scale >= 0.1 && value.view.scale <= 5 ? { ...value.view } : { x: 0, y: 0, scale: 1 };
  copy.comments = (Array.isArray(value.comments) ? value.comments : []).slice(0, 1000).map(c => {
    if (!c || ![c.x, c.y].every(Number.isFinite) || typeof c.text !== 'string') throw Error('Invalid comment.');
    return { ...c, id: String(c.id || uid()).slice(0, 100), author: String(c.author || 'You').slice(0, 100), text: c.text.slice(0, 50000), replies: (Array.isArray(c.replies) ? c.replies : []).slice(0, 1000).map(r => ({ author: String(r?.author || 'You').slice(0, 100), text: String(r?.text || '').slice(0, 50000) })) };
  });
  copy.groups = Array.isArray(value.groups) ? value.groups : [];
  copy.settings = {
    grid: true,
    gridSize: 20,
    snapToGrid: false,
    theme: "light",
    ...value.settings,
  };

  const ids = new Set();
  const validNodes = [];

  for (const n of copy.nodes) {
    if (!n || typeof n.id !== "string" || ids.has(n.id)) {
      throw Error("The board contains duplicate or missing object IDs.");
    }
    ids.add(n.id);

    if (!SUPPORTED_TYPES.includes(n.type)) {
      throw Error("Unsupported object type: " + n.type);
    }

    if (n.type === "connector") {
      n.stroke = /^#[0-9a-f]{6}$/i.test(n.stroke) ? n.stroke : "#777084";
      n.routing = ["straight", "elbow", "curved"].includes(n.routing) ? n.routing : "straight";
      n.text = typeof n.text === "string" ? n.text.slice(0, 500) : "";
      validNodes.push(n);
      continue;
    }

    if (n.type === "pen" || n.type === "highlighter") {
      if (
        !Array.isArray(n.points) ||
        n.points.length < 2 ||
        n.points.length > 20000 ||
        n.points.some((p) => ![p.x, p.y].every((v) => Number.isFinite(v) && Math.abs(v) < 1e7))
      ) {
        throw Error("Invalid drawing points.");
      }
      n.stroke = /^#[0-9a-f]{6}$/i.test(n.stroke) ? n.stroke : (n.type === "highlighter" ? "#fbf27c" : "#70578d");
      n.strokeWidth = Number.isFinite(n.strokeWidth) ? Math.max(1, Math.min(60, n.strokeWidth)) : (n.type === "highlighter" ? 18 : 3);
      validNodes.push(n);
      continue;
    }

    if (![n.x, n.y, n.w, n.h].every((v) => Number.isFinite(v) && Math.abs(v) < 1e7) || n.w < 5 || n.h < 5) {
      throw Error("Invalid object dimensions.");
    }

    if (n.type === "image") {
      if (
        typeof n.src !== "string" ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(n.src) ||
        n.src.length > 25000000
      ) {
        throw Error("Unsupported image data.");
      }
    }

    n.text = String(n.text || "").slice(0, 50000);
    n.fill = /^#[0-9a-f]{6}$/i.test(n.fill) ? n.fill : (n.fill === "transparent" ? "transparent" : "#eee7f7");
    n.stroke = /^#[0-9a-f]{6}$/i.test(n.stroke) ? n.stroke : (n.stroke === "transparent" ? "transparent" : "#967cba");
    n.fontSize = Number.isFinite(n.fontSize) ? Math.max(8, Math.min(128, n.fontSize)) : 20;
    n.rotation = Number.isFinite(n.rotation) ? (n.rotation % 360) : 0;
    n.locked = Boolean(n.locked);

    // Table specific validation
    if (n.type === "table") {
      n.rows = Number.isFinite(n.rows) ? Math.max(1, Math.min(50, Math.floor(n.rows))) : 3;
      n.cols = Number.isFinite(n.cols) ? Math.max(1, Math.min(20, Math.floor(n.cols))) : 3;
      if (!Array.isArray(n.data)) {
        n.data = Array.from({ length: n.rows }, () => Array.from({ length: n.cols }, () => ""));
      }
      n.data = Array.from({ length: n.rows }, (_, r) => Array.from({ length: n.cols }, (_, c) => String(n.data[r]?.[c] ?? '').slice(0, 5000)));
    }

    // Kanban specific validation
    if (n.type === "kanban") {
      if (!Array.isArray(n.columns)) {
        n.columns = [
          { id: uid(), title: "To Do", cards: ["Research requirements"] },
          { id: uid(), title: "In Progress", cards: ["Implementation"] },
          { id: uid(), title: "Done", cards: ["Verified behavior"] },
        ];
      }
      n.columns = n.columns.slice(0, 20).map(col => ({ id: String(col?.id || uid()), title: String(col?.title || '').slice(0, 100), cards: (Array.isArray(col?.cards) ? col.cards : []).slice(0, 200).map(card => String(typeof card === 'string' ? card : card?.title || '').slice(0, 5000)) }));
    }

    // Frame specific validation
    if (n.type === "frame") {
      n.title = String(n.title || "Frame").slice(0, 100);
    }

    validNodes.push(n);
  }

  const anchors = new Set(
    validNodes
      .filter((n) => !["pen", "highlighter", "connector"].includes(n.type))
      .map((n) => n.id),
  );

  copy.nodes = validNodes.filter(
    (n) => n.type !== "connector" || (anchors.has(n.from) && anchors.has(n.to) && n.from !== n.to),
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
