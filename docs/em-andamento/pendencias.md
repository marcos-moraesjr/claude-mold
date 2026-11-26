# Pendências do plugin mold

Status: em andamento

## Objetivo

Fechar falhas pós-0.2.0 (base `c8e10a6`). Uma etapa por vez, com aprovação entre elas.
Cada falha começa por teste de regressão. Commit só quando pedido. Sem dependência nova.

## Decisões

- Ordem: 5, 3, 2, 4, 1, 6. A etapa 5 corrige um bloqueio falso em uso normal.
- Etapa 4: registro baseado no toplevel do git, sem reescrever para caminhos absolutos.
- Etapa 1: manter a proibição de automatizar ou simular a validação manual.

## Etapas

- [x] 5. Contornos de Git (30/30 testes; 0.2.1)
- [x] 3. Portão de qualidade com volume: `maxBuffer` de 64 MB e erro em `systemMessage` (33/33 testes; 0.2.1)
- [x] 2. Segredo no commit: `cd`, `commit <arquivo>`, `commit -a`, `--message x` (36/36 testes; 0.2.1)
- [x] 4. Guardião entre raiz e subpasta (37/37 testes; 0.2.1)
- [x] 1. Regras de evidência: o usuário decidiu manter `instrucoes/regras.md` como está
- [ ] 6. Evals, comparando com `a0ee8aa`; sem saldo para `claude plugin eval`, formato alternativo a decidir

## Pendências do humano

- Proteger `main` no GitHub contra push forçado.
- Após os evals: `require-rtk`, hook `SubagentStart`, confirmação de comandos destrutivos.
