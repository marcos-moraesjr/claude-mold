# claude-mold

Plugin `mold` para Claude Code: um padrão de trabalho em pt-BR, neutro quanto à stack.

## Instalação

Requer Node.js e git.

```
/plugin marketplace add marcos-moraesjr/claude-mold
/plugin install mold@mold
```

Se você já tem hooks ou skills equivalentes em `~/.claude`, remova-os: senão rodam em dobro,
e skill pessoal de mesmo nome convive com a do plugin.

## O que vem

- **Instruções** (injetadas no início da sessão): um pedido por vez, TDD, regras de Git,
  dívida técnica, código, documentação e estilo de resposta curto (desliga com "normal mode").
- **Skills:** `mold:commit`, `mold:deploy`, `mold:documentar`, `mold:fechar-entrega`,
  `mold:guardiao`, `mold:protocolo-remoto`, `mold:tarefa-longa`.
- **Hooks:** reserva de arquivos entre sessões paralelas (a primeira edição reserva; arquivo de
  outra sessão é bloqueado), proteção do stage, do push e das mensagens de commit, sugestão de skill, checagem de qualidade
  no fim do turno e aviso de contexto grande.

## Reservas entre sessões

- A primeira edição cria uma reserva automática, liberada no fim do turno.
- `claim` cria uma reserva manual, que exige `release`. Sobre um arquivo automático, torna-o manual.
- As duas bloqueiam outras sessões.
- Ao reservar arquivo não commitado, há aviso se o último dono for outra sessão ou desconhecido.
- O hook `Stop` não roda se o usuário interromper a resposta. A reserva automática fica até o
  próximo fim de turno, o fim da sessão ou 30 min sem uso de ferramenta.

## Proteções Git

Valem em Bash e PowerShell.

| Operação | Decisão |
| --- | --- |
| `add` em massa (`-A`, `-u`, `.`, glob, diretório) | nega |
| `commit --no-verify`, `-c core.hooksPath`, atribuição de IA | nega |
| `.env*` (exceto `.env.example`), chave privada | nega |
| Push forçado em `main`, `master`, `develop` | nega |
| Demais `push`, `commit -a`, documentação no stage | pergunta |

Documentação: `.md`, `.mdx`, `.rst` ou qualquer arquivo em `docs/`.

Os hooks não são barreira de segurança: só reconhecem formas comuns de comando
(alias, script, variável, `sudo`, `env` e caminho completo do git escapam). Proteja as
branches no servidor Git.
Segredos: só `.env` e chave privada; tokens de API passam. Use um scanner no CI.

## Opção RTK (desligada por padrão)

Ligue na configuração do plugin, em `/plugin`. Exige o RTK instalado e no `PATH`;
sem ele, a sessão avisa e nada é bloqueado.
A opção exige o prefixo. Quem comprime a saída é o hook do próprio RTK, registrado uma
vez com `rtk init -g --hook-only`.

## Ajustes por projeto

| Arquivo | Efeito |
| --- | --- |
| `.claude/complementos/<skill>.md` | Detalha a skill; vence em conflito |
| `.claude/gatilhos.json` | `{"<skill>": "<regex>"}` sugere a skill pelo pedido |
| `.claude/skills/INDEX.md` | Injetado no início da sessão |

## Checagem de qualidade

Declare o comando por projeto em `~/.claude/qualidade.json`, fora do repositório:

```json
{ "/caminho/do/projeto": "npm run lint" }
```

Sem declaração, só o limite de 500 linhas por arquivo é conferido, com aviso uma vez
por sessão. A comparação parte do `HEAD` do início da sessão, então commit no meio
não esconde mudança. Reprovação repetida no mesmo turno vira aviso, sem bloquear.
Troca de branch ou `pull` na sessão inclui as mudanças trazidas.

## Testes

```
node --test tests/*.test.mjs
```
