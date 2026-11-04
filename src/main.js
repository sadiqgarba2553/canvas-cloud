import "./styles.css";
import {
  COLORS,
  uid,
  createBoard,
  bounds,
  connectionEndpoints,
  elbowConnectionPath,
  removeNode,
  moveNode,
  rotateNode,
  alignNodes,
  distributeNodes,
  validateBoard,
  History,
} from "./model.js";

const $ = (selector) => document.querySelector(selector);
const svg = $("#canvas"),
  world = $("#world"),
  history = new History();

let board = createBoard(),
  boards = [],
  selectedIds = new Set(),
  tool = "select",
  gesture = null,
  space = false,
  connecting = null,
  saveTimer,
  drawFrame,
  presentIndex = 0,
  searchResults = [],
  searchIndex = -1;

let ready = false,
  dirty = false;

// IndexedDB storage
const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open("bluecloud-canvas", 2);
  request.onupgradeneeded = (e) => {
    const db = request.result;
    if (!db.objectStoreNames.contains("boards")) {
      db.createObjectStore("boards", { keyPath: "id" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function stored(action, value) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("boards", action === "list" ? "readonly" : "readwrite");
    const store = tx.objectStore("boards");
    let result;
    const request =
      action === "list"
        ? store.getAll()
        : action === "delete"
          ? store.delete(value)
          : store.put(value);
    request.onsuccess = () => (result = request.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let toastTimer;
function notify(message) {
  const t = $(".toast");
  if (!t) return;
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

function safeName() {
  return board.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim() || "Untitled board";
}

async function saveNow() {
  clearTimeout(saveTimer);
  const snapshot = structuredClone(board);
  try {
    await stored("put", snapshot);
    const i = boards.findIndex((b) => b.id === snapshot.id);
    if (i < 0) boards.push(snapshot);
    else boards[i] = snapshot;
    if (board.id === snapshot.id && board.updatedAt === snapshot.updatedAt) {
      dirty = false;
      $("#save-status").textContent = "Saved on this device";
    }
    renderLibrary();
    return true;
  } catch {
    $("#save-status").textContent = "Not saved — save a copy";
    notify("Device storage is unavailable or full. Use Save a copy to keep your board.");
    return false;
  }
}

function persist() {
  board.updatedAt = Date.now();
  dirty = true;
  $("#save-status").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function checkpoint() {
  history.push(board);
}

function changed() {
  persist();
  render();
}

function primaryNode() {
  const firstId = Array.from(selectedIds)[0];
  return firstId ? board.nodes.find((n) => n.id === firstId) : null;
}

function selectedNodes() {
  return board.nodes.filter((n) => selectedIds.has(n.id));
}

function el(tag, attrs = {}, text) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) {
      element.setAttribute(key, String(value));
    }
  }
  if (text !== undefined) element.textContent = text;
  return element;
}

function lines(text, width, size) {
  const result = [];
  const limit = Math.max(3, Math.floor(width / (size * 0.54)));
  for (const paragraph of String(text || "").split("\n")) {
    if (!paragraph) {
      result.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(" ")) {
      if (current.length + word.length + 1 > limit && current) {
        result.push(current);
        current = "";
      }
      if (word.length > limit) {
        if (current) {
          result.push(current);
          current = "";
        }
        for (let i = 0; i < word.length; i += limit) {
          result.push(word.slice(i, i + limit));
        }
      } else current += (current ? " " : "") + word;
    }
    if (current) result.push(current);
  }
  return result;
}

// Draw individual object in SVG world
function drawObject(n) {
  const group = el("g", {
    "data-id": n.id,
    "data-kind": n.type,
    class: "board-node" + (n.locked ? " locked" : ""),
  });

  const transform = n.rotation ? `rotate(${n.rotation} ${n.x + (n.w || 0) / 2} ${n.y + (n.h || 0) / 2})` : null;
  if (transform) group.setAttribute("transform", transform);

  // 1. Connector
  if (n.type === "connector") {
    const a = board.nodes.find((o) => o.id === n.from);
    const b = board.nodes.find((o) => o.id === n.to);
    if (!a || !b) return group;

    const strokeColor = n.stroke || "#777084";
    const routing = n.routing || "straight";

    if (routing === "elbow") {
      const d = elbowConnectionPath(a, b);
      group.append(
        el("path", { d, fill: "none", stroke: "transparent", "stroke-width": 18 / board.view.scale }),
        el("path", { d, fill: "none", stroke: strokeColor, "stroke-width": 2.2, "marker-end": "url(#arrowhead)" })
      );
    } else {
      const [p, q] = connectionEndpoints(a, b);
      group.append(
        el("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: "transparent", "stroke-width": 18 / board.view.scale }),
        el("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: strokeColor, "stroke-width": 2.2, "marker-end": "url(#arrowhead)" })
      );
    }
    return group;
  }

  // 2. Pen or Highlighter stroke
  if (n.type === "pen" || n.type === "highlighter") {
    if (!n.points || n.points.length < 2) return group;
    const d = n.points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
    const isHighlighter = n.type === "highlighter";
    group.append(
      el("path", {
        d,
        fill: "none",
        stroke: "transparent",
        "stroke-width": (n.strokeWidth || (isHighlighter ? 20 : 3)) + 12 / board.view.scale,
      }),
      el("path", {
        d,
        fill: "none",
        stroke: n.stroke || (isHighlighter ? "#fbf27c" : "#70578d"),
        "stroke-width": n.strokeWidth || (isHighlighter ? 18 : 3),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        opacity: isHighlighter ? 0.45 : 1,
      })
    );
    return group;
  }

  // 3. Image
  if (n.type === "image") {
    group.append(
      el("image", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        href: n.src,
        preserveAspectRatio: "none",
      })
    );
    return group;
  }

  // 4. Frame (Presentation section container)
  if (n.type === "frame") {
    group.append(
      el("rect", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        rx: 8,
        fill: n.fill || "rgba(245, 243, 250, 0.4)",
        stroke: n.stroke || "#a899c2",
        "stroke-width": 1.5,
        "stroke-dasharray": "6 4",
      })
    );
    // Frame title tag
    const titleBg = el("rect", {
      x: n.x,
      y: n.y - 24,
      width: Math.min(200, Math.max(80, (n.title || "Frame").length * 9 + 16)),
      height: 22,
      rx: 4,
      fill: n.stroke || "#a899c2",
    });
    const titleText = el("text", {
      x: n.x + 8,
      y: n.y - 9,
      "font-family": "Segoe UI, sans-serif",
      "font-size": 11,
      "font-weight": "bold",
      fill: "#ffffff",
    }, n.title || "Frame");
    group.append(titleBg, titleText);
    return group;
  }

  // 5. Table
  if (n.type === "table") {
    group.append(
      el("rect", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        rx: 4,
        fill: n.fill || "#ffffff",
        stroke: n.stroke || "#967cba",
        "stroke-width": 1.5,
      })
    );
    const rows = n.rows || 3;
    const cols = n.cols || 3;
    const cellW = n.w / cols;
    const cellH = n.h / rows;

    for (let r = 1; r < rows; r++) {
      group.append(
        el("line", {
          x1: n.x,
          y1: n.y + r * cellH,
          x2: n.x + n.w,
          y2: n.y + r * cellH,
          stroke: n.stroke || "#967cba",
          "stroke-width": 1,
          opacity: 0.5,
        })
      );
    }
    for (let c = 1; c < cols; c++) {
      group.append(
        el("line", {
          x1: n.x + c * cellW,
          y1: n.y,
          x2: n.x + c * cellW,
          y2: n.y + n.h,
          stroke: n.stroke || "#967cba",
          "stroke-width": 1,
          opacity: 0.5,
        })
      );
    }

    if (Array.isArray(n.data)) {
      n.data.forEach((row, ri) => {
        if (!Array.isArray(row)) return;
        row.forEach((cellText, ci) => {
          if (!cellText) return;
          const textEl = el("text", {
            x: n.x + ci * cellW + 8,
            y: n.y + ri * cellH + 20,
            "font-family": "Segoe UI, sans-serif",
            "font-size": 12,
            fill: "#40354c",
          }, String(cellText).slice(0, 30));
          group.append(textEl);
        });
      });
    }
    return group;
  }

  // 6. Kanban Board
  if (n.type === "kanban") {
    group.append(
      el("rect", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        rx: 6,
        fill: n.fill || "#faf9fc",
        stroke: n.stroke || "#d3cce0",
        "stroke-width": 1.5,
      })
    );
    const cols = n.columns || [];
    const colW = n.w / Math.max(1, cols.length);

    cols.forEach((col, ci) => {
      const colX = n.x + ci * colW;
      // Column header line
      group.append(
        el("line", {
          x1: colX,
          y1: n.y,
          x2: colX,
          y2: n.y + n.h,
          stroke: "#d3cce0",
          "stroke-width": 1,
        })
      );
      // Header text
      group.append(
        el("text", {
          x: colX + 10,
          y: n.y + 24,
          "font-family": "Segoe UI, sans-serif",
          "font-size": 13,
          "font-weight": "bold",
          fill: "#5a4d66",
        }, col.title)
      );

      // Render cards
      let cardY = n.y + 36;
      (col.cards || []).forEach((card) => {
        group.append(
          el("rect", {
            x: colX + 8,
            y: cardY,
            width: colW - 16,
            height: 38,
            rx: 4,
            fill: "#ffffff",
            stroke: "#e0d8eb",
            "stroke-width": 1,
          }),
          el("text", {
            x: colX + 16,
            y: cardY + 22,
            "font-family": "Segoe UI, sans-serif",
            "font-size": 11,
            fill: "#40354c",
          }, typeof card === "string" ? card : (card.title || "Card"))
        );
        cardY += 46;
      });
    });
    return group;
  }

  // Common styles for geometric shapes
  const style = {
    fill: n.type === "text" ? "transparent" : n.fill,
    stroke: n.type === "text" ? "none" : n.stroke,
    "stroke-width": 1.5,
  };

  // Geometric shapes
  if (n.type === "ellipse") {
    group.append(
      el("ellipse", {
        cx: n.x + n.w / 2,
        cy: n.y + n.h / 2,
        rx: n.w / 2,
        ry: n.h / 2,
        ...style,
      })
    );
  } else if (n.type === "diamond") {
    group.append(
      el("polygon", {
        points: `${n.x + n.w / 2},${n.y} ${n.x + n.w},${n.y + n.h / 2} ${n.x + n.w / 2},${n.y + n.h} ${n.x},${n.y + n.h / 2}`,
        ...style,
      })
    );
  } else if (n.type === "triangle") {
    group.append(
      el("polygon", {
        points: `${n.x + n.w / 2},${n.y} ${n.x + n.w},${n.y + n.h} ${n.x},${n.y + n.h}`,
        ...style,
      })
    );
  } else if (n.type === "star") {
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    const rOuter = Math.min(n.w, n.h) / 2;
    const rInner = rOuter * 0.4;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      const r = i % 2 === 0 ? rOuter : rInner;
      pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
    }
    group.append(el("polygon", { points: pts.join(" "), ...style }));
  } else if (n.type === "hexagon") {
    const w = n.w;
    const h = n.h;
    const pts = `${n.x + w * 0.25},${n.y} ${n.x + w * 0.75},${n.y} ${n.x + w},${n.y + h * 0.5} ${n.x + w * 0.75},${n.y + h} ${n.x + w * 0.25},${n.y + h} ${n.x},${n.y + h * 0.5}`;
    group.append(el("polygon", { points: pts, ...style }));
  } else if (n.type === "cloud") {
    const d = `M ${n.x + n.w * 0.2} ${n.y + n.h * 0.7} A ${n.w * 0.2} ${n.h * 0.25} 0 0 1 ${n.x + n.w * 0.4} ${n.y + n.h * 0.25} A ${n.w * 0.25} ${n.h * 0.3} 0 0 1 ${n.x + n.w * 0.8} ${n.y + n.h * 0.35} A ${n.w * 0.2} ${n.h * 0.25} 0 0 1 ${n.x + n.w * 0.85} ${n.y + n.h * 0.7} Z`;
    group.append(el("path", { d, ...style }));
  } else if (n.type === "cylinder") {
    const ry = n.h * 0.15;
    const d = `M ${n.x} ${n.y + ry} A ${n.w / 2} ${ry} 0 0 1 ${n.x + n.w} ${n.y + ry} L ${n.x + n.w} ${n.y + n.h - ry} A ${n.w / 2} ${ry} 0 0 1 ${n.x} ${n.y + n.h - ry} Z`;
    group.append(
      el("path", { d, ...style }),
      el("ellipse", { cx: n.x + n.w / 2, cy: n.y + ry, rx: n.w / 2, ry, ...style })
    );
  } else if (n.type === "callout") {
    const d = `M ${n.x + 8} ${n.y} H ${n.x + n.w - 8} A 8 8 0 0 1 ${n.x + n.w} ${n.y + 8} V ${n.y + n.h * 0.7} A 8 8 0 0 1 ${n.x + n.w - 8} ${n.y + n.h * 0.7} H ${n.x + 40} L ${n.x + 20} ${n.y + n.h} L ${n.x + 28} ${n.y + n.h * 0.7} H ${n.x + 8} A 8 8 0 0 1 ${n.x} ${n.y + n.h * 0.7 - 8} V ${n.y + 8} A 8 8 0 0 1 ${n.x + 8} ${n.y} Z`;
    group.append(el("path", { d, ...style }));
  } else {
    // Note or standard Rectangle
    group.append(
      el("rect", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        rx: n.type === "note" ? 2 : 10,
        ...style,
      })
    );
    if (n.type === "note") {
      group.append(
        el("path", {
          d: `M ${n.x} ${n.y + 22} H ${n.x + n.w}`,
          stroke: n.stroke,
          "stroke-opacity": 0.22,
          "stroke-width": 1,
        })
      );
    }
  }

  // Label text rendering
  const padding = n.type === "diamond" || n.type === "triangle" ? n.w * 0.22 : 18;
  const fontSize = n.fontSize || 20;
  const wrapped = lines(n.text, n.w - padding * 2, fontSize);
  const maxLines = Math.max(1, Math.floor((n.h - 28) / (fontSize * 1.4)));
  const visible = wrapped.slice(0, maxLines);
  if (wrapped.length > maxLines && visible.length) {
    visible[visible.length - 1] = visible[visible.length - 1].slice(0, -1) + "…";
  }

  const text = el("text", {
    x: n.x + padding,
    y: n.y + (n.type === "note" ? 44 : fontSize + 16),
    "font-family": "Segoe UI, Arial, sans-serif",
    "font-size": fontSize,
    fill: "#40354c",
    class: "board-label",
  });
  visible.forEach((line, i) =>
    text.append(el("tspan", { x: n.x + padding, dy: i === 0 ? 0 : fontSize * 1.4 }, line))
  );
  group.append(text);

  return group;
}

// Draw comments as pinned badges on canvas
function drawComments() {
  if (!board.comments || !board.comments.length) return;
  board.comments.forEach((c) => {
    const pin = el("g", { class: "comment-pin", "data-comment-id": c.id });
    pin.append(
      el("circle", { cx: c.x, cy: c.y, r: 14 / board.view.scale, fill: "#7950ca", stroke: "#ffffff", "stroke-width": 2 / board.view.scale }),
      el("text", {
        x: c.x,
        y: c.y + 4 / board.view.scale,
        "font-family": "Segoe UI, sans-serif",
        "font-size": 10 / board.view.scale,
        "font-weight": "bold",
        fill: "#ffffff",
        "text-anchor": "middle",
      }, "💬")
    );
    world.append(pin);
  });
}

function draw() {
  drawFrame = null;
  world.replaceChildren();
  world.setAttribute(
    "transform",
    `translate(${board.view.x} ${board.view.y}) scale(${board.view.scale})`
  );

  // Layer ordering: Frames -> Connectors -> Regular Nodes -> Freehand Ink
  const frames = board.nodes.filter((n) => n.type === "frame");
  const connectors = board.nodes.filter((n) => n.type === "connector");
  const regular = board.nodes.filter((n) => n.type !== "frame" && n.type !== "connector" && n.type !== "pen" && n.type !== "highlighter");
  const ink = board.nodes.filter((n) => n.type === "pen" || n.type === "highlighter");

  for (const n of [...frames, ...connectors, ...regular, ...ink]) {
    world.append(drawObject(n));
  }

  drawComments();

  // Draw selection outlines for all selected nodes
  selectedNodes().forEach((n) => {
    const box = bounds([n]);
    if (box) {
      world.append(
        el("rect", {
          x: box.x - 5,
          y: box.y - 5,
          width: box.w + 10,
          height: box.h + 10,
          class: "selection-outline",
        })
      );
      if (n.type !== "pen" && n.type !== "highlighter" && !n.locked) {
        // Resize handle
        world.append(
          el("rect", {
            x: n.x + n.w - 5 / board.view.scale,
            y: n.y + n.h - 5 / board.view.scale,
            width: 10 / board.view.scale,
            height: 10 / board.view.scale,
            class: "resize-handle",
            "data-resize": n.id,
          })
        );
      }
    }
  });

  // Topline counters and status
  $("#empty-state").hidden = board.nodes.length > 0;
  $("#object-count").textContent = `${board.nodes.length} object${board.nodes.length === 1 ? "" : "s"}`;
  $("#zoom-level").textContent = Math.round(board.view.scale * 100) + "%";
  $("#undo").disabled = !history.past.length;
  $("#redo").disabled = !history.future.length;

  // Grid pattern offset
  const pattern = $("#dots");
  if (pattern) {
    const s = 24 * board.view.scale;
    pattern.setAttribute("width", s);
    pattern.setAttribute("height", s);
    pattern.setAttribute("x", board.view.x % s);
    pattern.setAttribute("y", board.view.y % s);
  }

  updateMinimap();
}

function queueDraw() {
  if (!drawFrame) drawFrame = requestAnimationFrame(draw);
}

function updateMinimap() {
  const canvas = $("#minimap-canvas");
  const vp = $("#minimap-viewport");
  if (!canvas || !vp) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const b = bounds(board.nodes);
  if (!b) {
    vp.style.display = "none";
    return;
  }
  vp.style.display = "block";

  const padding = 100;
  const boardBounds = {
    x: Math.min(b.x, (0 - board.view.x) / board.view.scale) - padding,
    y: Math.min(b.y, (0 - board.view.y) / board.view.scale) - padding,
    w: Math.max(b.w, svg.clientWidth / board.view.scale) + padding * 2,
    h: Math.max(b.h, svg.clientHeight / board.view.scale) + padding * 2,
  };

  const scaleX = canvas.width / boardBounds.w;
  const scaleY = canvas.height / boardBounds.h;
  const scale = Math.min(scaleX, scaleY);

  ctx.fillStyle = "#8a75a8";
  board.nodes.forEach((n) => {
    if (n.type === "connector") return;
    const nx = (n.x - boardBounds.x) * scale;
    const ny = (n.y - boardBounds.y) * scale;
    const nw = Math.max(2, (n.w || 20) * scale);
    const nh = Math.max(2, (n.h || 20) * scale);
    ctx.fillRect(nx, ny, nw, nh);
  });

  // Viewport box
  const vx = (-board.view.x / board.view.scale - boardBounds.x) * scale;
  const vy = (-board.view.y / board.view.scale - boardBounds.y) * scale;
  const vw = (svg.clientWidth / board.view.scale) * scale;
  const vh = (svg.clientHeight / board.view.scale) * scale;

  vp.style.left = `${Math.max(6, Math.min(canvas.width - 10, vx + 6))}px`;
  vp.style.top = `${Math.max(24, Math.min(canvas.height + 14, vy + 24))}px`;
  vp.style.width = `${Math.max(10, Math.min(canvas.width, vw))}px`;
  vp.style.height = `${Math.max(8, Math.min(canvas.height, vh))}px`;
}

function inspector() {
  const n = primaryNode();
  $("#object-properties").disabled = !n;

  const names = {
    note: "Sticky note",
    rect: "Rectangle",
    ellipse: "Ellipse",
    diamond: "Diamond",
    triangle: "Triangle",
    star: "Star",
    hexagon: "Hexagon",
    cloud: "Cloud",
    cylinder: "Cylinder",
    callout: "Callout",
    text: "Text box",
    pen: "Drawing stroke",
    highlighter: "Highlighter stroke",
    connector: "Connector line",
    image: "Image",
    frame: "Presentation frame",
    table: "Table grid",
    kanban: "Kanban board",
  };

  $("#selection-name").textContent = n
    ? selectedIds.size > 1
      ? `${selectedIds.size} objects selected`
      : names[n.type] || "Object"
    : "Your canvas";

  $("#selection-help").textContent = n
    ? n.locked
      ? "This object is locked from editing."
      : "Move it on the board, or change its appearance below."
    : "Select something on the board to change its details.";

  $("#object-text").value = n ? objectText(n) : '';
  $('#object-text').placeholder = n?.type === 'table' ? 'Separate cells with tabs and rows with new lines.' : n?.type === 'kanban' ? '# Column title\nCard text\n# Next column\nAnother card' : 'Write something…';
  $("#object-text").disabled = !n || ["pen", "highlighter", "connector", "image"].includes(n.type);
  $("#fill-color").disabled = !n || ["pen", "highlighter", "connector", "image", "text"].includes(n.type);
  $("#stroke-color").disabled = !n || ["text", "image"].includes(n.type);
  $("#font-size").disabled = !n || ["pen", "highlighter", "connector", "image"].includes(n.type);

  if (n) {
    $("#fill-color").value = n.fill && n.fill.startsWith("#") ? n.fill : "#eee7f7";
    $("#stroke-color").value = n.stroke && n.stroke.startsWith("#") ? n.stroke : "#967cba";
    $("#font-size").value = n.fontSize || 20;
    $("#rotation-slider").value = n.rotation || 0;
    $("#rotation-val").textContent = String(n.rotation || 0);
    $("#lock-toggle").textContent = n.locked ? "🔓 Unlock" : "🔒 Lock";
  }

  // Render comments in inspector
  const commentsList = $("#comments-list");
  if (commentsList) {
    commentsList.replaceChildren();
    (board.comments || []).forEach((c) => {
      const card = document.createElement("div");
      card.className = "comment-card";
      const author = document.createElement('strong'); author.textContent = c.author || 'You';
      const time = document.createElement('time'); time.textContent = new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const text = document.createElement('p'); text.textContent = c.text;
      const replies = document.createElement('div'); replies.className = 'comment-replies';
      for (const reply of c.replies || []) {
        const paragraph = document.createElement('p'); paragraph.textContent = `${reply.author}: ${reply.text}`; replies.append(paragraph);
      }
      const inputRow = document.createElement('div'); inputRow.className = 'comment-reply-input';
      const input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Reply…'; input.dataset.commentId = c.id;
      const post = document.createElement('button'); post.textContent = 'Post'; post.dataset.commentReply = c.id;
      inputRow.append(input, post); card.append(author, time, text, replies, inputRow);
      commentsList.append(card);
    });
    $("#comment-count").textContent = String((board.comments || []).length);
  }
}

function render() {
  draw();
  inspector();
  $("#board-title").value = board.name;
}

$('#comments-list').addEventListener('click', event => {
  const button = event.target.closest('[data-comment-reply]');
  if (!button) return;
  const input = button.parentElement.querySelector('input');
  const text = input.value.trim();
  const comment = board.comments.find(c => c.id === button.dataset.commentReply);
  if (!text || !comment) return;
  checkpoint();
  comment.replies ||= [];
  comment.replies.push({ author: 'You', text: text.slice(0, 50000), createdAt: Date.now() });
  changed();
});

function renderLibrary() {
  const list = $("#board-list");
  if (!list) return;
  list.replaceChildren();
  for (const b of [...boards].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const row = document.createElement("div");
    row.className = "board-item" + (b.id === board.id ? " active" : "");
    const open = document.createElement("button");
    open.setAttribute("aria-current", b.id === board.id ? "page" : "false");
    const icon = document.createElement("span");
    icon.textContent = "▧";
    const name = document.createElement("span");
    name.className = "board-name";
    name.textContent = b.id === board.id ? board.name : b.name;
    open.append(icon, name);
    open.onclick = () => switchBoard(b.id);

    const remove = document.createElement("button");
    remove.className = "delete-board";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Delete board " + b.name);
    remove.onclick = async () => {
      if (!confirm(`Delete “${b.name}” from this device? Save a copy first if you want to keep it.`)) return;
      try {
        await stored("delete", b.id);
        boards = boards.filter((v) => v.id !== b.id);
        if (board.id === b.id) {
          clearTimeout(saveTimer);
          board = boards[0] ? structuredClone(boards[0]) : createBoard();
          history.past = [];
          history.future = [];
          selectedIds.clear();
          await saveNow();
          render();
        }
        renderLibrary();
      } catch {
        notify("The board could not be deleted.");
      }
    };
    row.append(open, remove);
    list.append(row);
  }
}

async function switchBoard(id) {
  if (board.id === id) return;
  if (!(await saveNow())) return;
  const target = boards.find((b) => b.id === id);
  if (!target) return;
  board = structuredClone(target);
  selectedIds.clear();
  connecting = null;
  history.past = [];
  history.future = [];
  render();
  renderLibrary();
}

async function newBoard() {
  if (!(await saveNow())) return;
  board = createBoard("Untitled board");
  selectedIds.clear();
  history.past = [];
  history.future = [];
  await saveNow();
  render();
  $("#board-title").focus();
  $("#board-title").select();
}

function setTool(value) {
  tool = value;
  connecting = null;
  svg.dataset.tool = value;
  document.querySelectorAll("[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === value);
    b.setAttribute("aria-pressed", String(b.dataset.tool === value));
  });

  const hints = {
    select: "Select an object to edit. Shift+click for multi-selection. Hold Space to pan.",
    hand: "Drag to pan around. Ctrl + scroll to zoom.",
    eraser: "Click or drag over drawings and objects to erase them.",
    connector: "Click one shape, then another to connect them.",
    pen: "Draw with pen.",
    highlighter: "Highlight with semi-transparent stroke.",
    frame: "Click and drag to create a presentation frame.",
    table: "Click to place a table grid.",
    kanban: "Click to place a Kanban board.",
    comment: "Click anywhere on the board to drop a comment pin.",
  };
  $("#tool-hint").textContent = hints[value] || `Click or drag to add a ${value}.`;
}

