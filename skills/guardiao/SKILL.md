---
name: guardiao
description: Reserva de caminhos entre sessões paralelas. Use para reservar uma pasta e quando uma edição for bloqueada por reserva.
---

CLI: use o comando informado no início da sessão, com o `--root`. Seu id vem junto.

1. A primeira edição de um arquivo livre o reserva sozinha.
2. Pasta inteira: `claim <id> "<tarefa>" <pasta>`.
3. Arquivos compartilhados: libere logo (`release <id> <caminho>`).
4. Bloqueado: siga outra etapa, ou `note <id-dono> "<pedido>"`. Nunca contorne.
5. Recebeu pedido: atenda ou libere.
6. Aviso de alteração não commitada: confira antes de sobrescrever.
7. Não formate, corrija nem commite fora da sua reserva.
8. Reservas automáticas saem no fim do turno. Manuais (`claim`) exigem `release <id>` ao concluir.

Reserva expira após 30 min sem uso de ferramenta.

Se o projeto tiver `.claude/complementos/guardiao.md`, leia e siga: ele detalha esta skill e vence em caso de conflito.
