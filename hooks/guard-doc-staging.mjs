// Hook PreToolUse (Bash): pede confirmação antes de colocar documentação no
// stage ou no commit, barra o staging em massa e mensagens de commit/PR com
// atribuição de IA, e pede confirmação no push, lembrando a skill `deploy`.
// Regra: instrucoes/regras.md (Git).
import { execFileSync } from "node:child_process";

const DOC_PATH = /(^|[\s"'/\\])(docs[/\\]|[^\s"']+\.(md|mdx|rst|txt)\b)/i;
const BULK_ADD =
  /\bgit(?:\s+-C\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+))*\s+add\s+(-A\b|--all\b|\.(\s|$)|[^\s-][^\s]*[/\\](\s|$))/;
const AI_ATTRIBUTION =
  /co-authored-by:|generated with \[?claude|noreply@anthropic\.com/i;
const PUBLISHES_MESSAGE = /\b(git(?:\s+-C\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+))*\s+commit|gh\s+pr\s+(create|edit))\b/;
const COMMIT_ALL = /\bgit(?:\s+-C\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+))*\s+commit\b[^|;&]*\s(-[a-z]*a[a-z]*|--all)\b/;

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
  });
}

function decide(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// Pasta do `git -C <pasta>`, ou a atual.
function repositoryOf(command) {
  const match = command.match(/\bgit\s+-C\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? ".";
}

function stagedDocs(repository) {
  try {
    const out = execFileSync("git", ["-C", repository, "diff", "--cached", "--name-only"], {
      encoding: "utf8",
    });
    return out.split("\n").filter((file) => DOC_PATH.test(` ${file}`));
  } catch {
    return [];
  }
}

const input = JSON.parse((await readStdin()) || "{}");
const command = String(input?.tool_input?.command ?? "");

if (BULK_ADD.test(command)) {
  decide(
    "deny",
    "Staging em massa é proibido (git add -A, ., diretório). Adicione caminhos de arquivo explícitos.",
  );
}

if (AI_ATTRIBUTION.test(command) && PUBLISHES_MESSAGE.test(command)) {
  decide(
    "deny",
    "Regra do plugin mold: commits e PRs não levam Co-Authored-By nem atribuição de IA. Remova a linha e refaça.",
  );
}

if (/\bgit(?:\s+-C\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+))*\s+push\b/.test(command)) {
  decide(
    "ask",
    "Push exige confirmação do usuário, a cada vez. Em main ou develop, siga a skill `mold:deploy` (checagens do CI, acompanhar a execução).",
  );
}

if (/\bgit(?:\s+-C\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+))*\s+add\b/.test(command) && DOC_PATH.test(command)) {
  decide(
    "ask",
    "Este git add inclui documentação (.md/.mdx/.rst/.txt ou docs/). Só prossiga com consentimento explícito para este commit.",
  );
}

if (/\bgit(?:\s+-C\s+(?:"[^"]*"|\x27[^\x27]*\x27|\S+))*\s+commit\b/.test(command)) {
  if (COMMIT_ALL.test(command)) {
    decide(
      "ask",
      "git commit -a coloca tudo que mudou no commit, inclusive documentação. Prefira git add com caminhos explícitos.",
    );
  }
  const docs = stagedDocs(repositoryOf(command));
  if (docs.length > 0) {
    decide(
      "ask",
      `Há documentação no stage: ${docs.join(", ")}. Só prossiga com consentimento explícito para este commit.`,
    );
  }
  // Commit liberado: lembra a skill, que o agente pode ter pulado.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext:
          "Antes de commitar, siga a skill `mold:commit` (strings mágicas, stage explícito, sem atribuição de IA).",
      },
    }),
  );
}
