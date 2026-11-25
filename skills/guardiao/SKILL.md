---
name: guardiao
description: Reserva de caminhos entre sessões paralelas. Use antes da primeira edição de arquivo do projeto, quando uma edição for bloqueada por reserva e ao concluir a tarefa.
---

CLI: `node "${CLAUDE_PLUGIN_ROOT}/hooks/lock.mjs"`, rodado na raiz do projeto (com a
opção RTK ligada, prefixe `rtk`). Seu id vem no início da sessão.

1. Antes de editar: `claim <id> "<tarefa>" <caminho...>`.
2. Arquivos compartilhados: reserve na hora e libere logo (`release <id> <caminho>`).
3. Bloqueado: siga outra etapa, ou `note <id-dono> "<pedido>"`. Nunca contorne.
4. Recebeu pedido: atenda ou libere.
5. Não formate, corrija nem commite fora da sua reserva.
6. Ao concluir: `release <id>`.

Reserva expira após 30 min sem uso de ferramenta.

Se o projeto tiver `.claude/complementos/guardiao.md`, leia e siga: ele detalha esta skill e vence em caso de conflito.
