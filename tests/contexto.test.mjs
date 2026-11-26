// Economia de contexto: aviso de sessão grande e leitura por `rtk bypass cat`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "mold-contexto-"));
after(() => rmSync(root, { recursive: true, force: true }));
writeFileSync(join(root, process.platform === "win32" ? "rtk.exe" : "rtk"), "");
const pathName = Object.keys(process.env).find((name) => name.toUpperCase() === "PATH");

function run(script, input) {
  const path = fileURLToPath(new URL(`../hooks/${script}`, import.meta.url));
  const env = {
    ...process.env,
    [pathName]: `${root}${delimiter}${process.env[pathName]}`,
    CLAUDE_PLUGIN_OPTION_RTK: "true",
  };
  const result = spawnSync(process.execPath, [path], { encoding: "utf8", input: JSON.stringify(input), env });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function alert(tokens) {
  const transcript = join(root, `${tokens}.jsonl`);
  writeFileSync(transcript, JSON.stringify({ message: { usage: { input_tokens: tokens } } }));
  return run("alerta-contexto.mjs", { transcript_path: transcript, session_id: `${process.pid}-${tokens}` });
}

test("aviso de contexto começa em 100k e orienta gravar o estado e dar /clear", () => {
  assert.equal(alert(99_000), "");
  assert.match(alert(101_000), /100k.*docs\/em-andamento.*\/clear/);
  assert.match(alert(160_000), /150k/);
});

const decide = (command) => run("require-rtk.mjs", { tool_input: { command } });

test("rtk bypass cat para ler arquivo é negado e aponta o Read", () => {
  assert.match(decide("rtk bypass cat a.ts b.ts"), /"deny".*Read/);
  assert.match(decide("cd x && rtk bypass cat a.ts 2>/dev/null"), /"deny"/);
});

test("rtk bypass cat com heredoc, redirecionamento ou pipe passa", () => {
  assert.equal(decide("rtk bypass cat > a.txt <<EOF\nx\nEOF"), "");
  assert.equal(decide("rtk bypass cat a b > c"), "");
  assert.equal(decide("rtk bypass cat a.json | rtk jq ."), "");
  assert.equal(decide("rtk cat a.ts"), "");
});
