import test from "node:test";
import assert from "node:assert/strict";
import {
  createBoard,
  removeNode,
  moveNode,
  validateBoard,
  History,
  bounds,
  connectionEndpoints,
} from "../src/model.js";
const shape = (id, x = 0) => ({
  id,
  type: "rect",
  x,
  y: 0,
  w: 200,
  h: 100,
  fill: "#eeeeee",
  stroke: "#111111",
  text: "Hello",
  fontSize: 20,
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
