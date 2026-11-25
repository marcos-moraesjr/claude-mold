// Hook SessionStart. Plugin não distribui CLAUDE.md nem rules, então as
// instruções entram por aqui. `regras` e `projeto` são chamadas separadas para
// cada saída ficar abaixo do limite de contexto de um hook.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const IN_PROGRESS = /^Status:\s*em andamento/im;
const TASKS = "docs/em-andamento";

const instruction = (name) =>
  readFileSync(new URL(`../instrucoes/${name}.md`, import.meta.url), "utf8");

function rules() {
  const names = ["regras", "codigo", "docs", "estilo-resposta"];
  if (process.env.CLAUDE_PLUGIN_OPTION_RTK === "true") names.push("rtk");
  return names.map(instruction);
}

function tasksInProgress() {
  try {
    return readdirSync(join(root, TASKS))
      .filter((name) => name.endsWith(".md"))
      .filter((name) => IN_PROGRESS.test(readFileSync(join(root, TASKS, name), "utf8").slice(0, 400)))
      .map((name) => `${TASKS}/${name}`);
  } catch {
    return [];
  }
}

function projectIndex() {
  try {
    return readFileSync(join(root, ".claude/skills/INDEX.md"), "utf8");
  } catch {
    return "";
  }
}

function project() {
  const tasks = tasksInProgress();
  const resume =
    tasks.length > 0
      ? `Tarefas longas em andamento (skill \`mold:tarefa-longa\`; leia o arquivo antes de reexplorar): ${tasks.join(", ")}.`
      : "";
  return [resume, projectIndex()];
}

const parts = process.argv[2] === "projeto" ? project() : rules();
const context = parts.filter(Boolean).join("\n");

if (context) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }),
  );
}