function point(event) {
  const r = svg.getBoundingClientRect();
  return {
    x: (event.clientX - r.left - board.view.x) / board.view.scale,
    y: (event.clientY - r.top - board.view.y) / board.view.scale,
  };
}

function addShape(type, x, y) {
  const colors = COLORS[type] || COLORS.rect;
  const base = {
    id: uid(),
    type,
    x: board.settings?.snapToGrid ? Math.round(x / 20) * 20 : x,
    y: board.settings?.snapToGrid ? Math.round(y / 20) * 20 : y,
    fill: colors[0],
    stroke: colors[1],
    fontSize: 20,
    rotation: 0,
    locked: false,
  };

  switch (type) {
    case "note":
      return { ...base, w: 220, h: 190, text: "Your next idea" };
    case "text":
      return { ...base, w: 260, h: 90, text: "Add a thought" };
    case "frame":
      return { ...base, w: 600, h: 400, title: `Frame ${board.nodes.filter((n) => n.type === "frame").length + 1}` };
    case "table":
      return {
        ...base,
        w: 360,
        h: 180,
        rows: 3,
        cols: 3,
        data: [
          ["Header 1", "Header 2", "Header 3"],
          ["Data A", "Data B", "Data C"],
          ["Data D", "Data E", "Data F"],
        ],
      };
    case "kanban":
      return {
        ...base,
        w: 480,
        h: 280,
        columns: [
          { id: uid(), title: "To Do", cards: ["Research requirement", "Plan architecture"] },
          { id: uid(), title: "In Progress", cards: ["Implementation"] },
          { id: uid(), title: "Done", cards: ["Source code ready"] },
        ],
      };
    default:
      return { ...base, w: 220, h: 140, text: "" };
  }
}

