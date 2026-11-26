// Separa uma linha de shell em comandos e argumentos, respeitando aspas.
// Não é um interpretador: cobre só o necessário para as proteções de Git.
const HERE_STRING = /@(['"])\r?\n[\s\S]*?\r?\n\1@/g;
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2\b/g;
// Aspas, separador, espaço ou trecho comum; barra invertida só escapa em aspas duplas.
const TOKEN = /"((?:\\["\\]|[^"])*)"|'([^']*)'|(&&|\|\||[;|&\n()])|([ \t\r]+)|([^"';|&\n() \t\r]+|["'])/g;
const SHELLS = /^(bash|sh|zsh|pwsh|powershell)(\.exe)?$/i;
const SHELL_SCRIPT_FLAG = /^(-[a-z]*c|-command)$/i;
const GLOBAL_WITH_VALUE = ["-c", "--git-dir", "--work-tree", "--namespace"];
// `\` no Bash e crase no PowerShell; o espaço antes poupa caminho terminado em `\`.
const CONTINUATION = /(\s)[\\`]\r?\n/g;
const PREFIXES = ["rtk", "bypass", "if", "then", "elif", "else", "do", "while", "until", "!"];

export function segments(line) {
  const flat = line.replace(HERE_STRING, "HERE").replace(HEREDOC, "$3").replace(CONTINUATION, "$1");
  const found = [[]];
  let word = null;
  const flush = () => {
    if (word !== null) found.at(-1).push(word);
    word = null;
  };
  for (const [, double, single, separator, space, plain] of flat.matchAll(TOKEN)) {
    if (separator || space) flush();
    if (separator) found.push([]);
    if (separator || space) continue;
    word = (word ?? "") + (double?.replace(/\\(["\\])/g, "$1") ?? single ?? plain);
  }
  flush();
  return found.filter((words) => words.length > 0);
}

// Chaves de bloco coladas no comando; `HEAD@{1}` e `${X}` ficam intactos.
function withoutBraces(words) {
  const bare = words.map((word, index) => {
    const opened = index === 0 ? word.replace(/^\{+/, "") : word;
    return index === words.length - 1 && !opened.includes("{") ? opened.replace(/\}+$/, "") : opened;
  });
  return bare.filter(Boolean);
}

// Remove atribuições de ambiente, o prefixo `rtk` e palavras de bloco.
function program(words) {
  const bare = withoutBraces(words);
  let start = 0;
  while (/^\w+=/.test(bare[start] ?? "") || PREFIXES.includes(bare[start])) start++;
  return bare.slice(start);
}

// Todos os comandos da linha, inclusive os passados a `bash -c`.
export function commandsIn(line) {
  return segments(line).flatMap((words) => {
    const [name, ...args] = program(words);
    if (!name) return [];
    const flag = SHELLS.test(name) ? args.findIndex((arg) => SHELL_SCRIPT_FLAG.test(arg)) : -1;
    if (flag >= 0) return commandsIn(args[flag + 1] ?? "");
    return [{ name: name.replace(/\.exe$/i, ""), args }];
  });
}

const CHANGE_DIR = /^(cd|chdir|pushd|sl|set-location|push-location)$/i;

// Pasta de destino de um `cd`; null se o comando não troca de pasta.
export function directoryChange({ name, args }) {
  if (!CHANGE_DIR.test(name)) return null;
  const target = args.filter((arg) => !arg.startsWith("-")).at(-1);
  if (!target) return null;
  // Git Bash escreve `F:\x` como `/f/x`.
  return process.platform === "win32" ? target.replace(/^\/([a-z])(?=\/|$)/i, "$1:") : target;
}

// { sub, args, repository, configs } de uma chamada git, pulando as opções globais.
export function gitCall({ name, args }) {
  if (name !== "git") return null;
  let repository = ".";
  const configs = [];
  let index = 0;
  while (args[index]?.startsWith("-")) {
    if (args[index] === "-C") repository = args[index + 1] ?? repository;
    if (args[index] === "-c") configs.push(args[index + 1] ?? "");
    index += args[index] === "-C" || GLOBAL_WITH_VALUE.includes(args[index]) ? 2 : 1;
  }
  const sub = args[index] === "stage" ? "add" : args[index];
  return { sub, args: args.slice(index + 1), repository, configs };
}

// Separa opções de operandos. `valued` lista as letras curtas que levam valor;
// `attached`, as de valor opcional, que só vale colado (`-uno`); `long`, as longas
// cujo valor pode vir separado (`--message x`).
export function options(args, valued = "", attached = "", long = []) {
  const flags = [];
  const operands = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") return { flags, operands: [...operands, ...args.slice(index + 1)] };
    if (arg.startsWith("--")) {
      flags.push(arg);
      if (long.includes(arg)) index++;
    }
    else if (!arg.startsWith("-") || arg === "-") operands.push(arg);
    else {
      const letters = arg.slice(1);
      const cut = [...letters].findIndex((letter) => (valued + attached).includes(letter));
      const used = cut < 0 ? letters : letters.slice(0, cut + 1);
      flags.push(...[...used].map((letter) => `-${letter}`));
      if (cut >= 0 && cut === letters.length - 1 && valued.includes(letters[cut])) index++;
    }
  }
  return { flags, operands };
}

// Valor de `-F x`, `-Fx`, `--file x` ou `--file=x`.
export function valueOf(args, short, long) {
  for (const [index, arg] of args.entries()) {
    if (arg === long || arg === short) return args[index + 1];
    if (arg.startsWith(`${long}=`)) return arg.slice(long.length + 1);
    if (arg.startsWith(short) && !arg.startsWith("--")) return arg.slice(short.length);
  }
  return undefined;
}
