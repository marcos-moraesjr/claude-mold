// Hook PreToolUse (Bash): nega comando de shell sem o prefixo `rtk` e leitura
// de arquivo por `rtk bypass cat`.
// Regra: instrucoes/rtk.md.
// Desligado por padrão: só age com a opção `rtk` do plugin ligada.
import { rtkActive } from "./rtk-available.mjs";

if (!rtkActive()) process.exit(0);

const EXEMPT = /^(cd|rtk|export|set|exit|true|false|:)(\s|$)/;
const HEREDOC = /<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\s*\1\b/g;
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g;

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
  });
}

// `cat` que só lê despeja o arquivo sem condensar; escrever ou encadear passa.
const DISCARDED = /\d?>\s*\/dev\/null|2>&1/g;
const BYPASS_READ = /^rtk\s+bypass\s+cat\b[^<>|]*$/;

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
}

const input = JSON.parse((await readStdin()) || "{}");
const command = String(input?.tool_input?.command ?? "");

// Remove heredocs e textos entre aspas para não confundir `;`/`&&` internos.
const flat = command.replace(HEREDOC, " ").replace(QUOTED, '""');

const parts = flat
  .replace(DISCARDED, " ")
  .split(/&&|\|\||;|\n/)
  .map((part) => part.trim().replace(/^(\w+=\S*\s+)+/, ""))
  .filter(Boolean);

const offender = parts.find((part) => !EXEMPT.test(part));

if (offender) {
  deny(`Opção RTK do plugin mold: todo comando de shell leva o prefixo rtk. Refaça como "rtk ${offender}". Se a saída ficou inutilizável, use "rtk bypass <cmd>".`);
} else if (parts.some((part) => BYPASS_READ.test(part))) {
  deny("Opção RTK do plugin mold: não leia arquivo com rtk bypass cat. Use a ferramenta Read, com offset e limit no trecho necessário.");
}
process.exit(0);