function addFirstNote() {
  checkpoint();
  const r = svg.getBoundingClientRect();
  const p = {
    x: (r.width / 2 - board.view.x) / board.view.scale - 110,
    y: (r.height / 2 - board.view.y) / board.view.scale - 95,
  };
  const n = addShape("note", p.x, p.y);
  board.nodes.push(n);
  selectedIds.clear();
  selectedIds.add(n.id);
  changed();
  setTool("select");
  editText();
}

function editText() {
  const n = primaryNode();
  if (!n || n.locked || ["pen", "highlighter", "connector", "image"].includes(n.type)) return;
  $("#edit-text").value = objectText(n);
  $('#text-editor h2').textContent = n.type === 'table' ? 'Edit table — tab-separated cells' : n.type === 'kanban' ? 'Edit Kanban — # headings, one card per line' : 'Edit text';
  $("#text-editor").showModal();
  $("#edit-text").focus();
  $("#edit-text").select();
}

function objectText(n) {
  if (n.type === 'table') return (n.data || []).map(row => row.join('\t')).join('\n');
  if (n.type === 'kanban') return (n.columns || []).map(col => `# ${col.title}\n${(col.cards || []).map(card => typeof card === 'string' ? card : card.title).join('\n')}`).join('\n');
  return n.type === 'frame' ? n.title || '' : n.text || '';
}

