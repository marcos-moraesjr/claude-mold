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
- **Hooks:** reserva de arquivos entre sessões paralelas (edição sem reserva é bloqueada),
  proteção do stage e das mensagens de commit, sugestão de skill, checagem de qualidade
  no fim do turno e aviso de contexto grande.

## Opção RTK (desligada por padrão)

Ligue na configuração do plugin, em `/plugin`. Exige o RTK instalado e no `PATH`.

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

Sem declaração, só o limite de 500 linhas por arquivo é conferido.

## Testes

```
node --test tests/*.test.mjs
```
