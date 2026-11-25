// Hook PreToolUse (Bash): nega comando de shell sem o prefixo `rtk`.
// Regra: instrucoes/rtk.md.
// Desligado por padrão: só age com a opção `rtk` do plugin ligada.
if (process.env.CLAUDE_PLUGIN_OPTION_RTK !== "true") process.exit(0);

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

const input = JSON.parse((await readStdin()) || "{}");
const command = String(input?.tool_input?.command ?? "");

// Remove heredocs e textos entre aspas para não confundir `;`/`&&` internos.
const flat = command.replace(HEREDOC, " ").replace(QUOTED, '""');

const offenders = flat
  .split(/&&|\|\||;|\n/)
  .map((part) => part.trim().replace(/^(\w+=\S*\s+)+/, ""))
  .filter((part) => part && !EXEMPT.test(part));

if (offenders.length > 0) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Opção RTK do plugin mold: todo comando de shell leva o prefixo rtk. Refaça como "rtk ${offenders[0]}". Se a saída ficou inutilizável, use "rtk bypass <cmd>".`,
      },
    }),
  );
}
process.exit(0);