function setObjectText(n, value) {
  if (n.locked) return;
  if (n.type === 'table') {
    const data = value.split('\n').slice(0, 50).map(line => line.split('\t').slice(0, 20));
    n.rows = data.length; n.cols = Math.max(1, ...data.map(row => row.length));
    n.data = data.map(row => Array.from({ length: n.cols }, (_, c) => row[c] || ''));
  } else if (n.type === 'kanban') {
    const columns = [];
    for (const line of value.split('\n')) {
      if (line.startsWith('# ') && columns.length < 20) columns.push({ id: uid(), title: line.slice(2), cards: [] });
      else if (line.trim() && columns.length) columns[columns.length - 1].cards.push(line);
    }
    n.columns = columns;
  } else if (n.type === 'frame') n.title = value;
  else n.text = value;
}

// SVG canvas pointer interactions
svg.addEventListener("pointerdown", (event) => {
  if (!ready || event.button === 2) return;
  const p = point(event);
  const targetNodeGroup = event.target.closest("[data-id]");
  const id = targetNodeGroup?.dataset.id;
  const resize = event.target.getAttribute("data-resize");

  svg.setPointerCapture(event.pointerId);
  svg.focus();

  // 1. Pan gesture (Middle click, spacebar, or hand tool)
  if (tool === "hand" || space || event.button === 1) {
    gesture = { kind: "pan", clientX: event.clientX, clientY: event.clientY, x: board.view.x, y: board.view.y };
    event.preventDefault();
    return;
  }

  // 2. Eraser tool
  if (tool === "eraser") {
    if (id) {
      checkpoint();
      removeNode(board, id);
      selectedIds.delete(id);
      changed();
    }
    gesture = { kind: "eraser" };
    return;
  }

  // 3. Comment pin tool
  if (tool === "comment") {
    const text = prompt("Enter your comment note:");
    if (text) {
      checkpoint();
      if (!board.comments) board.comments = [];
      board.comments.push({
        id: uid(),
        x: p.x,
        y: p.y,
        author: "You",
        text,
        createdAt: Date.now(),
        resolved: false,
        replies: [],
      });
      changed();
      setTool("select");
    }
    return;
  }

  // 4. Resize gesture
  if (resize && tool === "select") {
    const target = board.nodes.find((n) => n.id === resize);
    if (target && !target.locked) {
      checkpoint();
      gesture = { kind: "resize", id: resize, start: p, initial: structuredClone(target) };
      return;
    }
  }

  // 5. Connector tool
  if (tool === "connector") {
    const n = board.nodes.find((n) => n.id === id);
    if (!n || ["connector", "pen", "highlighter"].includes(n.type)) {
      notify("Choose a shape, note, text, or image to connect.");
      return;
    }
    if (!connecting) {
      connecting = id;
      selectedIds.clear();
      selectedIds.add(id);
      render();
      notify("Now choose the target shape.");
    } else if (connecting !== id) {
      checkpoint();
      const link = {
        id: uid(),
        type: "connector",
        from: connecting,
        to: id,
        stroke: "#777084",
        routing: "straight",
      };
      board.nodes.push(link);
      selectedIds.clear();
      selectedIds.add(link.id);
      connecting = null;
      changed();
      setTool("select");
    }
    return;
  }

  // 6. Select tool
  if (tool === "select") {
    if (id) {
      const n = board.nodes.find((node) => node.id === id);
      if (event.shiftKey) {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
      } else {
        if (!selectedIds.has(id)) {
          selectedIds.clear();
          selectedIds.add(id);
        }
      }
      render();

      if (n && !n.locked && n.type !== "connector") {
        checkpoint();
        const initialPositions = new Map();
        selectedNodes().forEach((node) => initialPositions.set(node.id, structuredClone(node)));
        gesture = { kind: "move", id, start: p, initialPositions, moved: false };
      }
    } else {
      // Clicked on empty canvas: clear selection or start marquee
      if (!event.shiftKey) selectedIds.clear();
      render();
      gesture = { kind: "marquee", start: p };
    }
    return;
  }

  // 7. Pen or Highlighter drawing
  if (tool === "pen" || tool === "highlighter") {
    checkpoint();
    const isHighlighter = tool === "highlighter";
    const n = {
      id: uid(),
      type: tool,
      points: [p],
      stroke: isHighlighter ? "#fbf27c" : ($("#stroke-color").value || "#70578d"),
      strokeWidth: isHighlighter ? 20 : 3,
    };
    board.nodes.push(n);
    selectedIds.clear();
    selectedIds.add(n.id);
    gesture = { kind: "draw", id: n.id };
    queueDraw();
    return;
  }

  // 8. Place new shape
  checkpoint();
  const n = addShape(tool, p.x, p.y);
  board.nodes.push(n);
  selectedIds.clear();
  selectedIds.add(n.id);
  gesture = { kind: "create", id: n.id, start: p, moved: false };
  queueDraw();
});

