// Teste do guardião: node --test tests/*.test.mjs
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  assert.equal(run(["claim", "a", "tarefa A", "src/x/**"]).status, 0);
  assert.equal(edit("a", "src/x/f.ts").status, 0);
  assert.equal(edit("a", "src/xy/f.ts").status, 0, "arquivo livre");
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

// Sem CLAUDE_PROJECT_DIR no CLI: é assim que o agente o chama.
test("sessão em subpasta: o comando sugerido pelo hook usa a mesma raiz", () => {
  const repo = join(root, "repo");
  const sub = join(repo, "src");
  mkdirSync(sub, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repo });
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  delete env.CLAUDE_PROJECT_DIR;
  const start = spawnSync(process.execPath, [script, "hook"], {
    encoding: "utf8",
    env: { ...env, CLAUDE_PROJECT_DIR: sub },
    input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "s" }),
  });
  assert.ok(start.stdout.includes(`--root "${sub.replaceAll("\\", "/")}"`), start.stdout);
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: sub, env, encoding: "utf8" });
  assert.equal(cli("--root", sub, "claim", "s", "t", "a").status, 0);
  assert.match(cli("--root", sub, "list").stdout, /s "t": src\/a/);
});

test("sessões na raiz e na subpasta disputam o mesmo registro", () => {
  const repo = join(root, "mono");
  const sub = join(repo, "src");
  mkdirSync(sub, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repo });
  assert.equal(run(["--root", sub, "claim", "g", "sub", "a.ts"]).status, 0);
  assert.equal(run(["--root", repo, "claim", "h", "raiz", "src/a.ts"]).status, 2);
  assert.equal(run(["--root", repo, "claim", "h", "raiz", "doc.md"]).status, 0);
  assert.equal(run(["--root", sub, "claim", "g", "sub", "../doc.md"]).status, 2);
  assert.equal(run(["--root", sub, "release", "g", "a.ts"]).status, 0);
  assert.equal(run(["--root", repo, "claim", "h", "raiz", "src/a.ts"]).status, 0);
});

test("primeira edição reserva; arquivo sujo gera aviso", () => {
  spawnSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "sujo.ts"), "x");
  assert.match(edit("c", "sujo.ts").stdout, /não commitadas/);
  assert.equal(edit("c", "sujo.ts").stdout, "", "avisa só ao reservar");
  assert.match(edit("d", "sujo.ts").stderr, /Bloqueado/);
});

test("duas sessões simultâneas: só uma reserva", async () => {
  const start = (id) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [script, "hook"], {
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: root, USERPROFILE: root },
      });
      child.on("close", resolve);
      child.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", session_id: id, tool_name: "Edit", tool_input: { file_path: join(root, "disputa.ts") } }));
    });
  const codes = await Promise.all(["e", "f"].map(start));
  assert.deepEqual(codes.sort(), [0, 2]);
});

const stop = (id) => run(["hook"], JSON.stringify({ hook_event_name: "Stop", session_id: id }));
const lockDir = () =>
  join(root, ".claude/locks", createHash("sha1").update(root.toLowerCase()).digest("hex").slice(0, 12));
const freshRepo = (name) => {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "f.ts"), "x");
  return `${name}/f.ts`;
};

test("Stop libera a reserva automática, mantém a manual e não imprime nada", () => {
  assert.equal(edit("i", "stop/auto.ts").status, 0);
  assert.equal(edit("i", "stop/virou.ts").status, 0);
  assert.equal(run(["claim", "i", "manual", "stop/virou.ts", "stop/pasta"]).status, 0);
  assert.equal(edit("j", "stop/auto.ts").status, 2, "automática bloqueia");
  assert.equal(edit("j", "stop/virou.ts").status, 2, "manual bloqueia");
  const done = stop("i");
  assert.deepEqual([done.status, done.stdout, done.stderr], [0, "", ""]);
  const list = run(["list"]).stdout;
  assert.doesNotMatch(list, /stop\/auto\.ts/);
  assert.match(list, /stop\/virou\.ts, stop\/pasta/);
  assert.equal(run(["release", "i"]).status, 0);
});

