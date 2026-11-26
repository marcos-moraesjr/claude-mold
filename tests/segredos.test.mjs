// Segredos no commit, RTK ausente e texto colado na sugestão de skill.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "mold-seg-"));
after(() => rmSync(root, { recursive: true, force: true }));
// Montada por partes: a amostra não pode parecer chave real neste arquivo.
const KEY = ["-----BEGIN", "RSA PRIVATE", "KEY-----"].join(" ");
const SECRET = "valor-secreto-123";

function run(script, input, { args = [], env = {}, cwd = root } = {}) {
  const path = fileURLToPath(new URL(`../hooks/${script}`, import.meta.url));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"));
  const result = spawnSync(process.execPath, [path, ...args], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify(input),
    env: { ...clean, PATH: process.env.PATH, CLAUDE_PROJECT_DIR: cwd, HOME: root, USERPROFILE: root, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function repository(name, files) {
  const path = join(root, name);
  mkdirSync(path);
  execFileSync("git", ["init", "-q"], { cwd: path });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(path, file), text);
  return path;
}

const guard = (cwd, command) => run("guard-doc-staging.mjs", { cwd, tool_input: { command } }, { cwd });
const stage = (cwd, ...files) => execFileSync("git", ["add", "--", ...files], { cwd });

test(".env no add ou no stage é negado; .env.example passa", () => {
  const repo = repository("env", { ".env": SECRET, ".env.local": SECRET, ".env.example": "A=\n" });
  assert.match(guard(repo, "git add .env"), /"deny"/);
  assert.match(guard(repo, "git add .env.local"), /"deny"/);
  assert.doesNotMatch(guard(repo, "git add .env.example"), /"deny"/);
  stage(repo, ".env.local");
  const output = guard(repo, "git commit -m x");
  assert.match(output, /"deny".*\.env\.local/);
  assert.doesNotMatch(output, new RegExp(SECRET));
});

test("chave privada é negada, com o arquivo e sem o valor", () => {
  const repo = repository("chave", { "minha chave.pem": `${KEY}\n${SECRET}\n`, "ok.ts": "const a = 1;\n" });
  assert.match(guard(repo, 'git add "minha chave.pem" && git commit -m x'), /"deny".*minha chave\.pem/);
  stage(repo, "ok.ts", "minha chave.pem");
  const output = guard(repo, "git commit -m x");
  assert.match(output, /"deny".*minha chave\.pem/);
  assert.doesNotMatch(output, new RegExp(`${SECRET}|ok\\.ts`));
});

test("RTK ligado e ausente: avisa e não bloqueia", () => {
  const env = { CLAUDE_PLUGIN_OPTION_RTK: "true", PATH: root };
  assert.equal(run("require-rtk.mjs", { tool_input: { command: "git status" } }, { env }), "");
  const context = run("session-index.mjs", {}, { args: ["regras"], env });
  assert.match(context, /RTK ligado, mas não encontrado/);
  assert.doesNotMatch(context, /leva o prefixo/);
});

test("RTK ligado e presente: exige o prefixo", () => {
  const bin = join(root, "bin");
  mkdirSync(bin);
  const fake = join(bin, process.platform === "win32" ? "rtk.exe" : "rtk");
  writeFileSync(fake, "");
  chmodSync(fake, 0o755);
  const env = { CLAUDE_PLUGIN_OPTION_RTK: "true", PATH: bin };
  assert.match(run("require-rtk.mjs", { tool_input: { command: "git status" } }, { env }), /"deny"/);
});

test("texto colado não dispara skill; o pedido digitado dispara", () => {
  const pasted = '<pasted_content id="a1">\nfazer commit e documentar\n</pasted_content id="a1">';
  assert.equal(run("suggest-skill.mjs", { prompt: `analise o plano\n${pasted}` }), "");
  assert.match(run("suggest-skill.mjs", { prompt: `faça o deploy\n${pasted}` }), /mold:deploy/);
  assert.doesNotMatch(run("suggest-skill.mjs", { prompt: `faça o deploy\n${pasted}` }), /mold:commit/);
});