svg.addEventListener("pointermove", (event) => {
  if (!gesture) return;
  const p = point(event);

  if (gesture.kind === "pan") {
    board.view.x = gesture.x + event.clientX - gesture.clientX;
    board.view.y = gesture.y + event.clientY - gesture.clientY;
  } else if (gesture.kind === "eraser") {
    const id = event.target.closest("[data-id]")?.dataset.id;
    if (id) {
      removeNode(board, id);
      selectedIds.delete(id);
      queueDraw();
    }
  } else if (gesture.kind === "move") {
    const dx = p.x - gesture.start.x;
    const dy = p.y - gesture.start.y;
    selectedNodes().forEach((node) => {
      const init = gesture.initialPositions.get(node.id);
      if (init) {
        Object.assign(node, structuredClone(init));
        moveNode(node, dx, dy);
      }
    });
    gesture.moved = Math.abs(dx) + Math.abs(dy) > 1;
  } else if (gesture.kind === "resize") {
    const n = board.nodes.find((n) => n.id === gesture.id);
    if (n) {
      n.w = Math.max(60, gesture.initial.w + p.x - gesture.start.x);
      n.h = Math.max(40, gesture.initial.h + p.y - gesture.start.y);
    }
  } else if (gesture.kind === "create") {
    const n = board.nodes.find((n) => n.id === gesture.id);
    if (n) {
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) {
        gesture.moved = true;
        n.x = Math.min(p.x, gesture.start.x);
        n.y = Math.min(p.y, gesture.start.y);
        n.w = Math.max(60, Math.abs(dx));
        n.h = Math.max(40, Math.abs(dy));
      }
    }
  } else if (gesture.kind === "draw") {
    const n = board.nodes.find((n) => n.id === gesture.id);
    if (n && n.points) {
      const last = n.points[n.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 1 / board.view.scale && n.points.length < 20000) {
        n.points.push(p);
      }
    }
  } else if (gesture.kind === "marquee") {
    const marquee = $("#marquee");
    if (marquee) {
      const minX = Math.min(gesture.start.x, p.x);
      const minY = Math.min(gesture.start.y, p.y);
      const mw = Math.abs(p.x - gesture.start.x);
      const mh = Math.abs(p.y - gesture.start.y);
      marquee.style.display = "block";
      marquee.setAttribute("x", minX * board.view.scale + board.view.x);
      marquee.setAttribute("y", minY * board.view.scale + board.view.y);
      marquee.setAttribute("width", mw * board.view.scale);
      marquee.setAttribute("height", mh * board.view.scale);

      // Select nodes contained inside marquee
      board.nodes.forEach((n) => {
        if (n.type === "connector") return;
        if (n.x >= minX && n.x + (n.w || 0) <= minX + mw && n.y >= minY && n.y + (n.h || 0) <= minY + mh) {
          selectedIds.add(n.id);
        }
      });
    }
  }
  queueDraw();
});

function finishGesture() {
  if (!gesture) return;
  const ended = gesture;
  gesture = null;

  const marquee = $("#marquee");
  if (marquee) marquee.style.display = "none";

  if (ended.kind === "draw") {
    const n = board.nodes.find((n) => n.id === ended.id);
    if (n?.points.length < 2) {
      removeNode(board, n.id);
      selectedIds.delete(n.id);
      history.past.pop();
    }
  }
  if (ended.kind === "move" && !ended.moved) history.past.pop();
  if (ended.kind === "create") setTool("select");

  persist();
  render();
}

svg.addEventListener("pointerup", finishGesture);
svg.addEventListener("pointercancel", finishGesture);
svg.addEventListener("lostpointercapture", finishGesture);

svg.addEventListener("dblclick", (event) => {
  const id = event.target.closest("[data-id]")?.dataset.id;
  if (id) {
    selectedIds.clear();
    selectedIds.add(id);
    render();
    editText();
  }
});

function zoomTo(scale, screenX = svg.clientWidth / 2, screenY = svg.clientHeight / 2) {
  scale = Math.max(0.1, Math.min(5, scale));
  const x = (screenX - board.view.x) / board.view.scale;
  const y = (screenY - board.view.y) / board.view.scale;
  board.view = { x: screenX - x * scale, y: screenY - y * scale, scale };
  persist();
  queueDraw();
}