test("após o Stop, outra sessão edita o arquivo", () => {
  assert.equal(edit("k", "livre.ts").status, 0);
  assert.equal(edit("l", "livre.ts").status, 2);
  assert.equal(stop("k").status, 0);
  assert.equal(edit("l", "livre.ts").status, 0);
});

test("arquivo sujo: a mesma sessão reedita sem aviso; outra recebe o aviso", () => {
  const file = freshRepo("dono");
  assert.match(edit("m", file).stdout, /não commitadas/, "dono desconhecido");
  stop("m");
  assert.equal(edit("m", file).stdout, "");
  stop("m");
  assert.match(edit("n", file).stdout, /não commitadas/);
});

test("edição sob reserva manual de pasta atualiza o último dono", () => {
  const file = freshRepo("pasta-manual");
  edit("o", file);
  stop("o");
  assert.equal(run(["claim", "p", "pasta", "pasta-manual"]).status, 0);
  edit("p", file);
  assert.equal(run(["release", "p"]).status, 0);
  assert.match(edit("o", file).stdout, /não commitadas/);
});

test("registro de donos não aparece no list nem quebra o hook", () => {
  const file = freshRepo("registro");
  edit("q", file);
  stop("q");
  assert.doesNotMatch(run(["list"]).stdout, /registro\/f\.ts|undefined/);
  const owners = join(lockDir(), "owners");
  assert.equal(JSON.parse(readFileSync(owners, "utf8"))["registro/f.ts"], "q");
  writeFileSync(owners, "{quebrado");
  const again = edit("q", file);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /não commitadas/, "registro ilegível: dono desconhecido");
});

const subfolderCli = (name) => {
  const repo = join(root, name);
  const sub = join(repo, "src");
  mkdirSync(sub, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repo });
  return (...args) => run(["--root", sub, ...args]);
};

test("release em subpasta aceita o caminho do list e o relativo a --root", () => {
  const cli = subfolderCli("solta");
  assert.equal(cli("claim", "r", "t", "a.ts", "b.ts", "c.ts").status, 0);
  assert.equal(cli("release", "r", "src/A.ts").status, 0);
  assert.equal(cli("release", "r", "b.ts").status, 0);
  assert.match(cli("list").stdout, /r "t": src\/c\.ts\n/);
  assert.equal(cli("release", "r").status, 0, "sem caminhos libera tudo");
  assert.match(cli("list").stdout, /livre/);
  const none = cli("release", "r", "c.ts");
  assert.deepEqual([none.status, none.stdout, none.stderr], [0, "", ""], "sessão sem reserva");
});

test("release ambíguo: vale o caminho exibido pelo list", () => {
  const cli = subfolderCli("ambigua");
  assert.equal(cli("claim", "s1", "t", "a.ts", "src/a.ts").status, 0);
  assert.equal(cli("release", "s1", "src/a.ts").status, 0);
  assert.match(cli("list").stdout, /s1 "t": src\/src\/a\.ts\n/);
  assert.equal(cli("release", "s1").status, 0);
});

test("release de caminho não reservado sai com erro e libera os que correspondem", () => {
  const cli = subfolderCli("parcial");
  assert.equal(cli("claim", "u", "t", "a.ts", "b.ts").status, 0);
  const none = cli("release", "u", "x.ts");
  assert.equal(none.status, 2);
  assert.match(none.stderr, /x\.ts.*src\/a\.ts, src\/b\.ts/);
  const part = cli("release", "u", "a.ts", "y.ts");
  assert.equal(part.status, 2);
  assert.match(part.stderr, /y\.ts.*src\/b\.ts/);
  assert.doesNotMatch(part.stderr, /a\.ts/);
  assert.match(cli("list").stdout, /u "t": src\/b\.ts\n/);
  assert.equal(cli("release", "u").status, 0);
});
