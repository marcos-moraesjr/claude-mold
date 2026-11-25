---
name: deploy
description: Acompanha o deploy. Use ao dar push na branch principal ou de integração, ao publicar, verificar deploy ou investigar CI vermelho.
---

# Deploy

1. Antes do push: rode localmente o que o CI do projeto roda (leia o workflow).
2. Depois: `gh run watch <id> --exit-status`; confira se o job de deploy não foi pulado.
3. Falha: `gh run view <id> --log-failed`, corrija a causa; não desative passo do CI.
4. CI verde não prova que está no ar: diga o que foi verificado e o que o usuário deve conferir.

Nunca `--force` na principal. Não mate processo do usuário sem perguntar.

Se o projeto tiver `.claude/complementos/deploy.md`, leia e siga: ele detalha esta skill e vence em caso de conflito.