svg.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const r = svg.getBoundingClientRect();
      zoomTo(board.view.scale * Math.exp(-event.deltaY * 0.005), event.clientX - r.left, event.clientY - r.top);
    } else {
      board.view.x -= event.deltaX;
      board.view.y -= event.deltaY;
      persist();
      queueDraw();
    }
  },
  { passive: false }
);

function fit() {
  const box = bounds(board.nodes);
  if (!box) {
    board.view = { x: 0, y: 0, scale: 1 };
    changed();
    return;
  }
  const padding = 110;
  const scale = Math.min(
    1.5,
    Math.max(
      0.15,
      Math.min(
        (svg.clientWidth - padding * 2) / Math.max(box.w, 1),
        (svg.clientHeight - padding * 2) / Math.max(box.h, 1)
      )
    )
  );
  board.view = {
    x: (svg.clientWidth - box.w * scale) / 2 - box.x * scale,
    y: (svg.clientHeight - box.h * scale) / 2 - box.y * scale,
    scale,
  };
  changed();
}

function undo() {
  board = history.undo(board);
  selectedIds.clear();
  changed();
}

function redo() {
  board = history.redo(board);
  selectedIds.clear();
  changed();
}

function duplicate() {
  if (!selectedIds.size) return;
  checkpoint();
  const newIds = new Set();
  selectedNodes().forEach((n) => {
    if (n.type === "connector") return;
    const copy = structuredClone(n);
    copy.id = uid();
    moveNode(copy, 30, 30);
    board.nodes.push(copy);
    newIds.add(copy.id);
  });
  selectedIds = newIds;
  changed();
}

function remove() {
  if (!selectedIds.size) return;
  checkpoint();
  selectedNodes().forEach((n) => removeNode(board, n.id));
  selectedIds.clear();
  changed();
}

// Presentation Mode
function startPresentation() {
  const frames = board.nodes.filter((n) => n.type === "frame");
  if (!frames.length) {
    notify("Add at least one Frame (F) to start presentation mode.");
    return;
  }
  presentIndex = 0;
  $("#presentation-bar").hidden = false;
  showPresentFrame();
}

function showPresentFrame() {
  const frames = board.nodes.filter((n) => n.type === "frame");
  if (!frames.length) return;
  const f = frames[presentIndex];
  $("#present-frame-title").textContent = `${f.title || "Frame"} (${presentIndex + 1} of ${frames.length})`;

  // Smoothly center and scale to frame
  const padding = 60;
  const scale = Math.min(
    (svg.clientWidth - padding * 2) / f.w,
    (svg.clientHeight - padding * 2) / f.h
  );
  board.view = {
    x: (svg.clientWidth - f.w * scale) / 2 - f.x * scale,
    y: (svg.clientHeight - f.h * scale) / 2 - f.y * scale,
    scale,
  };
  queueDraw();
}

function endPresentation() {
  $("#presentation-bar").hidden = true;
}

// Search functionality
function toggleSearch() {
  const bar = $("#search-bar");
  if (!bar) return;
  bar.hidden = !bar.hidden;
  if (!bar.hidden) {
    $("#search-input")?.focus();
    performSearch();
  }
}

function performSearch() {
  const query = $("#search-input")?.value.trim().toLowerCase();
  if (!query) {
    searchResults = [];
    searchIndex = -1;
    $("#search-count").textContent = "0 of 0";
    return;
  }

  searchResults = board.nodes.filter((n) => {
    if (n.text && n.text.toLowerCase().includes(query)) return true;
    if (n.title && n.title.toLowerCase().includes(query)) return true;
    if (n.type === "table" && Array.isArray(n.data)) {
      return n.data.some((row) => row.some((c) => String(c).toLowerCase().includes(query)));
    }
    return false;
  });

  if (searchResults.length > 0) {
    searchIndex = 0;
    $("#search-count").textContent = `1 of ${searchResults.length}`;
    focusSearchResult();
  } else {
    searchIndex = -1;
    $("#search-count").textContent = "0 of 0";
  }
}

function focusSearchResult() {
  if (searchIndex < 0 || searchIndex >= searchResults.length) return;
  const node = searchResults[searchIndex];
  selectedIds.clear();
  selectedIds.add(node.id);
  render();

  // Center on node
  board.view.x = svg.clientWidth / 2 - (node.x + (node.w || 0) / 2) * board.view.scale;
  board.view.y = svg.clientHeight / 2 - (node.y + (node.h || 0) / 2) * board.view.scale;
  queueDraw();
}

// Template Catalog
function insertTemplate(key) {
  checkpoint();
  const startX = (bounds(board.nodes)?.w || 0) + 100;
  const startY = 100;

  if (key === "brainstorm") {
    const a = addShape("note", startX, startY);
    const b = addShape("rect", startX + 320, startY + 25);
    const c = addShape("ellipse", startX + 640, startY + 25);
    a.text = "What challenge are we tackling?\n\nStart with the question.";
    b.text = "Key Idea / Hypothesis";
    c.text = "Next Action Item";
    board.nodes.push(
      a,
      b,
      c,
      { id: uid(), type: "connector", from: a.id, to: b.id, stroke: "#9a8aaa" },
      { id: uid(), type: "connector", from: b.id, to: c.id, stroke: "#9a8aaa" }
    );
  } else if (key === "kanban") {
    const k = addShape("kanban", startX, startY);
    k.w = 600;
    k.h = 350;
    board.nodes.push(k);
  } else if (key === "mindmap") {
    const centerNode = addShape("ellipse", startX + 300, startY + 200);
    centerNode.text = "Central Concept";
    centerNode.fill = "#dceee9";

    const sub1 = addShape("note", startX + 50, startY + 50);
    sub1.text = "Subtopic 1";
    const sub2 = addShape("note", startX + 550, startY + 50);
    sub2.text = "Subtopic 2";
    const sub3 = addShape("note", startX + 50, startY + 350);
    sub3.text = "Subtopic 3";
    const sub4 = addShape("note", startX + 550, startY + 350);
    sub4.text = "Subtopic 4";

    board.nodes.push(
      centerNode,
      sub1,
      sub2,
      sub3,
      sub4,
      { id: uid(), type: "connector", from: centerNode.id, to: sub1.id, stroke: "#81a998", routing: "elbow" },
      { id: uid(), type: "connector", from: centerNode.id, to: sub2.id, stroke: "#81a998", routing: "elbow" },
      { id: uid(), type: "connector", from: centerNode.id, to: sub3.id, stroke: "#81a998", routing: "elbow" },
      { id: uid(), type: "connector", from: centerNode.id, to: sub4.id, stroke: "#81a998", routing: "elbow" }
    );
  } else if (key === "flowchart") {
    const start = addShape("ellipse", startX, startY + 60);
    start.text = "Start";
    start.w = 120;
    start.h = 60;
    const process = addShape("rect", startX + 180, startY + 50);
    process.text = "Execute Process";
    const decision = addShape("diamond", startX + 440, startY + 30);
    decision.text = "Valid?";
    const end = addShape("ellipse", startX + 700, startY + 60);
    end.text = "End";
    end.w = 120;
    end.h = 60;

    board.nodes.push(
      start,
      process,
      decision,
      end,
      { id: uid(), type: "connector", from: start.id, to: process.id, stroke: "#777084" },
      { id: uid(), type: "connector", from: process.id, to: decision.id, stroke: "#777084" },
      { id: uid(), type: "connector", from: decision.id, to: end.id, stroke: "#777084" }
    );
  } else if (key === "retro") {
    const w1 = addShape("note", startX, startY);
    w1.text = "What went well?\n\n• High velocity\n• Clear requirements";
    w1.fill = "#d7f5dd";
    w1.stroke = "#68b97d";

    const w2 = addShape("note", startX + 260, startY);
    w2.text = "What could be improved?\n\n• Better test automation\n• Quicker reviews";
    w2.fill = "#ffd6e7";
    w2.stroke = "#e578a8";

    const w3 = addShape("note", startX + 520, startY);
    w3.text = "Action items\n\n• Set up Codex handoff\n• Audit limitations";
    w3.fill = "#d0e8ff";
    w3.stroke = "#6ba4e8";

    board.nodes.push(w1, w2, w3);
  } else if (key === "swot") {
    const s = addShape("rect", startX, startY);
    s.text = "STRENGTHS\n\n• Local-first privacy\n• Zero cloud dependency";
    s.fill = "#d7f5dd";

    const w = addShape("rect", startX + 240, startY);
    w.text = "WEAKNESSES\n\n• No hosted live sync\n• Advanced media limits";
    w.fill = "#ffd6e7";

    const o = addShape("rect", startX, startY + 160);
    o.text = "OPPORTUNITIES\n\n• Export SVG/PNG/PDF\n• Cross-app suite exchange";
    o.fill = "#d0e8ff";

    const t = addShape("rect", startX + 240, startY + 160);
    t.text = "THREATS\n\n• Browser IndexedDB quota";
    t.fill = "#fef1d6";

    board.nodes.push(s, w, o, t);
  }

  $("#templates-dialog")?.close();
  selectedIds.clear();
  changed();
  fit();
  notify("Template added to board.");
}

