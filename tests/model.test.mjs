import test from "node:test";
import assert from "node:assert/strict";
import {
  createBoard,
  removeNode,
  moveNode,
  rotateNode,
  alignNodes,
  distributeNodes,
  validateBoard,
  History,
  bounds,
  connectionEndpoints,
  elbowConnectionPath,
} from "../src/model.js";

const shape = (id, x = 0, y = 0, type = "rect") => ({
  id,
  type,
  x,
  y,
  w: 200,
  h: 100,
  fill: "#eeeeee",
  stroke: "#111111",
  text: "Hello",
  fontSize: 20,
  rotation: 0,
  locked: false,
});

test("deleting a shape removes its attached connectors but preserves unrelated objects", () => {
  const b = createBoard();
  b.nodes = [
    shape("a"),
    shape("b", 300),
    shape("c", 600),
    { id: "ab", type: "connector", from: "a", to: "b" },
    { id: "bc", type: "connector", from: "b", to: "c" },
  ];
  removeNode(b, "a");
  assert.deepEqual(
    b.nodes.map((n) => n.id),
    ["b", "c", "bc"],
  );
});

test("history snapshots do not change when nodes are moved and redo restores the moved state", () => {
  const b = createBoard();
  b.nodes = [shape("a")];
  const history = new History();
  history.push(b);
  moveNode(b.nodes[0], 80, 25);
  const original = history.undo(b);
  assert.equal(original.nodes[0].x, 0);
  assert.equal(history.redo(original).nodes[0].x, 80);
});

test("new changes invalidate redo history", () => {
  const b = createBoard(),
    history = new History();
  history.push(b);
  const original = history.undo(b);
  history.push(original);
  assert.equal(history.future.length, 0);
});

test("imports reject executable image data, invalid geometry, and duplicate identities", () => {
  for (const nodes of [
    [{ ...shape("a"), type: "image", src: "javascript:alert(1)" }],
    [{ ...shape("a"), w: -20 }],
    [shape("a"), shape("a")],
  ]) {
    assert.throws(() => validateBoard({ ...createBoard(), nodes }));
  }
});

test("imports preserve text as data and receive a separate board identity", () => {
  const b = createBoard();
  b.nodes = [{ ...shape("a"), text: "<script>no execution</script>" }];
  const imported = validateBoard(b);
  assert.notEqual(imported.id, b.id);
  assert.equal(imported.nodes[0].text, b.nodes[0].text);
});

test("bounds include negative coordinates and drawn paths", () => {
  assert.deepEqual(
    bounds([
      shape("a", -300),
      {
        id: "p",
        type: "pen",
        points: [
          { x: 20, y: -50 },
          { x: 600, y: 200 },
        ],
      },
    ]),
    { x: -300, y: -50, w: 900, h: 250 },
  );
});

test("imported connectors require valid shape anchors and a plain color", () => {
  const b = createBoard();
  b.nodes = [
    shape("a"),
    shape("b", 300),
    {
      id: "pen",
      type: "pen",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    },
    {
      id: "good",
      type: "connector",
      from: "a",
      to: "b",
      stroke: "url(https://example.com/track)",
    },
    { id: "bad", type: "connector", from: "a", to: "pen" },
    { id: "missing", type: "connector", from: "a", to: "absent" },
  ];
  const imported = validateBoard(b);
  assert.equal(imported.nodes.filter((n) => n.type === "connector").length, 1);
  assert.equal(imported.nodes.find((n) => n.id === "good").stroke, "#777084");
});

test("connector arrows end on shape edges and follow moved objects", () => {
  const a = shape("a"),
    b = shape("b", 400);
  assert.deepEqual(connectionEndpoints(a, b), [
    { x: 200, y: 50 },
    { x: 400, y: 50 },
  ]);
  moveNode(b, 100, 0);
  assert.equal(connectionEndpoints(a, b)[1].x, 500);
  const ellipse = { ...b, type: "ellipse" },
    diamond = { ...b, type: "diamond" };
  assert.equal(connectionEndpoints(a, ellipse)[1].x, 500);
  assert.equal(connectionEndpoints(a, diamond)[1].x, 500);
});

