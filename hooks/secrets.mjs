// Cobre só .env e chave privada; para o resto, use um scanner no CI.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/;
const MAX_BYTES = 20 * 1024 * 1024;

const isEnvFile = (path) => /^\.env(\..+)?$/i.test(basename(path)) && basename(path) !== ".env.example";

function git(repository, ...args) {
  const options = { encoding: "utf8", maxBuffer: MAX_BYTES, stdio: ["ignore", "pipe", "ignore"] };
  return execFileSync("git", ["-C", repository, "-c", "core.quotePath=false", ...args], options);
}

function hasKey(path) {
  try {
    return statSync(path).size <= MAX_BYTES && PRIVATE_KEY.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

// Caminhos de um `git add` que não podem entrar no stage.
export function secretsInPaths(paths, repository) {
  return paths.filter((path) => isEnvFile(path) || hasKey(resolve(repository, path)));
}

// Arquivos do stage com .env ou chave privada em linha adicionada.
export function secretsInStage(repository) {
  const names = git(repository, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR").split("\0");
  const found = new Set(names.filter((name) => name && isEnvFile(name)));
  const patch = git(repository, "diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/");
  let file = "";
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6).trimEnd();
    else if (line.startsWith("+") && PRIVATE_KEY.test(line)) found.add(file);
  }
  return [...found];
}