// Export functions
async function downloadData(content, type, extension) {
  if (window.__TAURI__?.core?.invoke) {
    try {
      const saved = content instanceof Blob
        ? await window.__TAURI__.core.invoke('save_png_export', { name: safeName() + extension, data: Array.from(new Uint8Array(await content.arrayBuffer())) })
        : await window.__TAURI__.core.invoke("save_export", {
        name: safeName() + extension,
        data: content,
        kind: extension === ".svg" ? "svg" : "board",
      });
      if (saved) notify("File saved.");
      return saved;
    } catch (error) {
      notify("Could not save: " + String(error));
      return false;
    }
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName() + extension;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  return true;
}

function generateSvgExportString() {
  const box = bounds(board.nodes);
  if (!box) return null;
  const root = el("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: `${box.x - 40} ${box.y - 40} ${box.w + 80} ${box.h + 80}`,
    width: box.w + 80,
    height: box.h + 80,
  });
  root.append(svg.querySelector("defs").cloneNode(true));
  root.append(
    el("rect", {
      x: box.x - 40,
      y: box.y - 40,
      width: box.w + 80,
      height: box.h + 80,
      fill: document.body.classList.contains("dark-mode") ? "#131018" : "#ffffff",
    })
  );
  for (const n of board.nodes) {
    const g = drawObject(n);
    g.querySelectorAll('[stroke="transparent"]').forEach((e) => e.remove());
    root.append(g);
  }
  return new XMLSerializer().serializeToString(root);
}

async function exportSvg() {
  const svgStr = generateSvgExportString();
  if (!svgStr) {
    notify("Add something to the board before exporting.");
    return;
  }
  if (await downloadData(svgStr, "image/svg+xml", ".svg")) notify("SVG exported successfully.");
}

async function exportPng() {
  const svgStr = generateSvgExportString();
  if (!svgStr) {
    notify("Add something to the board before exporting.");
    return;
  }
  const box = bounds(board.nodes);
  if ((box.w + 80) * (box.h + 80) * 4 > 32000000 || box.w > 8000 || box.h > 8000) {
    notify('This board is too large for a PNG. Export SVG instead.'); return;
  }
  const img = new Image();
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = (box.w + 80) * 2;
    canvas.height = (box.h + 80) * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob(async (pngBlob) => {
      if (pngBlob) {
        if (await downloadData(pngBlob, "image/png", ".png")) notify("PNG exported.");
      }
    });
  };
  img.onerror = () => { URL.revokeObjectURL(url); notify('Could not render PNG. Export SVG instead.'); };
  img.src = url;
}

function exportPdf() {
  const svgStr = generateSvgExportString();
  if (!svgStr) {
    notify("Add content before printing.");
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`
    <!doctype html>
    <html>
      <head>
        <title>${safeName()}</title>
        <style>@page { size: landscape; margin: 10mm; } body { margin: 0; display: grid; place-items: center; } svg { max-width: 100%; height: auto; }</style>
      </head>
      <body>${svgStr}</body>
    </html>
  `);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 1000);
  }, 300);
}

async function importContent(content) {
  const imported = validateBoard(JSON.parse(content));
  if (!(await saveNow())) return;
  board = imported;
  selectedIds.clear();
  history.past = [];
  history.future = [];
  await saveNow();
  render();
  fit();
  notify("Board opened on this device.");
}

// UI Event Wireups
document.querySelectorAll("[data-tool]").forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$("#first-note").onclick = addFirstNote;
$("#new-board").onclick = newBoard;
$("#undo").onclick = undo;
$("#redo").onclick = redo;
$("#duplicate").onclick = duplicate;
$("#remove").onclick = remove;

$("#front").onclick = () => {
  if (!selectedIds.size) return;
  checkpoint();
  const selected = selectedNodes();
  board.nodes = board.nodes.filter((o) => !selectedIds.has(o.id));
  board.nodes.push(...selected);
  changed();
};

$("#send-back").onclick = () => {
  if (!selectedIds.size) return;
  checkpoint();
  const selected = selectedNodes();
  board.nodes = board.nodes.filter((o) => !selectedIds.has(o.id));
  board.nodes.unshift(...selected);
  changed();
};

// Alignment & Distribution
$("#align-left").onclick = () => { checkpoint(); alignNodes(selectedNodes(), "left"); changed(); };
$("#align-center").onclick = () => { checkpoint(); alignNodes(selectedNodes(), "center"); changed(); };
$("#align-right").onclick = () => { checkpoint(); alignNodes(selectedNodes(), "right"); changed(); };
$("#align-top").onclick = () => { checkpoint(); alignNodes(selectedNodes(), "top"); changed(); };
$("#align-middle").onclick = () => { checkpoint(); alignNodes(selectedNodes(), "middle"); changed(); };
$("#align-bottom").onclick = () => { checkpoint(); alignNodes(selectedNodes(), "bottom"); changed(); };
$("#dist-h").onclick = () => { checkpoint(); distributeNodes(selectedNodes(), "horizontal"); changed(); };
$("#dist-v").onclick = () => { checkpoint(); distributeNodes(selectedNodes(), "vertical"); changed(); };

$("#lock-toggle").onclick = () => {
  const n = primaryNode();
  if (!n) return;
  checkpoint();
  n.locked = !n.locked;
  changed();
};

$("#rotation-slider").addEventListener("input", (e) => {
  const n = primaryNode();
  if (!n) return;
  n.rotation = Number(e.target.value);
  $("#rotation-val").textContent = String(n.rotation);
  queueDraw();
});
$('#rotation-slider').addEventListener('pointerdown', checkpoint);
$('#rotation-slider').addEventListener('keydown', event => { if (event.key.startsWith('Arrow')) checkpoint(); });

$("#rotation-slider").addEventListener("change", () => {
  persist();
});

// Board title
$("#board-title").addEventListener("input", () => {
  board.name = $("#board-title").value.trim() || "Untitled board";
  persist();
  renderLibrary();
});

for (const [selector, prop] of [
  ["#fill-color", "fill"],
  ["#stroke-color", "stroke"],
  ["#font-size", "fontSize"],
]) {
  $(selector).addEventListener("change", () => {
    const n = primaryNode();
    if (!n) return;
    checkpoint();
    if (prop === 'text') setObjectText(n, $(selector).value);
    else n[prop] = prop === "fontSize" ? Number($(selector).value) : $(selector).value;
    changed();
  });
}

