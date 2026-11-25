// Teste do guardião: node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../hooks/lock.mjs", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "lock-"));
after(() => rmSync(root, { recursive: true, force: true }));

const run = (args, input) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: root, USERPROFILE: root },
  });
const edit = (id, file) =>
  run(
    ["hook"],
    JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: id,
      tool_name: "Edit",
      tool_input: { file_path: join(root, file) },
    }),
  );

test("reserva, bloqueio, pedido, expiração e liberação", () => {
  assert.equal(edit("a", "src/x/f.ts").status, 2, "sem reserva");
  assert.equal(run(["claim", "a", "tarefa A", "src/x/**"]).status, 0);
  assert.equal(edit("a", "src/x/f.ts").status, 0);
  assert.equal(edit("a", "src/xy/f.ts").status, 2, "prefixo não é pasta");
  assert.match(edit("b", "src/x/f.ts").stderr, /tarefa A/);
  assert.equal(run(["claim", "b", "B", "src"]).status, 2, "pasta mãe");
  assert.equal(run(["claim", "b", "B", "src/X/f.ts"]).status, 2, "caixa");
  assert.equal(edit("b", "../fora.ts").status, 0);

  assert.equal(run(["note", "a", "preciso de Y"]).status, 0);
  assert.match(edit("a", "src/x/f.ts").stdout, /preciso de Y/);
  assert.equal(edit("a", "src/x/f.ts").stdout, "", "entrega uma vez");

  const key = createHash("sha1").update(root.toLowerCase()).digest("hex");
  const file = join(root, ".claude/locks", key.slice(0, 12), "a.json");
  const lock = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...lock, seen: 0 }));
  assert.equal(run(["claim", "b", "B", "src/x"]).status, 0, "órfã expira");

  assert.equal(run(["release", "b"]).status, 0);
  assert.match(run(["list"]).stdout, /livre/);
});