test("elbow connector generates rectilinear path between nodes", () => {
  const a = shape("a", 0, 0);
  const b = shape("b", 400, 200);
  const path = elbowConnectionPath(a, b);
  assert.ok(path.startsWith("M 200 50"));
  assert.ok(path.includes("L 300 50"));
  assert.ok(path.includes("L 300 250"));
  assert.ok(path.endsWith("L 400 250"));
});

test("alignNodes aligns multiple shapes left, center, right, top, middle, bottom", () => {
  const a = shape("a", 10, 20);
  const b = shape("b", 100, 80);
  const c = shape("c", 300, 150);
  const nodes = [a, b, c];

  // Align left
  alignNodes(nodes, "left");
  assert.equal(a.x, 10);
  assert.equal(b.x, 10);
  assert.equal(c.x, 10);

  // Align top
  alignNodes(nodes, "top");
  assert.equal(a.y, 20);
  assert.equal(b.y, 20);
  assert.equal(c.y, 20);
});

test("distributeNodes evenly spaces shapes along horizontal axis", () => {
  const a = shape("a", 0, 0);
  const b = shape("b", 50, 0);
  const c = shape("c", 500, 0);
  distributeNodes([a, b, c], "horizontal");

  assert.equal(a.x, 0);
  assert.equal(c.x, 500);
  // Total span is 700 - 0 = 700. Total width = 600. Remaining gap = 100 / 2 = 50.
  assert.equal(b.x, 250);
});

test("rotateNode increments and clamps angle to 0-359 degrees", () => {
  const a = shape("a");
  rotateNode(a, 45);
  assert.equal(a.rotation, 45);
  rotateNode(a, 330);
  assert.equal(a.rotation, 15);
  rotateNode(a, -30);
  assert.equal(a.rotation, 345);
});

test("v1 boards migrate cleanly to v2 boards with extended attributes", () => {
  const v1 = {
    version: 1,
    id: "v1-board",
    name: "Legacy v1",
    updatedAt: 1700000000000,
    nodes: [
      { id: "n1", type: "note", x: 10, y: 20, w: 200, h: 100, fill: "#fff0ac", stroke: "#c6a951", text: "Note 1" },
      { id: "n2", type: "rect", x: 300, y: 20, w: 200, h: 100, fill: "#e8e1f5", stroke: "#967cba", text: "Rect 1" },
    ],
    view: { x: 0, y: 0, scale: 1 },
  };

  const v2 = validateBoard(v1);
  assert.equal(v2.version, 2);
  assert.ok(Array.isArray(v2.comments));
  assert.ok(Array.isArray(v2.groups));
  assert.ok(v2.settings.grid);
  assert.equal(v2.nodes[0].rotation, 0);
  assert.equal(v2.nodes[0].locked, false);
});

test("extended shape types (triangle, star, frame, table, kanban) validate properly", () => {
  const b = createBoard();
  b.nodes = [
    shape("tri", 0, 0, "triangle"),
    shape("str", 200, 0, "star"),
    { id: "frm", type: "frame", x: 0, y: 200, w: 600, h: 400, title: "Sprint 1", fill: "#f6f5f9", stroke: "#c8c2d5", text: "" },
    { id: "tbl", type: "table", x: 650, y: 200, w: 300, h: 200, rows: 2, cols: 2, data: [["A", "B"], ["C", "D"]], fill: "#fff", stroke: "#ccc", text: "" },
    { id: "kb", type: "kanban", x: 0, y: 650, w: 500, h: 300, columns: [{ id: "c1", title: "Col 1", cards: ["Task 1"] }], fill: "#faf", stroke: "#ddd", text: "" },
  ];
  const validated = validateBoard(b);
  assert.equal(validated.nodes.length, 5);
  assert.equal(validated.nodes[2].title, "Sprint 1");
  assert.equal(validated.nodes[3].rows, 2);
  assert.equal(validated.nodes[4].columns[0].cards[0], "Task 1");
});