$('#object-text').addEventListener('focus', () => { if (primaryNode() && !primaryNode().locked) checkpoint(); });
$('#object-text').addEventListener('input', event => {
  const n = primaryNode();
  if (!n || n.locked) return;
  setObjectText(n, event.target.value); persist(); queueDraw();
});

$("#text-editor").addEventListener("close", () => {
  if ($("#text-editor").returnValue === "save" && primaryNode()) {
    checkpoint();
    setObjectText(primaryNode(), $("#edit-text").value);
    changed();
  }
});

// Search wireups
$("#search-toggle").onclick = toggleSearch;
$("#search-close").onclick = toggleSearch;
$("#search-input").addEventListener("input", performSearch);
$("#search-next").onclick = () => {
  if (!searchResults.length) return;
  searchIndex = (searchIndex + 1) % searchResults.length;
  $("#search-count").textContent = `${searchIndex + 1} of ${searchResults.length}`;
  focusSearchResult();
};
$("#search-prev").onclick = () => {
  if (!searchResults.length) return;
  searchIndex = (searchIndex - 1 + searchResults.length) % searchResults.length;
  $("#search-count").textContent = `${searchIndex + 1} of ${searchResults.length}`;
  focusSearchResult();
};

// Presentation wireups
$("#present-btn").onclick = startPresentation;
$("#present-exit").onclick = endPresentation;
$("#present-next").onclick = () => {
  const frames = board.nodes.filter((n) => n.type === "frame");
  if (!frames.length) return;
  presentIndex = (presentIndex + 1) % frames.length;
  showPresentFrame();
};
$("#present-prev").onclick = () => {
  const frames = board.nodes.filter((n) => n.type === "frame");
  if (!frames.length) return;
  presentIndex = (presentIndex - 1 + frames.length) % frames.length;
  showPresentFrame();
};

// Templates wireups
$("#starter").onclick = () => $("#templates-dialog").showModal();
$("#close-templates").onclick = () => $("#templates-dialog").close();
document.querySelectorAll("[data-template]").forEach((btn) => {
  btn.onclick = () => insertTemplate(btn.dataset.template);
});

// Theme toggle
function applyTheme(isDark) {
  document.body.classList.toggle("dark-mode", isDark);
  if (board.settings) board.settings.theme = isDark ? "dark" : "light";
  localStorage.setItem("canvascloud-theme", isDark ? "dark" : "light");
}
$("#theme-toggle").onclick = () => {
  const isDark = !document.body.classList.contains("dark-mode");
  applyTheme(isDark);
  queueDraw();
};

// Grid snap toggle
$("#toggle-grid-btn").onclick = () => {
  if (!board.settings) board.settings = {};
  board.settings.snapToGrid = !board.settings.snapToGrid;
  $("#toggle-grid-btn").textContent = board.settings.snapToGrid ? "▦ Snap ON" : "▦ Snap";
  notify(board.settings.snapToGrid ? "Snapping to 20px grid enabled." : "Grid snapping disabled.");
};

// Minimap toggle
$("#toggle-minimap-btn").onclick = () => {
  const mm = $("#minimap-container");
  if (mm) mm.style.display = mm.style.display === "none" ? "block" : "none";
};

// Export dropdown
$("#export-btn").onclick = (e) => {
  e.stopPropagation();
  $("#export-menu").classList.toggle("show");
};
document.addEventListener("click", () => $("#export-menu")?.classList.remove("show"));

$("#export-svg").onclick = exportSvg;
$("#export-png").onclick = exportPng;
$("#export-pdf").onclick = exportPdf;
$("#export-native").onclick = () =>
  downloadData(JSON.stringify(board, null, 2), "application/json", ".canvascloud");

$("#save-file").onclick = () =>
  downloadData(JSON.stringify(board, null, 2), "application/json", ".canvascloud");

$("#shortcuts").onclick = () => $("#help-dialog").showModal();
$("#close-help").onclick = () => $("#help-dialog").close();
$("#zoom-in").onclick = () => zoomTo(board.view.scale * 1.2);
$("#zoom-out").onclick = () => zoomTo(board.view.scale / 1.2);
$("#zoom-level").onclick = () => zoomTo(1);
$("#fit").onclick = fit;

// File open
$("#open-board").onclick = async () => {
  if (window.__TAURI__?.core?.invoke) {
    try {
      const content = await window.__TAURI__.core.invoke("open_board_file");
      if (content !== null) await importContent(content);
    } catch (error) {
      notify("Could not open board: " + String(error));
    }
  } else $("#board-file").click();
};

$("#board-file").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 50000000) throw Error("This board is too large to open (50 MB limit).");
    await importContent(await file.text());
  } catch (error) {
    notify(error.message || "That board could not be opened.");
  }
  event.target.value = "";
};

// Image addition
$("#add-image").onclick = () => $("#image-file").click();
$("#image-file").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw Error("Choose a PNG, JPEG, or WebP image.");
    if (file.size > 10000000) throw Error("Choose an image smaller than 10 MB.");
    const src = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = new Image();
    img.src = src;
    await img.decode();
    checkpoint();
    const width = Math.min(500, img.naturalWidth);
    const height = (width * img.naturalHeight) / img.naturalWidth;
    const n = {
      id: uid(),
      type: "image",
      x: (svg.clientWidth / 2 - board.view.x) / board.view.scale - width / 2,
      y: (svg.clientHeight / 2 - board.view.y) / board.view.scale - height / 2,
      w: width,
      h: height,
      src,
      rotation: 0,
      locked: false,
    };
    board.nodes.push(n);
    selectedIds.clear();
    selectedIds.add(n.id);
    changed();
    setTool("select");
  } catch (error) {
    notify(error.message || "The image could not be added.");
  }
  event.target.value = "";
};

// Keyboard shortcuts
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input,textarea,select,dialog")) return;
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === 'Enter' && selectedIds.size === 1) { event.preventDefault(); editText(); return; }

  if (event.code === "Space") {
    if (event.target.closest("button")) return;
    space = true;
    event.preventDefault();
    return;
  }
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (mod && event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicate();
    return;
  }
  if (mod && event.key.toLowerCase() === "f") {
    event.preventDefault();
    toggleSearch();
    return;
  }
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    $("#save-file").click();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    remove();
    return;
  }
  if (event.key === "Escape") {
    if (!$("#presentation-bar").hidden) {
      endPresentation();
      return;
    }
    selectedIds.clear();
    connecting = null;
    setTool("select");
    render();
    return;
  }

  const tools = {
    v: "select",
    h: "hand",
    e: "eraser",
    r: "rect",
    o: "ellipse",
    d: "diamond",
    n: "note",
    t: "text",
    p: "pen",
    b: "highlighter",
    c: "connector",
    f: "frame",
  };
  if (!mod && tools[event.key.toLowerCase()]) {
    setTool(tools[event.key.toLowerCase()]);
  }
});

document.addEventListener("keyup", (event) => {
  if (event.code === "Space") space = false;
});

addEventListener("blur", () => {
  space = false;
  finishGesture();
});
addEventListener("resize", queueDraw);
addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && dirty) saveNow();
});

// App Initialization
async function init() {
  try {
    boards = await stored("list");
    board = boards.sort((a, b) => b.updatedAt - a.updatedAt)[0] || createBoard();
    await saveNow();
  } catch {
    $("#save-status").textContent = "Device storage unavailable — save a copy";
    notify("Local storage is unavailable. You can still work and save a board file.");
  }

  const savedTheme = localStorage.getItem("canvascloud-theme") || "light";
  applyTheme(savedTheme === "dark");

  ready = true;
  render();
  renderLibrary();
  setTool("select");
}

init();
