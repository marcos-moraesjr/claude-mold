// node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "mold-"));
after(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, ".claude/skills"), { recursive: true });
writeFileSync(join(root, ".claude/skills/INDEX.md"), "indice-do-projeto");
writeFileSync(join(root, ".claude/gatilhos.json"), '{"novo-modulo":"novo modulo"}');

function run(script, args = [], input = {}, rtk = "false") {
  const path = fileURLToPath(new URL(`../hooks/${script}`, import.meta.url));
  const result = spawnSync(process.execPath, [path, ...args], {
    encoding: "utf8",
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_OPTION_RTK: rtk },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const bash = (command) => ({ tool_input: { command } });

test("sem a opção RTK, comando sem prefixo passa", () => {
  assert.equal(run("require-rtk.mjs", [], bash("git status")), "");
});

test("git -C não escapa da proteção do stage e do push", () => {
  assert.match(run("guard-doc-staging.mjs", [], bash("git -C repo add -A")), /"deny"/);
  assert.match(run("guard-doc-staging.mjs", [], bash('git -C "meu repo" add LEIA.md')), /"ask"/);
  assert.match(run("guard-doc-staging.mjs", [], bash("git -C repo push")), /mold:deploy/);
});

test("pedido de deploy sugere a skill uma vez, inclusive com gatilho do projeto", () => {
  writeFileSync(join(root, ".claude/gatilhos.json"), '{"novo-modulo":"novo modulo","mold:deploy":"terraform|deploy"}');
  assert.equal(run("suggest-skill.mjs", [], { prompt: "fazer deploy" }).match(/mold:deploy/g)?.length, 1);
  assert.match(run("suggest-skill.mjs", [], { prompt: "rodar terraform" }), /`mold:deploy`/);
});

test("com a opção RTK, comando sem prefixo é negado", () => {
  assert.match(run("require-rtk.mjs", [], bash("git status"), "true"), /"deny"/);
});

test("instruções injetadas incluem regras e estilo, sem RTK por padrão", () => {
  const output = run("session-index.mjs", ["regras"]);
  assert.match(output, /Padrão de trabalho/);
  assert.match(output, /Regras de código/);
  assert.match(output, /Estilo de resposta/);
  assert.doesNotMatch(output, /rtk/i);
  assert.match(run("session-index.mjs", ["regras"], {}, "true"), /prefixo `rtk`/);
});

test("índice do projeto é injetado à parte", () => {
  assert.match(run("session-index.mjs", ["projeto"]), /indice-do-projeto/);
});

test("gatilhos apontam skills do plugin e do projeto", () => {
  const output = run("suggest-skill.mjs", [], { prompt: "novo módulo e commit" });
  assert.match(output, /`mold:commit`/);
  assert.match(output, /`novo-modulo`/);
});

test("staging em massa é negado", () => {
  assert.match(run("guard-doc-staging.mjs", [], bash("git add -A")), /"deny"/);
});
