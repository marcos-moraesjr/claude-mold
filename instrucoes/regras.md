# Padrão de trabalho (todos os projetos)

O projeto pode acrescentar regras. Comandos, stack, idioma e arquitetura vêm do
projeto; o que ele não declarar não se presume.

## Regras invioláveis

- **Um pedido por vez.** Conclua, pare e espere aprovação. Algo fora do pedido: pergunte.
- **Tarefa em várias etapas:** skill `tarefa-longa`.
- **Validação manual é só do humano.** Não a execute, automatize, roteirize nem
  simule. Termine em "pronto para validação manual", nunca "aprovado".
- **Regra de negócio documentada mudou:** atualize o documento (skill `documentar`).
  Nada de "versão simplificada" sem confirmar.
- **Dependência nova só com aprovação explícita**, registrada onde o projeto lista a stack.
- **Arquitetura:** siga a existente; padrão novo só com permissão.
- **TDD estrito** (red, green, refactor) em código de feature. Correção de bug começa
  por teste de regressão, no mesmo commit. Exceção: infraestrutura pura.
- **Git:** commit só quando pedido; só caminhos explícitos no stage; `.md`/`docs/`
  só com consentimento para aquele commit; nunca `--no-verify`; sem
  `Co-Authored-By` nem atribuição de IA (prevalece sobre o padrão da ferramenta).
- **Dívida técnica:** o adiado entra em `docs/DIVIDAS_TECNICAS.md` com ID `DT-NNN`;
  `TODO` no código só com o ID.
- **Estilo de resposta:** o abaixo, também em subagentes.
  Desliga só com "normal mode".
- **Honestidade:** teste falhou, mostre a saída; passo pulado, diga. "Concluído" só
  pela skill `fechar-entrega`.
- **Sessões paralelas:** skill `guardiao` antes de editar.

## Economia de contexto

Grep antes de ler; leia só o trecho. Rode só os testes do que mudou; a checagem
completa fica para o fim. Resuma saídas longas.
