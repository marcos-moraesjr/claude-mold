// Raiz sem git com repositórios filhos, e confirmação do push.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "mold-raiz-"));
after(() => rmSync(root, { recursive: true, force: true }));

function run(script, input) {
  const path = fileURLToPath(new URL(`../hooks/${script}`, import.meta.url));
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  const result = spawnSync(process.execPath, [path], { cwd: root, env, encoding: "utf8", input: JSON.stringify(input) });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function repository(name, lines) {
  const path = join(root, name);
  mkdirSync(path);
  execFileSync("git", ["init", "-q"], { cwd: path });
  writeFileSync(join(path, "grande.py"), "x = 1\n".repeat(lines));
}

test("raiz sem git confere o limite em cada repositório filho", () => {
  repository("api", 520);
  repository("front", 10);
  const output = run("check-quality.mjs", {});
  assert.match(output, /"block"/);
  assert.match(output, /api\/grande\.py: 521 linhas/);
  assert.doesNotMatch(output, /front\/grande\.py/);
});

test("push pede confirmação e lembra a skill de deploy", () => {
  const output = run("guard-doc-staging.mjs", { tool_input: { command: "git -C api push" } });
  assert.match(output, /"permissionDecision":"ask"/);
  assert.match(output, /mold:deploy/);
});
