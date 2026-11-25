import { readFileSync } from "node:fs";
import { join } from "node:path";
// Hook UserPromptSubmit: lembra o agente de carregar a skill certa quando o
// pedido do usuário contém um gatilho conhecido. É determinístico de propósito:
// o acionamento por descrição depende do julgamento do modelo e pode falhar.

const TRIGGERS = [
  {
    skill: "mold:commit",
    pattern:
      /\b(commit\w*|pull request|abr\w+ (um )?pr|cri\w+ (uma )?(nova )?branch|nova branch)\b/,
  },
  {
    skill: "mold:fechar-entrega",
    pattern:
      /\b(esta pronto|pode fechar|fechar (a )?entrega|definicao de pronto|pode marcar como concluid\w+|acabou\?|terminamos\?)/,
  },
  {
    skill: "mold:documentar",
    pattern:
      /\b(documente|documentar|documentacao|atualiz\w+ (a |as )?docs?)\b/,
  },
  {
    skill: "mold:deploy",
    pattern: /\b(deploy\w*|rollback|ci vermelho|subir para (a )?producao)\b/,
  },
  {
    skill: "mold:protocolo-remoto",
    pattern: /\b(protocolo remoto|modo remoto|longe do computador)\b/,
  },
];

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
  });
}

function withoutAccents(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Gatilhos do projeto ({"<skill>": "<regex>"}). Nome fora do formato é ignorado:
// o arquivo vem do repositório e o nome entra no contexto do agente.
function projectTriggers() {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  try {
    const declared = JSON.parse(readFileSync(join(root, ".claude/gatilhos.json"), "utf8"));
    return Object.entries(declared)
      .filter(([skill]) => /^([\w-]+:)?[\w-]+$/.test(skill))
      .map(([skill, source]) => ({ skill, pattern: new RegExp(source) }));
  } catch {
    return [];
  }
}

const input = JSON.parse((await readStdin()) || "{}");
const prompt = withoutAccents(String(input?.prompt ?? "").toLowerCase());
const matches = [...TRIGGERS, ...projectTriggers()].filter(({ pattern }) => pattern.test(prompt));
const skills = [...new Set(matches.map(({ skill }) => skill))];

if (skills.length > 0) {
  const list = skills.map((skill) => `\`${skill}\``).join(", ");
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `Este pedido combina com a(s) skill(s): ${list}. Carregue-a(s) e siga-a(s) antes de agir.`,
      },
    }),
  );
}
