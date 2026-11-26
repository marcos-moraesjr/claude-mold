// Portão de qualidade: base da sessão, commits intermediários e segunda parada.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../hooks/check-quality.mjs", import.meta.url));
const home = mkdtempSync(join(tmpdir(), "mold-q-"));
after(() => rmSync(home, { recursive: true, force: true }));

function run(cwd, input, args = []) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: cwd };
  const result = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8", input: JSON.stringify(input) });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout || "{}");
}

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "ignore" });
const write = (cwd, name, lines) => writeFileSync(join(cwd, name), "x = 1\n".repeat(lines));
const commit = (cwd) => (git(cwd, "add", "-A"), git(cwd, "commit", "-qm", "x"));

function repository(name) {
  const path = join(home, name);
  mkdirSync(path);
  git(path, "init", "-q");
  return path;
}

const start = (cwd, id) => run(cwd, { session_id: id }, ["base"]);

test("commit intermediário não escapa do portão", () => {
  const repo = repository("commit");
  write(repo, "a.py", 10);
  commit(repo);
  start(repo, "s1");
  write(repo, "a.py", 600);
  commit(repo);
  assert.match(run(repo, { session_id: "s1" }).reason, /a\.py: 601 linhas/);
});

test("retomada e compactação não sobrescrevem a base", () => {
  const repo = repository("resume");
  write(repo, "a.py", 10);
  commit(repo);
  start(repo, "s2");
  write(repo, "a.py", 600);
  commit(repo);
  start(repo, "s2");
  assert.equal(run(repo, { session_id: "s2" }).decision, "block");
});

test("repositório sem commit, arquivo com espaço e não rastreado", () => {
  const repo = repository("vazio");
  start(repo, "s3");
  write(repo, "meu arquivo.py", 600);
  assert.match(run(repo, { session_id: "s3" }).reason, /meu arquivo\.py/);
  commit(repo);
  assert.match(run(repo, { session_id: "s3" }).reason, /meu arquivo\.py/);
});

test("legado acima do limite renomeado sem crescer passa", () => {
  const repo = repository("legado");
  write(repo, "velho.py", 600);
  commit(repo);
  start(repo, "s4");
  git(repo, "mv", "velho.py", "novo.py");
  assert.equal(run(repo, { session_id: "s4" }).decision, undefined);
});

test("segunda parada avisa sem bloquear", () => {
  const repo = repository("segunda");
  write(repo, "a.py", 600);
  const output = run(repo, { session_id: "s5", stop_hook_active: true });
  assert.equal(output.decision, undefined);
  assert.match(output.systemMessage, /a\.py: 601 linhas/);
});

test("projeto sem checagem declarada avisa uma vez por sessão", () => {
  const repo = repository("sem-checagem");
  start(repo, "s6");
  write(repo, "a.py", 10);
  assert.match(run(repo, { session_id: "s6" }).systemMessage, /qualidade\.json/);
  assert.equal(run(repo, { session_id: "s6" }).systemMessage, undefined);
});
