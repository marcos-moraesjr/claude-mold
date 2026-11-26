// Guardião de sessões paralelas: reserva de caminhos por sessão.
// CLI: [--root <pasta>] claim <sessao> "<tarefa>" <caminho...> | release <sessao> [caminho...]
//      note <sessao-dona> "<pedido>" | list
// Hook: `hook` (SessionStart, PreToolUse, Stop, SessionEnd), JSON no stdin.
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
// Raiz do repositório: sessões abertas em subpastas disputam o mesmo registro.
// `--show-cdup` é relativo e mantém a grafia de ROOT (nome curto do Windows).
function repositoryTop(folder) {
  try {
    const args = ["-C", folder, "rev-parse", "--show-cdup"];
    const up = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return resolve(folder, up.trim());
  } catch {
    return folder;
  }
}
const TOP = repositoryTop(ROOT);
// Reservas fora do repositório: nenhum projeto precisa ignorá-las no git.
const KEY = createHash("sha1").update(TOP.toLowerCase()).digest("hex");
const DIR = join(homedir(), ".claude/locks", KEY.slice(0, 12));
const MUTEX = join(DIR, ".mutex");
// Sem extensão .json: activeLocks() não pode lê-lo como reserva.
const OWNERS = join(DIR, "owners");
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
const within = (base, path) =>
  relative(TOP, resolve(base, path.replace(/\/\*\*$/, "")))
    .replaceAll("\\", "/")
    .toLowerCase();
const normalize = (path) => within(ROOT, path);
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

// Último dono de cada arquivo: sobrevive à liberação da reserva.
function lastOwners() {
  try {
    return JSON.parse(readFileSync(OWNERS, "utf8"));
  } catch {
    // ausente ou ilegível: dono desconhecido
    return {};
  }
}

// Devolve o dono anterior, ou nada se desconhecido.
function recordOwner(path, id) {
  const owners = lastOwners();
  const previous = owners[path];
  if (previous !== id) writeFileSync(OWNERS, JSON.stringify({ ...owners, [path]: id }));
  return previous;
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

// O argumento vale como o `list` o exibe (a partir de TOP) ou relativo a --root;
// se casar das duas formas, vence o exibido.
function matchReserved(reserved, paths) {
  const gone = [];
  const unknown = [];
  for (const path of paths) {
    const found = [within(TOP, path), normalize(path)].find((p) => reserved.includes(p));
    if (found === undefined) unknown.push(path);
    else gone.push(found);
  }
  return { gone, unknown };
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
    // Claim torna manual o que era automático.
    const auto = (own?.auto ?? []).filter((p) => !wanted.includes(p));
    save({ notes: [], ...own, id, task, paths: merged, auto });
  },
  release(id = "", ...paths) {
    const own = activeLocks().find((l) => l.id === id);
    if (!own) return;
    if (own.notes.length)
      process.stdout.write(`Pedidos pendentes: ${own.notes.join(" | ")}\n`);
    const { gone, unknown } = matchReserved(own.paths, paths);
    const left = own.paths.filter((p) => !gone.includes(p));
    if (paths.length && left.length) save({ ...own, paths: left });
    else rmSync(fileOf(id));
    if (unknown.length)
      return `sem reserva para: ${unknown.join(", ")}. Reservados: ${left.join(", ") || "nenhum"}`;
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

// Fim do turno: saem as reservas automáticas; as manuais esperam release.
function releaseAutomatic(id) {
  const own = activeLocks().find((l) => l.id === id);
  if (!own) return;
  const manual = own.paths.filter((p) => !own.auto?.includes(p));
  if (manual.length) save({ ...own, paths: manual, auto: [] });
  else rmSync(fileOf(id));
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
  // Registra também sob reserva própria: pasta reservada não lista os arquivos editados.
  const previous = recordOwner(path, id);
  if (own && covers(own)) return {};
  const paths = [...(own?.paths ?? []), path];
  const auto = [...(own?.auto ?? []), path];
  save({ id, task: "edição", notes: [], ...own, paths, auto });
  if (previous === id || !isDirty(target)) return {};
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
  // Sem saída: com o registro ocupado, a reserva expira pelo TTL.
  if (event === "Stop") return void withMutex(() => releaseAutomatic(id));
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
