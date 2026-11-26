// Hook PreToolUse (Bash e PowerShell): nega staging em massa, --no-verify, push
// forçado em branch protegida e atribuição de IA; pede confirmação no push, no
// commit -a e quando há documentação no stage. Nega .env e chave privada. Regra: instrucoes/regras.md (Git).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { commandsIn, directoryChange, gitCall, options, valueOf } from "./git-command.mjs";
import { secretsInDiff, secretsInPaths } from "./secrets.mjs";

// `.txt` só conta em docs/: requirements.txt e CMakeLists.txt são código.
const DOC_PATH = /(^|[/\\])docs([/\\]|$)|\.(md|mdx|rst)$/i;
const AI_ATTRIBUTION = /co-authored-by:|generated with \[?claude|noreply@anthropic\.com/i;
const PROTECTED = /^(refs\/heads\/)?(main|master|develop)$/;
const COMMIT_LONG_VALUED = [
  "--message", "--file", "--author", "--date", "--reuse-message", "--reedit-message",
  "--template", "--trailer", "--fixup", "--squash", "--cleanup", "--pathspec-from-file",
];

const deny = (reason) => ({ decision: "deny", reason });
const ask = (reason) => ({ decision: "ask", reason });

function git(repository, ...args) {
  try {
    return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

const denySecrets = (files) =>
  deny(`Segredo não entra no git (.env ou chave privada): ${files.join(", ")}. Tire do stage e use .env.example sem valores.`);

// O que o commit leva: o stage; com -a, tudo que é rastreado; com arquivos, a
// versão deles na árvore de trabalho (mais o stage, se houver -i).
function commitScopes(repository, flags, paths) {
  const all = flags.includes("-a") || flags.includes("--all");
  const included = flags.includes("-i") || flags.includes("--include");
  // Sem commit não há HEAD para comparar: o arquivo já precisa estar no stage.
  if (!(all || paths.length) || !git(repository, "rev-parse", "--verify", "HEAD")) return [["--cached"]];
  if (all) return [["HEAD"]];
  return included ? [["--cached"], ["HEAD", paths]] : [["HEAD", paths]];
}

// Sem conseguir ler o diff, pergunta: falha interna não libera o commit.
function checkCommitSecrets(repository, flags, paths) {
  if (!git(repository, "rev-parse", "--git-dir")) return [];
  try {
    const scopes = commitScopes(repository, flags, paths);
    const files = [...new Set(scopes.flatMap(([range, only]) => secretsInDiff(repository, range, only)))];
    return files.length ? [denySecrets(files)] : [];
  } catch {
    return [ask("Não foi possível conferir segredos no commit. Confira antes de prosseguir.")];
  }
}

function isBulk(path, repository) {
  if (path === "." || path === ":/" || /[/\\]$/.test(path)) return true;
  const full = resolve(repository, path);
  if (existsSync(full)) return statSync(full).isDirectory();
  return /[*?[]/.test(path);
}

function checkAdd({ args, repository }) {
  const { flags, operands } = options(args);
  if (flags.some((f) => ["-A", "-u", "--all", "--update"].includes(f)) || operands.some((p) => isBulk(p, repository)))
    return [deny("Staging em massa é proibido (git add -A, -u, ., glob, diretório). Adicione caminhos de arquivo explícitos.")];
  const secrets = secretsInPaths(operands, repository);
  if (secrets.length) return [denySecrets(secrets)];
  if (operands.some((path) => DOC_PATH.test(path)))
    return [ask("Este git add inclui documentação (.md/.mdx/.rst ou docs/). Só prossiga com consentimento explícito para este commit.")];
  return [];
}

function checkCommit({ args, repository }) {
  const { flags, operands } = options(args, "mFCct", "uS", COMMIT_LONG_VALUED);
  if (flags.includes("--no-verify") || flags.includes("-n"))
    return [deny("Regra do plugin mold: commit nunca usa --no-verify (-n).")];
  const found = checkCommitSecrets(repository, flags, operands);
  if (flags.includes("-a") || flags.includes("--all"))
    found.push(ask("git commit -a coloca tudo que mudou no commit, inclusive documentação. Prefira git add com caminhos explícitos."));
  const docs = git(repository, "diff", "--cached", "--name-only", "-z").split("\0").filter((f) => DOC_PATH.test(f));
  if (docs.length > 0)
    found.push(ask(`Há documentação no stage: ${docs.join(", ")}. Só prossiga com consentimento explícito para este commit.`));
  return found;
}

function pushTargets(operands, repository) {
  const refs = operands.slice(1);
  if (refs.length === 0) return [git(repository, "symbolic-ref", "--short", "HEAD").trim()];
  const targets = refs.map((ref) => ref.replace(/^\+/, "").split(":").pop());
  return targets.map((target) => (target === "HEAD" ? git(repository, "symbolic-ref", "--short", "HEAD").trim() : target));
}

// Trocar a pasta de hooks equivale a `--no-verify`.
function checkHooksPath({ sub, configs }) {
  if (!["commit", "push"].includes(sub) || !configs.some((c) => /^core\.hookspath=/i.test(c))) return [];
  return [deny("Regra do plugin mold: git -c core.hooksPath pula os hooks do repositório, como --no-verify.")];
}

function checkPush({ args, repository }) {
  const { flags, operands } = options(args, "o");
  const forced =
    flags.some((f) => f === "-f" || f.startsWith("--force")) || operands.slice(1).some((ref) => ref.startsWith("+"));
  if (forced && pushTargets(operands, repository).some((target) => PROTECTED.test(target)))
    return [deny("Push forçado em main, master ou develop é proibido.")];
  return [ask("Push exige confirmação do usuário, a cada vez. Em main ou develop, siga a skill `mold:deploy` (checagens do CI, acompanhar a execução).")];
}

function fileText(path, repository) {
  try {
    return path && path !== "-" ? readFileSync(resolve(repository, path), "utf8") : "";
  } catch {
    return "";
  }
}

// Heredoc e -m aparecem na própria linha; -F e --body-file, no arquivo.
function checkAttribution(line, command, call, folder) {
  const isPullRequest = command.name === "gh" && command.args[0] === "pr" && ["create", "edit"].includes(command.args[1]);
  if (call?.sub !== "commit" && !isPullRequest) return [];
  const file = isPullRequest ? valueOf(command.args, "-F", "--body-file") : valueOf(call.args, "-F", "--file");
  if (!AI_ATTRIBUTION.test(line) && !AI_ATTRIBUTION.test(fileText(file, call?.repository ?? cwd))) return [];
  return [deny("Regra do plugin mold: commits e PRs não levam Co-Authored-By nem atribuição de IA. Remova a linha e refaça.")];
}

const CHECKS = { add: checkAdd, commit: checkCommit, push: checkPush };

function reply(output) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...output } }));
}

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || "{}");
const line = String(input?.tool_input?.command ?? "");
const cwd = input.cwd ?? process.cwd();

const results = [];
let commits = false;
let folder = cwd;
for (const command of commandsIn(line)) {
  const target = directoryChange(command);
  // Destino inexistente (variável, pasta ainda não criada): fica onde estava.
  if (target && existsSync(resolve(folder, target))) folder = resolve(folder, target);
  const parsed = gitCall(command);
  const call = parsed && { ...parsed, repository: resolve(folder, parsed.repository) };
  commits ||= call?.sub === "commit";
  if (call) results.push(...checkHooksPath(call));
  results.push(...checkAttribution(line, command, call, cwd), ...(CHECKS[call?.sub]?.(call) ?? []));
}

const verdict = results.find((r) => r.decision === "deny") ?? results[0];
if (verdict) reply({ permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason });
// Commit liberado: lembra a skill, que o agente pode ter pulado.
else if (commits)
  reply({ additionalContext: "Antes de commitar, siga a skill `mold:commit` (strings mágicas, stage explícito, sem atribuição de IA)." });
