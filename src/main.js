import "./styles.css";
import {
  COLORS,
  uid,
  createBoard,
  bounds,
  connectionEndpoints,
  removeNode,
  moveNode,
  validateBoard,
  History,
} from "./model.js";
const $ = (selector) => document.querySelector(selector);
const svg = $("#canvas"),
  world = $("#world"),
  history = new History();
let board = createBoard(),
  boards = [],
  selected = null,
  tool = "select",
  gesture = null,
  space = false,
  connecting = null,
  saveTimer,
  drawFrame;
let ready = false,
  dirty = false;
const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open("bluecloud-canvas", 1);
  request.onupgradeneeded = () =>
    request.result.createObjectStore("boards", { keyPath: "id" });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function stored(action, value) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      "boards",
      action === "list" ? "readonly" : "readwrite",
    );
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
  $(".toast").textContent = message;
  $(".toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $(".toast").classList.remove("show"), 3500);
}
function safeName() {
  return (
    board.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim() || "Untitled board"
  );
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
    notify(
      "Device storage is unavailable or full. Use Save a copy to keep your board.",
    );
    return false;
  }
}
function persist() {
  board.updatedAt = Date.now();
  dirty = true;
  $("#save-status").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
function checkpoint() {
  history.push(board);
}
function changed() {
  persist();
  render();
}
function node() {
  return board.nodes.find((n) => n.id === selected);
}
function el(tag, attrs = {}, text) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs))
    element.setAttribute(key, String(value));
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
        for (let i = 0; i < word.length; i += limit)
          result.push(word.slice(i, i + limit));
      } else current += (current ? " " : "") + word;
    }
    if (current) result.push(current);
  }
  return result;
}
function drawObject(n) {
  const group = el("g", {
    "data-id": n.id,
    "data-kind": n.type,
    class: "board-node",
  });
  if (n.type === "connector") {
    const a = board.nodes.find((o) => o.id === n.from),
      b = board.nodes.find((o) => o.id === n.to);
    if (!a || !b) return group;
    const [p, q] = connectionEndpoints(a, b);
    group.append(
      el("line", {
        x1: p.x,
        y1: p.y,
        x2: q.x,
        y2: q.y,
        stroke: "transparent",
        "stroke-width": 18 / board.view.scale,
      }),
    );
    group.append(
      el("line", {
        x1: p.x,
        y1: p.y,
        x2: q.x,
        y2: q.y,
        stroke: n.stroke || "#777084",
        "stroke-width": 2.2,
        "marker-end": "url(#arrowhead)",
      }),
    );
    return group;
  }
  if (n.type === "pen") {
    const d = n.points
      .map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`)
      .join(" ");
    group.append(
      el("path", {
        d,
        fill: "none",
        stroke: "transparent",
        "stroke-width": 15 / board.view.scale,
      }),
    );
    group.append(
      el("path", {
        d,
        fill: "none",
        stroke: n.stroke || "#70578d",
        "stroke-width": 3,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
    return group;
  }
  if (n.type === "image") {
    group.append(
      el("image", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        href: n.src,
        preserveAspectRatio: "none",
      }),
    );
    return group;
  }
  const style = {
    fill: n.fill,
    stroke: n.type === "text" ? "none" : n.stroke,
    "stroke-width": 1.5,
  };
  if (n.type === "ellipse")
    group.append(
      el("ellipse", {
        cx: n.x + n.w / 2,
        cy: n.y + n.h / 2,
        rx: n.w / 2,
        ry: n.h / 2,
        ...style,
      }),
    );
  else if (n.type === "diamond")
    group.append(
      el("polygon", {
        points: `${n.x + n.w / 2},${n.y} ${n.x + n.w},${n.y + n.h / 2} ${n.x + n.w / 2},${n.y + n.h} ${n.x},${n.y + n.h / 2}`,
        ...style,
      }),
    );
  else
    group.append(
      el("rect", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        rx: n.type === "note" ? 2 : 12,
        ...style,
        fill: n.type === "text" ? "transparent" : n.fill,
      }),
    );
  if (n.type === "note")
    group.append(
      el("path", {
        d: `M ${n.x} ${n.y + 20} H ${n.x + n.w}`,
        stroke: n.stroke,
        "stroke-opacity": 0.18,
        "stroke-width": 1,
      }),
    );
  const padding = n.type === "diamond" ? n.w * 0.23 : 18;
  const fontSize = n.fontSize || 20;
  const wrapped = lines(n.text, n.w - padding * 2, fontSize);
  const maxLines = Math.max(1, Math.floor((n.h - 28) / (fontSize * 1.4)));
  const visible = wrapped.slice(0, maxLines);
  if (wrapped.length > maxLines)
    visible[visible.length - 1] = visible.at(-1).slice(0, -1) + "…";
  const text = el("text", {
    x: n.x + padding,
    y: n.y + (n.type === "note" ? 42 : fontSize + 20),
    "font-family": "Segoe UI, Arial, sans-serif",
    "font-size": fontSize,
    fill: "#40354c",
    class: "board-label",
  });
  visible.forEach((line, i) =>
    text.append(
      el("tspan", { x: n.x + padding, dy: i === 0 ? 0 : fontSize * 1.4 }, line),
    ),
  );
  group.append(text);
  return group;
}
function draw() {
  drawFrame = null;
  world.replaceChildren();
  world.setAttribute(
    "transform",
    `translate(${board.view.x} ${board.view.y}) scale(${board.view.scale})`,
  );
  for (const n of [
    ...board.nodes.filter((n) => n.type === "connector"),
    ...board.nodes.filter((n) => n.type !== "connector"),
  ])
    world.append(drawObject(n));
  const n = node();
  if (n) {
    const box = bounds([n]);
    if (box) {
      world.append(
        el("rect", {
          x: box.x - 5,
          y: box.y - 5,
          width: Math.max(5, box.w) + 10,
          height: Math.max(5, box.h) + 10,
          class: "selection-outline",
        }),
      );
      if (n.type !== "pen")
        world.append(
          el("rect", {
            x: n.x + n.w - 5 / board.view.scale,
            y: n.y + n.h - 5 / board.view.scale,
            width: 10 / board.view.scale,
            height: 10 / board.view.scale,
            class: "resize-handle",
            "data-resize": n.id,
          }),
        );
    } else if (n.type === "connector") {
      const line = world.querySelector(
        `[data-id="${CSS.escape(n.id)}"] line:last-child`,
      );
      line?.setAttribute("stroke", "#7950ca");
    }
  }
  $("#empty-state").hidden = board.nodes.length > 0;
  $("#object-count").textContent =
    `${board.nodes.length} object${board.nodes.length === 1 ? "" : "s"}`;
  $("#zoom-level").textContent = Math.round(board.view.scale * 100) + "%";
  $("#undo").disabled = !history.past.length;
  $("#redo").disabled = !history.future.length;
  const pattern = $("#dots");
  const s = 24 * board.view.scale;
  pattern.setAttribute("width", s);
  pattern.setAttribute("height", s);
  pattern.setAttribute("x", board.view.x % s);
  pattern.setAttribute("y", board.view.y % s);
}
function queueDraw() {
  if (!drawFrame) drawFrame = requestAnimationFrame(draw);
}
function inspector() {
  const n = node();
  $("#object-properties").disabled = !n;
  $("#selection-name").textContent = n
    ? {
        note: "Sticky note",
        rect: "Rectangle",
        ellipse: "Ellipse",
        diamond: "Diamond",
        text: "Text",
        pen: "Drawing",
        connector: "Connector",
        image: "Image",
      }[n.type]
    : "Your canvas";
  $("#selection-help").textContent = n
    ? "Move it on the board, or change its details below."
    : "Select something on the board to change its appearance.";
  $("#object-text").value = n?.text || "";
  $("#object-text").disabled =
    !n || ["pen", "connector", "image"].includes(n.type);
  $("#fill-color").disabled =
    !n || ["pen", "connector", "image", "text"].includes(n.type);
  $("#stroke-color").disabled = !n || ["text", "image"].includes(n.type);
  $("#font-size").disabled =
    !n || ["pen", "connector", "image"].includes(n.type);
  $("#fill-color").value = n?.fill || "#eee7f7";
  $("#stroke-color").value = n?.stroke || "#967cba";
  $("#font-size").value = n?.fontSize || 20;
}
function render() {
  draw();
  inspector();
  $("#board-title").value = board.name;
}
function renderLibrary() {
  const list = $("#board-list");
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
      if (
        !confirm(
          `Delete “${b.name}” from this device? Save a copy first if you want to keep it.`,
        )
      )
        return;
      try {
        await stored("delete", b.id);
        boards = boards.filter((v) => v.id !== b.id);
        if (board.id === b.id) {
          clearTimeout(saveTimer);
          board = boards[0] ? structuredClone(boards[0]) : createBoard();
          history.past = [];
          history.future = [];
          selected = null;
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
  selected = null;
  connecting = null;
  history.past = [];
  history.future = [];
  render();
  renderLibrary();
}
async function newBoard() {
  if (!(await saveNow())) return;
  board = createBoard("Untitled board");
  selected = null;
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
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === value);
      b.setAttribute("aria-pressed", String(b.dataset.tool === value));
    });
  $("#tool-hint").textContent =
    value === "connector"
      ? "Click one shape, then another to connect them."
      : value === "hand"
        ? "Drag to move around. Ctrl + scroll to zoom."
        : value === "pen"
          ? "Drag to draw."
          : value === "select"
            ? "Select an object to edit. Hold Space to pan."
            : "Click or drag on the board to add " +
              ({
                note: "a sticky note",
                rect: "a rectangle",
                ellipse: "an ellipse",
                diamond: "a diamond",
                text: "text",
              }[value] || "an object") +
              ".";
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
  return {
    id: uid(),
    type,
    x,
    y,
    w: type === "text" ? 260 : 220,
    h: type === "note" ? 190 : type === "text" ? 90 : 140,
    fill: colors[0],
    stroke: colors[1],
    fontSize: 20,
    text:
      type === "note"
        ? "Your next idea"
        : type === "text"
          ? "Add a thought"
          : "",
  };
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
  selected = n.id;
  changed();
  setTool("select");
  editText();
}
function editText() {
  const n = node();
  if (!n || ["pen", "connector", "image"].includes(n.type)) return;
  $("#edit-text").value = n.text;
  $("#text-editor").showModal();
  $("#edit-text").focus();
  $("#edit-text").select();
}
svg.addEventListener("pointerdown", (event) => {
  if (!ready || event.button === 2) return;
  const p = point(event);
  const id = event.target.closest("[data-id]")?.dataset.id;
  const resize = event.target.getAttribute("data-resize");
  svg.setPointerCapture(event.pointerId);
  svg.focus();
  if (tool === "hand" || space || event.button === 1) {
    gesture = {
      kind: "pan",
      clientX: event.clientX,
      clientY: event.clientY,
      x: board.view.x,
      y: board.view.y,
    };
    event.preventDefault();
    return;
  }
  if (resize && tool === "select") {
    checkpoint();
    gesture = {
      kind: "resize",
      id: resize,
      start: p,
      initial: structuredClone(node()),
    };
    return;
  }
  if (tool === "connector") {
    const n = board.nodes.find((n) => n.id === id);
    if (!n || ["connector", "pen"].includes(n.type)) {
      notify("Choose a shape, note, text, or image to connect.");
      return;
    }
    if (!connecting) {
      connecting = id;
      selected = id;
      render();
      notify("Now choose the second shape.");
    } else if (connecting !== id) {
      checkpoint();
      const link = {
        id: uid(),
        type: "connector",
        from: connecting,
        to: id,
        stroke: "#777084",
      };
      board.nodes.push(link);
      selected = link.id;
      connecting = null;
      changed();
      setTool("select");
    }
    return;
  }
  if (tool === "select") {
    selected = id || null;
    render();
    if (id) {
      const n = node();
      if (n.type !== "connector") {
        checkpoint();
        gesture = {
          kind: "move",
          id,
          start: p,
          initial: structuredClone(n),
          moved: false,
        };
      }
    }
    return;
  }
  if (tool === "pen") {
    checkpoint();
    const n = {
      id: uid(),
      type: "pen",
      points: [p],
      stroke: $("#stroke-color").value || "#70578d",
    };
    board.nodes.push(n);
    selected = n.id;
    gesture = { kind: "pen", id: n.id };
    queueDraw();
    return;
  }
  checkpoint();
  const n = addShape(tool, p.x, p.y);
  board.nodes.push(n);
  selected = n.id;
  gesture = { kind: "create", id: n.id, start: p, moved: false };
  queueDraw();
});
svg.addEventListener("pointermove", (event) => {
  if (!gesture) return;
  const p = point(event),
    n = board.nodes.find((n) => n.id === gesture.id);
  if (gesture.kind === "pan") {
    board.view.x = gesture.x + event.clientX - gesture.clientX;
    board.view.y = gesture.y + event.clientY - gesture.clientY;
  } else if (gesture.kind === "move" && n) {
    const dx = p.x - gesture.start.x,
      dy = p.y - gesture.start.y;
    Object.assign(n, structuredClone(gesture.initial));
    moveNode(n, dx, dy);
    gesture.moved = Math.abs(dx) + Math.abs(dy) > 1;
  } else if (gesture.kind === "resize" && n) {
    n.w = Math.max(60, gesture.initial.w + p.x - gesture.start.x);
    n.h = Math.max(50, gesture.initial.h + p.y - gesture.start.y);
  } else if (gesture.kind === "create" && n) {
    const dx = p.x - gesture.start.x,
      dy = p.y - gesture.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) {
      gesture.moved = true;
      n.x = Math.min(p.x, gesture.start.x);
      n.y = Math.min(p.y, gesture.start.y);
      n.w = Math.max(60, Math.abs(dx));
      n.h = Math.max(50, Math.abs(dy));
    }
  } else if (gesture.kind === "pen" && n) {
    const last = n.points.at(-1);
    if (
      Math.hypot(p.x - last.x, p.y - last.y) > 1 / board.view.scale &&
      n.points.length < 10000
    )
      n.points.push(p);
  }
  queueDraw();
});
function finishGesture() {
  if (!gesture) return;
  const ended = gesture;
  gesture = null;
  const n = board.nodes.find((n) => n.id === ended.id);
  if (ended.kind === "pen" && n?.points.length < 2) {
    removeNode(board, n.id);
    selected = null;
    history.past.pop();
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
    selected = id;
    render();
    editText();
  }
});
function zoomTo(
  scale,
  screenX = svg.clientWidth / 2,
  screenY = svg.clientHeight / 2,
) {
  scale = Math.max(0.15, Math.min(4, scale));
  const x = (screenX - board.view.x) / board.view.scale,
    y = (screenY - board.view.y) / board.view.scale;
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
      zoomTo(
        board.view.scale * Math.exp(-event.deltaY * 0.005),
        event.clientX - r.left,
        event.clientY - r.top,
      );
    } else {
      board.view.x -= event.deltaX;
      board.view.y -= event.deltaY;
      persist();
      queueDraw();
    }
  },
  { passive: false },
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
        (svg.clientHeight - padding * 2) / Math.max(box.h, 1),
      ),
    ),
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
  selected = null;
  changed();
}
function redo() {
  board = history.redo(board);
  selected = null;
  changed();
}
function duplicate() {
  const n = node();
  if (!n || n.type === "connector") return;
  checkpoint();
  const copy = structuredClone(n);
  copy.id = uid();
  moveNode(copy, 28, 28);
  board.nodes.push(copy);
  selected = copy.id;
  changed();
}
function remove() {
  if (!selected) return;
  checkpoint();
  removeNode(board, selected);
  selected = null;
  changed();
}
document
  .querySelectorAll("[data-tool]")
  .forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$("#first-note").onclick = addFirstNote;
$("#new-board").onclick = newBoard;
$("#undo").onclick = undo;
$("#redo").onclick = redo;
$("#duplicate").onclick = duplicate;
$("#remove").onclick = remove;
$("#front").onclick = () => {
  const n = node();
  if (!n) return;
  checkpoint();
  board.nodes = board.nodes.filter((o) => o.id !== n.id);
  board.nodes.push(n);
  changed();
};
$("#board-title").addEventListener("input", () => {
  board.name = $("#board-title").value.trim() || "Untitled board";
  persist();
  renderLibrary();
});
for (const [selector, prop] of [
  ["#object-text", "text"],
  ["#fill-color", "fill"],
  ["#stroke-color", "stroke"],
  ["#font-size", "fontSize"],
])
  $(selector).addEventListener("change", () => {
    const n = node();
    if (!n) return;
    checkpoint();
    n[prop] =
      prop === "fontSize" ? Number($(selector).value) : $(selector).value;
    changed();
  });
$("#text-editor").addEventListener("close", () => {
  if ($("#text-editor").returnValue === "save" && node()) {
    checkpoint();
    node().text = $("#edit-text").value;
    changed();
  }
});
$("#shortcuts").onclick = () => $("#help-dialog").showModal();
$("#close-help").onclick = () => $("#help-dialog").close();
$("#zoom-in").onclick = () => zoomTo(board.view.scale * 1.2);
$("#zoom-out").onclick = () => zoomTo(board.view.scale / 1.2);
$("#zoom-level").onclick = () => zoomTo(1);
$("#fit").onclick = fit;
async function download(content, type, extension) {
  if (window.__TAURI__?.core?.invoke) {
    try {
      const saved = await window.__TAURI__.core.invoke("save_export", {
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
$("#save-file").onclick = () =>
  download(JSON.stringify(board, null, 2), "application/json", ".canvascloud");
$("#export-svg").onclick = async () => {
  const box = bounds(board.nodes);
  if (!box) {
    notify("Add something to the board before exporting.");
    return;
  }
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
      fill: "#ffffff",
    }),
  );
  for (const n of [
    ...board.nodes.filter((n) => n.type === "connector"),
    ...board.nodes.filter((n) => n.type !== "connector"),
  ]) {
    const g = drawObject(n);
    g.querySelectorAll('[stroke="transparent"]').forEach((e) => e.remove());
    g.querySelectorAll("text").forEach((e) => e.removeAttribute("class"));
    root.append(g);
  }
  await download(
    new XMLSerializer().serializeToString(root),
    "image/svg+xml",
    ".svg",
  );
};
async function importContent(content) {
  const imported = validateBoard(JSON.parse(content));
  if (!(await saveNow())) return;
  board = imported;
  selected = null;
  history.past = [];
  history.future = [];
  await saveNow();
  render();
  fit();
  notify("Board opened on this device.");
}
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
    if (file.size > 50000000)
      throw Error("This board is too large to open (50 MB limit).");
    await importContent(await file.text());
  } catch (error) {
    notify(error.message || "That board could not be opened.");
  }
  event.target.value = "";
};
$("#add-image").onclick = () => $("#image-file").click();
$("#image-file").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw Error("Choose a PNG, JPEG, or WebP image.");
    if (file.size > 10000000)
      throw Error("Choose an image smaller than 10 MB.");
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
    const width = Math.min(500, img.naturalWidth),
      height = (width * img.naturalHeight) / img.naturalWidth;
    const n = {
      id: uid(),
      type: "image",
      x: (svg.clientWidth / 2 - board.view.x) / board.view.scale - width / 2,
      y: (svg.clientHeight / 2 - board.view.y) / board.view.scale - height / 2,
      w: width,
      h: height,
      src,
    };
    board.nodes.push(n);
    selected = n.id;
    changed();
    setTool("select");
  } catch (error) {
    notify(error.message || "The image could not be added.");
  }
  event.target.value = "";
};
$("#starter").onclick = () => {
  checkpoint();
  const offset = (bounds(board.nodes)?.w || 0) + 80;
  const a = addShape("note", offset, 160),
    b = addShape("rect", offset + 330, 185),
    c = addShape("ellipse", offset + 660, 185);
  a.text = "What are we exploring?\n\nStart with a question.";
  b.text = "Ideas worth trying";
  c.text = "The next small step";
  board.nodes.push(
    a,
    b,
    c,
    { id: uid(), type: "connector", from: a.id, to: b.id, stroke: "#9a8aaa" },
    { id: uid(), type: "connector", from: b.id, to: c.id, stroke: "#9a8aaa" },
  );
  selected = null;
  changed();
  fit();
};
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input,textarea,select,dialog")) return;
  const mod = event.ctrlKey || event.metaKey;
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
    selected = null;
    connecting = null;
    setTool("select");
    render();
    return;
  }
  const tools = {
    v: "select",
    h: "hand",
    r: "rect",
    o: "ellipse",
    d: "diamond",
    n: "note",
    t: "text",
    p: "pen",
    c: "connector",
  };
  if (!mod && tools[event.key.toLowerCase()])
    setTool(tools[event.key.toLowerCase()]);
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
async function init() {
  try {
    boards = await stored("list");
    board =
      boards.sort((a, b) => b.updatedAt - a.updatedAt)[0] || createBoard();
    await saveNow();
  } catch {
    $("#save-status").textContent = "Device storage unavailable — save a copy";
    notify(
      "Local storage is unavailable. You can still work and save a board file.",
    );
  }
  ready = true;
  render();
  renderLibrary();
  setTool("select");
}
const toolIcons = {
  select: "M4 3 20 12 12 13 8 21Z",
  hand: "M8 12V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-4-1-6-4l-3-5a2 2 0 0 1 3-2l3 3",
  note: "M4 3h16v13l-5 5H4ZM15 21v-5h5",
  rect: "M4 5h16v14H4Z",
  ellipse: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  diamond: "m12 3 9 9-9 9-9-9Z",
  text: "M4 6V4h16v2M12 4v16M8 20h8",
  pen: "m4 20 1-6L16 3l5 5-11 11ZM14 5l5 5M5 14l5 5",
  connector: "M4 20 20 4M12 4h8v8",
  image: "M3 3h18v18H3ZM3 17l6-6 5 5 4-4 3 3M9 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0",
};
for (const button of document.querySelectorAll("[data-tool], #add-image")) {
  const icon = el("svg", {
    viewBox: "0 0 24 24",
    width: 20,
    height: 20,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.7,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  icon.append(el("path", { d: toolIcons[button.dataset.tool || "image"] }));
  button.replaceChildren(icon);
}
init();
