// Guardião de sessões paralelas: reserva de caminhos por sessão.
// CLI: [--root <pasta>] claim <sessao> "<tarefa>" <caminho...> | release <sessao> [caminho...]
//      note <sessao-dona> "<pedido>" | list
// Hook: `hook` (SessionStart, PreToolUse, SessionEnd), JSON no stdin.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rtkActive } from "./rtk-available.mjs";

function gitRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

// `--root` vem nos comandos sugeridos: o CLI não recebe CLAUDE_PROJECT_DIR.
const ARGS = process.argv.slice(2);
const AT = ARGS.indexOf("--root");
const GIVEN = AT >= 0 ? ARGS.splice(AT, 2)[1] : undefined;
const ROOT = resolve(GIVEN ?? process.env.CLAUDE_PROJECT_DIR ?? gitRoot());
// Reservas fora do repositório: nenhum projeto precisa ignorá-las no git.
const KEY = createHash("sha1").update(ROOT.toLowerCase()).digest("hex");
const DIR = join(homedir(), ".claude/locks", KEY.slice(0, 12));
const MUTEX = join(DIR, ".mutex");
const TTL_MS = 30 * 60 * 1000;
const MUTEX_STALE_MS = 10_000;
const MUTEX_TRIES = 100;
const MUTEX_WAIT_MS = 50;
const EDIT_TOOLS = ["Edit", "Write", "NotebookEdit"];
const PREFIX = rtkActive() ? "rtk " : "";
const slashes = (path) => path.replaceAll("\\", "/");
const CLI = `${PREFIX}node "${slashes(fileURLToPath(import.meta.url))}" --root "${slashes(ROOT)}"`;

const fileOf = (id) => join(DIR, `${id.replace(/[^\w-]/g, "")}.json`);
const save = (lock) =>
  writeFileSync(fileOf(lock.id), JSON.stringify({ ...lock, seen: Date.now() }));
const describe = (l) => `${l.id} "${l.task}": ${l.paths.join(", ")}`;

// Minúsculas porque o sistema de arquivos do Windows ignora caixa.
const normalize = (path) =>
  relative(ROOT, resolve(ROOT, path.replace(/\/\*\*$/, "")))
    .replaceAll("\\", "/")
    .toLowerCase();
const contains = (area, path) =>
  area === "" || area === path || path.startsWith(`${area}/`);
const overlaps = (a, b) => contains(a, b) || contains(b, a);

// Reservas vivas; as sem sinal há mais de TTL_MS são apagadas.
function activeLocks() {
  const locks = [];
  for (const name of readdirSync(DIR).filter((n) => n.endsWith(".json"))) {
    try {
      const lock = JSON.parse(readFileSync(join(DIR, name), "utf8"));
      if (Date.now() - lock.seen > TTL_MS) rmSync(join(DIR, name));
      else locks.push(lock);
    } catch {
      // gravação em andamento ou arquivo removido por outra sessão
    }
  }
  return locks;
}

