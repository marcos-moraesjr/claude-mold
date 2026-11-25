// Hook Stop: bloqueia o fim do turno se um arquivo alterado passar de 500 linhas
// ou se a checagem declarada para o projeto falhar. A declaração fica em
// ~/.claude/qualidade.json ({"<raiz do projeto>": "<comando>"}), nunca no
// repositório: um clone de terceiro não pode mandar comando para este hook.
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MAX_FILE_LINES = 500;
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|cs|php|rb|swift)$/;
const GENERATED_FILE = /\.gen\.|\.min\.|(^|\/)(dist|build|vendor|node_modules|locales)\//;

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const countLines = (text) => text.split("\n").length;

// Arquivo legado já acima do limite só reprova se crescer; novo conta como 0.
function linesAtHead(file) {
  try {
    return countLines(git(["show", `HEAD:${file}`]));
  } catch {
    return 0;
  }
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

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
// Evita laço: se já bloqueamos uma vez neste turno, deixa encerrar.
if (JSON.parse(raw || "{}").stop_hook_active) process.exit(0);

let root;
let changed;
try {
  root = git(["rev-parse", "--show-toplevel"]).trim();
  process.chdir(root);
  changed = git(["status", "--porcelain", "-uall"])
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith(" D") && !line.startsWith("D"))
    .map((line) => line.slice(3).split(" -> ").pop().trim())
    .filter((file) => SOURCE_FILE.test(file) && !GENERATED_FILE.test(file));
} catch {
  process.exit(0);
}
if (changed.length === 0) process.exit(0);

const problems = [];
for (const file of changed) {
  try {
    const lines = countLines(readFileSync(file, "utf8"));
    if (lines > MAX_FILE_LINES && lines > linesAtHead(file))
      problems.push(`${file}: ${lines} linhas (máximo ${MAX_FILE_LINES}).`);
  } catch {
    // arquivo removido ou ilegível: ignora
  }
}

const command = declaredCheck(root);
// Linhas "AVISO:" de uma checagem aprovada aparecem ao usuário sem bloquear.
let warnings = [];
if (command) {
  try {
    const passed = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    warnings = passed.split("\n").filter((line) => line.startsWith("AVISO:"));
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    problems.push(`${command} falhou:\n${output.slice(0, 3000)}`);
  }
}

if (problems.length === 0 && warnings.length > 0) {
  process.stdout.write(JSON.stringify({ systemMessage: warnings.join("\n") }));
}
if (problems.length > 0) {
  process.stdout.write(
    JSON.stringify({ decision: "block", reason: `Qualidade reprovou antes de encerrar. Corrija:\n${problems.join("\n")}` }),
  );
}
