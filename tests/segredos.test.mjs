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

const commitAll = (cwd) => {
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], { cwd });
};

// Arquivo já rastreado que ganha uma chave sem passar pelo stage.
function leaked(name) {
  const repo = repository(name, { "app.ts": "a\n", "ok.ts": "a\n" });
  commitAll(repo);
  writeFileSync(join(repo, "app.ts"), `${KEY}\n`);
  return repo;
}

test("cd antes do commit confere o repositório de destino", () => {
  const repo = repository("destino", { ".env": SECRET });
  stage(repo, ".env");
  for (const command of ["cd destino && git commit -m x", "Set-Location -Path destino; git commit -m x"])
    assert.match(run("guard-doc-staging.mjs", { cwd: root, tool_input: { command } }), /"deny".*\.env/);
});

test("commit <arquivo> e commit -a conferem o que está fora do stage", () => {
  const repo = leaked("fora-do-stage");
  for (const command of ["git commit app.ts -m x", "git commit -m x -- app.ts", "git commit -am x", "git commit --all -m x"])
    assert.match(guard(repo, command), /"deny".*app\.ts/, command);
  assert.doesNotMatch(guard(repo, "git commit ok.ts -m x"), /"deny"/);
});

test("valor de opção longa não vira arquivo do commit", () => {
  const repo = leaked("opcao-longa");
  writeFileSync(join(repo, "ok.ts"), `${KEY}\n`);
  stage(repo, "ok.ts");
  assert.match(guard(repo, "git commit --message x"), /"deny".*ok\.ts/);
  assert.doesNotMatch(guard(repo, "git commit --message x"), /app\.ts/);
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
