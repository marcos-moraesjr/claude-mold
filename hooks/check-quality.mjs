// Hook Stop: bloqueia o fim do turno se um arquivo alterado na sessão passar de
// 500 linhas ou se a checagem declarada para o projeto falhar. A declaração fica
// em ~/.claude/qualidade.json ({"<raiz do projeto>": "<comando>"}), nunca no
// repositório: um clone de terceiro não pode mandar comando para este hook.
// Pasta sem git (vários repositórios lado a lado): confere cada repositório filho.
// `base` (SessionStart) grava o HEAD inicial: commit no meio não esconde mudança.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MAX_FILE_LINES = 500;
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|cs|php|rb|swift)$/;
const GENERATED_FILE = /\.gen\.|\.min\.|(^|\/)(dist|build|vendor|node_modules|locales)\//;
const STATE_DIR = join(homedir(), ".claude/mold/base");

const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", input: "", stdio: ["pipe", "pipe", "ignore"] });
const countLines = (text) => text.split("\n").length;

// Repositório atual; fora de um, os repositórios filhos diretos.
function repositories(folder) {
  try {
    return [{ root: resolve(git(folder, "rev-parse", "--show-toplevel").trim()), prefix: "" }];
  } catch {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(folder, entry.name, ".git")))
      .map((entry) => ({ root: resolve(folder, entry.name), prefix: `${entry.name}/` }));
  }
}

// HEAD atual, ou a árvore vazia em repositório sem commit.
function headOf(root) {
  try {
    return git(root, "rev-parse", "--verify", "HEAD").trim();
  } catch {
    return git(root, "hash-object", "-t", "tree", "--stdin").trim();
  }
}

const stateFile = (session) => join(STATE_DIR, `${session.replace(/[^\w-]/g, "")}.json`);

function loadState(session) {
  try {
    return JSON.parse(readFileSync(stateFile(session), "utf8"));
  } catch {
    return { bases: {}, warned: false };
  }
}

function saveState(session, state) {
  if (!session) return;
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFile(session), JSON.stringify(state));
}

// Não sobrescreve: `resume` e `compact` mantêm a base do início da sessão.
function recordBases(session, folder) {
  const state = loadState(session);
  for (const { root } of repositories(folder)) state.bases[root] ??= headOf(root);
  saveState(session, state);
}

// Base ausente ou apagada por reescrita de histórico: compara com o HEAD.
function usableBase(root, base) {
  try {
    git(root, "cat-file", "-e", base);
    return base;
  } catch {
    return headOf(root);
  }
}

// [{ file, previous }] alterados desde a base, inclusive não rastreados.
function changedFiles(root, base) {
  const fields = git(root, "diff", "--name-status", "-z", "-M", "--diff-filter=d", base).split("\0");
  const changed = [];
  for (let index = 0; fields[index]; index += 2) {
    const renamed = /^[RC]/.test(fields[index]);
    const previous = fields[index + 1];
    if (renamed) index++;
    changed.push({ file: fields[index + 1], previous });
  }
  const untracked = git(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  return [...changed, ...untracked.map((file) => ({ file, previous: file }))];
}

const changedSources = (root, base) =>
  changedFiles(root, base).filter(({ file }) => SOURCE_FILE.test(file) && !GENERATED_FILE.test(file));

// Arquivo legado já acima do limite só reprova se crescer; novo conta como 0.
function linesAt(root, base, file) {
  try {
    return countLines(git(root, "show", `${base}:${file}`));
  } catch {
    return 0;
  }
}

function oversized({ root, prefix }, base, { file, previous }) {
  try {
    const lines = countLines(readFileSync(join(root, file), "utf8"));
    if (lines > MAX_FILE_LINES && lines > linesAt(root, base, previous))
      return [`${prefix}${file}: ${lines} linhas (máximo ${MAX_FILE_LINES}).`];
  } catch {
    // arquivo removido ou ilegível: ignora
  }
  return [];
}

function declaredCheck(root) {
  try {
    const map = JSON.parse(readFileSync(join(homedir(), ".claude/qualidade.json"), "utf8"));
    const key = (path) => resolve(path).toLowerCase();
    return Object.entries(map).find(([path]) => key(path) === key(root))?.[1];
  } catch {
    return undefined;
  }
}

// Linhas "AVISO:" de uma checagem aprovada aparecem ao usuário sem bloquear.
function runDeclared(root, command) {
  try {
    const passed = execSync(command, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { problems: [], warnings: passed.split("\n").filter((line) => line.startsWith("AVISO:")) };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    return { problems: [`${command} falhou:\n${output.slice(0, 3000)}`], warnings: [] };
  }
}

function checkRepository(repository, state) {
  const { root } = repository;
  const base = usableBase(root, state.bases[root] ?? headOf(root));
  const changed = changedSources(root, base);
  if (changed.length === 0) return { problems: [], warnings: [], undeclared: false };
  const sizes = changed.flatMap((entry) => oversized(repository, base, entry));
  const command = declaredCheck(root);
  const declared = command ? runDeclared(root, command) : { problems: [], warnings: [] };
  return { problems: [...sizes, ...declared.problems], warnings: declared.warnings, undeclared: !command };
}

// Segunda parada no mesmo turno: avisa em vez de bloquear, para não entrar em laço.
function report(problems, warnings, repeated) {
  const failure = problems.length ? `Qualidade reprovou antes de encerrar. Corrija:\n${problems.join("\n")}` : "";
  const message = [repeated ? failure : "", ...warnings].filter(Boolean).join("\n");
  const output = {
    ...(failure && !repeated && { decision: "block", reason: failure }),
    ...(message && { systemMessage: message }),
  };
  if (Object.keys(output).length) process.stdout.write(JSON.stringify(output));
}

function check({ session_id: session, stop_hook_active: repeated }, folder) {
  const state = loadState(session ?? "");
  const results = repositories(folder).map((repository) => checkRepository(repository, state));
  const warnings = results.flatMap((result) => result.warnings);
  if (session && !state.warned && results.some((result) => result.undeclared)) {
    warnings.push("Sem checagem declarada em ~/.claude/qualidade.json: só o limite de linhas foi conferido.");
    saveState(session, { ...state, warned: true });
  }
  report(results.flatMap((result) => result.problems), warnings, repeated);
}

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || "{}");
const folder = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (process.argv[2] === "base") {
  if (input.session_id) recordBases(input.session_id, folder);
} else check(input, folder);
