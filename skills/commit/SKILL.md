---
name: commit
description: Checklist pré-commit. Use quando o usuário pedir commit, subir alterações, abrir PR ou criar branch, e antes de qualquer git commit.
---

# Commit

Só commite quando o usuário pedir.

1. Strings e números mágicos (só produção): extraia o que se repete ou cujo erro de
   digitação falharia em silêncio; deixe literal o único e autoevidente.
2. Stage só com caminhos explícitos. Leia `git diff --cached --name-only`; documentação
   sem consentimento para este commit sai do stage.
3. Em código, pergunte: checagem completa do projeto ou rápida (lint e testes do que
   mudou)? Recomende a rápida. Só commite verde.
4. Sem atribuição de IA nem `--no-verify`. Branch com as iniciais de
   `git config user.name`. ID de ticket só em commit, branch e PR.

Se o projeto tiver `.claude/complementos/commit.md`, leia e siga: ele detalha esta skill e vence em caso de conflito.
