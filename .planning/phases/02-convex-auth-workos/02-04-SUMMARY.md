# 02-04 — Provisionamento do Convex

**Status:** concluído (checkpoint humano)
**Data:** 2026-08-18

## O que foi feito

Projeto Convex `janja` criado, deployment de desenvolvimento
`impressive-oyster-898` provisionado, e o schema publicado com sucesso.

Índices criados, confirmados na saída do `convex dev`:

| Índice | Campos |
|---|---|
| `presence.by_user` | `userId`, `_creationTime` |
| `users.by_username_tag` | `username`, `tag`, `_creationTime` |
| `users.by_workos_id` | `workosId`, `_creationTime` |

`users.by_username_tag` é o que sustenta o `USER#123` — a busca por
identificador público resolve por índice, não por varredura.

## Variáveis configuradas

No `.env.local` da máquina Windows (gitignored):

- `CONVEX_DEPLOYMENT` — escrita pelo CLI
- `VITE_CONVEX_URL` — escrita pelo CLI
- `VITE_CONVEX_SITE_URL` — escrita pelo CLI, não prevista no plano. É a URL das
  HTTP actions, e será usada na Fase 7 para o webhook de reconciliação do LiveKit
- `MAIN_VITE_WORKOS_CLIENT_ID` — preenchida manualmente

No deployment do Convex, via `npx convex env set`:

- `WORKOS_CLIENT_ID`

Nenhuma API key da WorkOS foi necessária, confirmando o achado do `02-RESEARCH.md`.

## Desvio de ordem

O plano listava a definição do `WORKOS_CLIENT_ID` como passo posterior ao
`npx convex dev`, mas o `auth.config.ts` referencia essa variável e o push falha
antes de chegar lá. A ordem correta é definir a env var primeiro. Erro observado:
`Environment variable WORKOS_CLIENT_ID is used in auth config file but its value
was not set.`
