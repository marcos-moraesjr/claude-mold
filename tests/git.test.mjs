// Proteções Git: decisões e falsos positivos.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../hooks/guard-doc-staging.mjs", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "mold-git-"));
after(() => rmSync(root, { recursive: true, force: true }));
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
mkdirSync(join(root, "src"));
writeFileSync(join(root, "msg.txt"), "ajuste\n\nCo-Authored-By: X <x@y>\n");

function decision(command, tool = "Bash") {
  const input = { tool_name: tool, cwd: root, tool_input: { command } };
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", input: JSON.stringify(input) });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout || "{}").hookSpecificOutput?.permissionDecision ?? "allow";
}

const CASES = {
  deny: [
    "git add -A",
    "git add --all",
    "git add -u",
    "git add .",
    "git add :/",
    "git add *.js",
    "git add src",
    "git add src/",
    "rtk git -c core.x=1 --no-pager add .",
    "cd src && git add -A",
    'bash -c "git add -A"',
    "git commit --no-verify -m x",
    "git commit -n -m x",
    'git commit -nm "x"',
    "git push --force origin main",
    "git push -f origin HEAD:develop",
    "git push origin +master",
    "git push -f",
    "git commit -F msg.txt",
    'git commit -m "x\n\nCo-Authored-By: X <x@y>"',
    "git commit -F - <<'EOF'\nx\n\nCo-Authored-By: X <x@y>\nEOF",
    'gh pr create --title t --body "Generated with Claude"',
  ],
  ask: [
    "git push",
    "git push --force origin feature/x",
    "git commit -am x",
    "git add LEIA.md",
    "git add docs/a.txt",
    'git -C "meu repo" add "um guia.md"',
  ],
  allow: [
    'echo "git push"',
    'git commit -m "não usar git add ."',
    'git commit -m "-n e git push --force"',
    "git commit -mnota",
    "git add requirements.txt",
    "git add CMakeLists.txt",
    "git add src/app.ts",
    "cat > nota <<'EOF'\ngit add -A\nEOF",
    "$m = @'\nit's git push\n'@",
  ],
};

for (const [expected, commands] of Object.entries(CASES)) {
  test(`decisão ${expected}`, () => {
    for (const command of commands) assert.equal(decision(command), expected, command);
  });
}

test("PowerShell passa pela mesma proteção", () => {
  assert.equal(decision("git add -A", "PowerShell"), "deny");
  const hooks = JSON.parse(readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8")).hooks;
  const entry = hooks.PreToolUse.find((e) => e.hooks.some((h) => h.command.includes("guard-doc-staging")));
  assert.equal(entry.matcher, "Bash|PowerShell");
});

test("documentação no stage pede confirmação", () => {
  writeFileSync(join(root, "um guia.md"), "x");
  execFileSync("git", ["add", "um guia.md"], { cwd: root });
  assert.equal(decision("git commit -m x"), "ask");
});