// mkdir é atômico: só uma sessão por vez confere e grava reservas.
function withMutex(action) {
  for (let attempt = 0; attempt < MUTEX_TRIES; attempt++) {
    try {
      mkdirSync(MUTEX);
    } catch {
      try {
        if (Date.now() - statSync(MUTEX).mtimeMs > MUTEX_STALE_MS)
          rmdirSync(MUTEX);
      } catch {
        // outra sessão já removeu
      }
      const gate = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(gate, 0, 0, MUTEX_WAIT_MS);
      continue;
    }
    try {
      return action();
    } finally {
      rmdirSync(MUTEX);
    }
  }
  return "registro ocupado; tente de novo.";
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

// Cada comando devolve a mensagem de erro, ou nada em caso de sucesso.
const commands = {
  claim(id, task, ...paths) {
    if (!id || !task || paths.length === 0)
      return 'uso: claim <sessao> "<tarefa>" <caminho...>';
    const wanted = paths.map(normalize);
    if (wanted.some((p) => p.includes("*") || p.startsWith("..")))
      return "use arquivo, pasta ou pasta/** dentro do projeto.";
    const locks = activeLocks();
    const busy = locks.filter(
      (l) =>
        l.id !== id && l.paths.some((a) => wanted.some((b) => overlaps(a, b))),
    );
    if (busy.length) return `OCUPADO por ${busy.map(describe).join(" | ")}`;
    const own = locks.find((l) => l.id === id);
    const merged = [...new Set([...(own?.paths ?? []), ...wanted])];
    save({ notes: [], ...own, id, task, paths: merged });
  },
  release(id = "", ...paths) {
    const own = activeLocks().find((l) => l.id === id);
    if (!own) return;
    if (own.notes.length)
      process.stdout.write(`Pedidos pendentes: ${own.notes.join(" | ")}\n`);
    const gone = paths.map(normalize);
    const left = own.paths.filter((p) => !gone.includes(p));
    if (paths.length && left.length) save({ ...own, paths: left });
    else rmSync(fileOf(id));
  },
  note(id, message) {
    const owner = activeLocks().find((l) => l.id === id);
    if (!owner || !message) return "sessão sem reserva ou pedido vazio.";
    // Preserva `seen`: pedido alheio não pode manter viva uma reserva órfã.
    const notes = [...owner.notes, message];
    writeFileSync(fileOf(id), JSON.stringify({ ...owner, notes }));
  },
  list() {
    const lines = activeLocks().map(describe).join("\n");
    process.stdout.write(`${lines || "livre"}\n`);
  },
};

function isDirty(target) {
  try {
    const args = ["-C", dirname(target), "status", "--porcelain", "--", basename(target)];
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "";
  } catch {
    return false;
  }
}

// Primeira edição de arquivo livre o reserva; devolve bloqueio ou aviso.
function reserve(id, target, locks) {
  const path = normalize(target);
  // Fora do projeto (scratchpad, memória) não há disputa.
  if (path.startsWith("..") || /^[a-z]:/.test(path)) return {};
  const covers = (l) => l.paths.some((a) => contains(a, path));
  const owner = locks.find((l) => l.id !== id && covers(l));
  if (owner)
    return {
      blocked:
        `Bloqueado: ${path} reservado por ${describe(owner)}. ` +
        `Siga outra etapa do seu pedido ou: ${CLI} note ${owner.id} "<pedido>"`,
    };
  const own = locks.find((l) => l.id === id);
  if (own && covers(own)) return {};
  save({ id, task: "edição", notes: [], ...own, paths: [...(own?.paths ?? []), path] });
  if (!isDirty(target)) return {};
  return { warning: `${path} já tinha alterações não commitadas antes desta reserva.` };
}

// Todo uso de ferramenta renova a reserva e entrega os pedidos recebidos.
function beforeTool({ session_id: id, tool_name: tool, tool_input: args }) {
  const own = activeLocks().find((l) => l.id === id);
  if (own) save({ ...own, notes: [] });
  const context = own?.notes.length ? [`Pedidos de outras sessões: ${own.notes.join(" | ")}`] : [];
  const target = args?.file_path ?? args?.notebook_path;
  if (!EDIT_TOOLS.includes(tool) || !target) return { context };
  const { blocked, warning } = reserve(id, target, activeLocks());
  return { blocked, context: warning ? [...context, warning] : context };
}

function hook(input) {
  const { hook_event_name: event, session_id: id } = input;
  if (event === "SessionEnd") return rmSync(fileOf(id), { force: true });
  if (event === "SessionStart") {
    const others = activeLocks().filter((l) => l.id !== id).map(describe);
    process.stdout.write(
      `Guardião: sua sessão é ${id}. A primeira edição reserva o arquivo. CLI: ${CLI}\n` +
        (others.length ? `Reservado: ${others.join(" | ")}\n` : ""),
    );
    return;
  }

  // Conferir e gravar sob o mesmo mutex: duas sessões não reservam juntas.
  const result = withMutex(() => beforeTool(input));
  if (typeof result === "string") {
    if (EDIT_TOOLS.includes(input.tool_name)) fail(result);
    return;
  }
  if (result.blocked) fail(result.blocked);
  if (result.context.length === 0) return;
  const additionalContext = result.context.join("\n");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext } }));
}

const [command, ...args] = ARGS;
mkdirSync(DIR, { recursive: true });
if (command === "hook") {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  hook(JSON.parse(raw || "{}"));
} else if (Object.hasOwn(commands, command)) {
  const error = withMutex(() => commands[command](...args));
  if (error) fail(error);
} else {
  fail("comandos: claim | release | note | list");
}
