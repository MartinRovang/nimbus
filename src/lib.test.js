import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, splitRows, buildTree, ago, mapPR, tok } from "./lib.js";

test("diff parsing, split pairing, tree, PR mapping", () => {
  const [h] = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -3,3 +3,4 @@ fn\n a\n-b\n+B\n+C\n c\n\\ No newline at end of file\n");
  assert.deepEqual(h.rows.map((r) => [r.sign, r.o, r.n]), [[" ", 3, 3], ["-", 4, ""], ["+", "", 4], ["+", "", 5], [" ", 5, 6]]);
  assert.deepEqual(splitRows(h.rows).map((r) => r.l.k + r.r.k), ["  ", "-+", "x+", "  "]);

  const paths = ["README.md", "src/a.rs", "src/ui/b.rs"];
  assert.deepEqual(buildTree(paths, () => false).map((n) => n.path), ["README.md", "src"]);
  assert.deepEqual(buildTree(paths, (d) => d === "src").map((n) => n.path), ["README.md", "src", "src/a.rs", "src/ui"]);

  assert.equal(ago("2026-01-01T00:00:00Z", Date.parse("2026-01-01T03:00:00Z")), "3h ago");
  const pr = mapPR({ number: 7, state: "OPEN", isDraft: false, reviewDecision: "APPROVED", createdAt: new Date().toISOString(), author: { login: "a" },
    statusCheckRollup: [{ name: "test", status: "COMPLETED", conclusion: "FAILURE" }, { context: "ci", state: "PENDING" }], files: [{ path: "x", additions: 1, deletions: 2 }] });
  assert.deepEqual([pr.state, pr.review, pr.checks.map((c) => c.k), pr.files[0].dels], ["open", "Approved", ["fail", "pending"], 2]);
  assert.deepEqual(tok("let x = 1 // hi").map((t) => t.t), ["let", " ", "x", " ", "=", " ", "1", " ", "// hi"]);
});
