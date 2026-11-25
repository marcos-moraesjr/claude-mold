---
name: tarefa-longa
description: Memória de tarefa longa. Use ao iniciar trabalho com 3+ passos ou várias sessões, ao retomar tarefa em docs/em-andamento e ao concluir cada etapa.
---

# Tarefa longa

Estado em `docs/em-andamento/<tarefa>.md`, para outro agente retomar lendo só ele.

- Início: crie após o plano aprovado. Retomada: leia antes de explorar.
- Fim de cada etapa: atualize antes de seguir.
- Concluída: delete o arquivo e a pasta que criou. Sem stage sem consentimento.

Conteúdo: título; `Status: em andamento | bloqueada | concluída`; Objetivo; Decisões
(com porquê); Etapas em checklist; Feito (arquivo:linha, teste, commit); Falta;
Retomar (arquivos, comandos, armadilhas, pendências do humano). Só o que o código
e o git não dizem.

Se o projeto tiver `.claude/complementos/tarefa-longa.md`, leia e siga: ele detalha esta skill e vence em caso de conflito.
