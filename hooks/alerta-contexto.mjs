// Hook Stop: avisa quando o contexto da sessão passa de 100k tokens e, depois,
// a cada marca de 50k (150k, 200k...). Cada marca avisa uma vez por sessão.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIRST_MARK = 100_000;
const STEP = 50_000;

function contextTokens(transcriptPath) {
  const lines = readFileSync(transcriptPath, "utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"usage"')) continue;
    const entry = JSON.parse(lines[i]);
    const usage = entry.message?.usage;
    // Subagentes têm contexto próprio.
    if (!usage || entry.isSidechain) continue;
    const total =
      (usage.input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    if (total > 0) return total;
  }
  return 0;
}

// Maior marca já ultrapassada; 0 abaixo da primeira.
function reachedMark(tokens) {
  if (tokens < FIRST_MARK) return 0;
  if (tokens < FIRST_MARK + STEP) return FIRST_MARK;
  return Math.floor(tokens / STEP) * STEP;
}

function lastMark(stateFile) {
  try {
    return Number(readFileSync(stateFile, "utf8"));
  } catch {
    return 0;
  }
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const tokens = contextTokens(input.transcript_path);
  const mark = reachedMark(tokens);
  const stateFile = join(tmpdir(), `claude-contexto-${input.session_id}`);
  const previous = lastMark(stateFile);
  // Grava também quando a marca cai (compactação), para voltar a avisar.
  if (mark !== previous) writeFileSync(stateFile, String(mark));
  if (mark > previous) {
    const message = `Contexto da sessão passou de ${mark / 1000}k tokens (atual: ${Math.round(tokens / 1000)}k). Grave o estado em docs/em-andamento e dê /clear.`;
    process.stdout.write(JSON.stringify({ systemMessage: message }));
  }
} catch {
  // Aviso é acessório: falha nunca interrompe a sessão.
}
