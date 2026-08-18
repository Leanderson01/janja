# Research: Fase 4 — Servidores e canais

**Data:** 2026-08-18
**Nível de discovery:** 1-2 (confirmação de sintaxe/padrões contra doc oficial do Convex — a
stack já está decidida, nenhuma escolha de tecnologia nova nesta fase)

## Fontes consultadas

- https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf (oficial)
- https://docs.convex.dev/auth/functions-auth (oficial)
- https://docs.convex.dev/testing/convex-test (oficial)
- https://docs.convex.dev/functions/runtimes (oficial)
- `convex/presence.ts`, `convex/presence.test.ts`, `convex/schema.ts` (código já escrito pela
  Fase 2, no mesmo repo — fonte mais confiável que qualquer doc externa para "qual é o padrão
  deste projeto")
- `.planning/phases/02-convex-auth-workos/02-05-identidade-username-tag-PLAN.md` (padrão de
  retry para unicidade sem constraint nativa)

## 1. Índices para tabela de junção (serverMembers)

Confirmado contra a doc oficial: um índice composto pode ser consultado por um **prefixo** dos
seus campos — não é preciso um índice separado por campo quando um dos padrões de consulta é
"todos os campos" e o outro é "só o primeiro campo".

```ts
.index('by_server_user', ['serverId', 'userId'])
```

Serve tanto para:
- `withIndex('by_server_user', q => q.eq('serverId', serverId))` — lista membros de um
  servidor (SRV-07), ou verifica participação usando `.collect()` sobre um resultado pequeno
  (grupo de ~10 pessoas, nunca é um full scan).
- `withIndex('by_server_user', q => q.eq('serverId', serverId).eq('userId', userId))` — checa
  participação de UM usuário específico, usado em toda function de autorização (SRV-06).

Um segundo índice, `by_user` (`['userId']`), é necessário à parte porque o índice composto
acima não serve "listar servidores deste usuário" (o `userId` não é o primeiro campo — Convex
não permite pular o prefixo). Mesmo padrão que o design doc já previa para `dmMembers` (F6).

`channels` e `invites` só precisam de índice single-field por `serverId` (e `invites` também
por `code`, para o lookup de ingresso que não conhece o servidor de antemão).

## 2. Autorização com `ctx.auth.getUserIdentity()`

Padrão confirmado igual ao já usado em `convex/presence.ts` (Fase 2): checar
`getUserIdentity()`, buscar o documento `users` pelo índice `by_workos_id`, lançar erro claro
se qualquer um dos dois faltar. Esta fase extrai esse bloco para um helper reutilizável
(`convex/lib/membership.ts`) em vez de repetir em cada arquivo — `servers.ts`, `channels.ts`,
`invites.ts` e `members.ts` todos importam dali. Nenhuma function pública fica sem essa
checagem: é o mecanismo que implementa SRV-06 (não-membro não lê nem escreve).

Não existe "role" ou "permission" no Convex nativamente — a autorização é 100% lógica de
aplicação dentro do handler, e cada mutation/query precisa fazer a checagem por conta própria
(não há middleware automático). Confirma a decisão do projeto (`PROJECT.md`: "roles e
permissões granulares... fora de escopo") — aqui não há hierarquia, só um booleano "é membro?"
e, para convites, um segundo booleano "é dono?".

## 3. `convex-test` — padrão de teste já estabelecido no repo

`convex/presence.test.ts` (Fase 2, já escrito) fixa o padrão exato a seguir, sem inventar
variação:

```ts
import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

const t = convexTest(schema, modules)
const asAna = t.withIdentity({ subject: 'workos_user_123' })
await asAna.mutation(anyApi.servers.createServer, { name: 'Galera' })
await t.run((ctx) => ctx.db.insert('users', { ... })) // setup direto, sem passar por mutation
```

Ponto importante: os testes usam `anyApi` de `convex/server`, não `api` de
`./_generated/api` — evita depender de codegen já ter rodado (`npx convex dev`, checkpoint
02-04) para simplesmente escrever/rodar os testes. Todos os testes desta fase seguem o mesmo
import.

## 4. `Math.random()` dentro de mutations é seguro (gera código de convite)

Confirmado na doc oficial (`functions/runtimes`): Convex substitui `Math.random()` por um
gerador pseudo-aleatório "seeded" que garante determinismo — o mesmo valor é retornado se a
function for re-executada pelo sistema (retry de OCC), sem quebrar a garantia transacional.
Isso valida o padrão já usado (implicitamente) pelo plano 02-05 (`generateFourDigitTag`) e o
mesmo padrão é reaproveitado aqui para `generateInviteCode()` — nenhuma necessidade de
`crypto.getRandomValues` (que também está disponível via Web Crypto API do runtime padrão do
Convex, mas é mais verboso para gerar uma string curta e não traz nenhuma vantagem aqui).

## 5. Unicidade sem constraint nativa — mesmo padrão do `username#tag`

Confirmado no próprio 02-05: Convex não tem unique index. A garantia de unicidade do código de
convite é 100% responsabilidade da mutation `generateInvite`: gera candidato, checa colisão via
`withIndex('by_code', ...)`, insere se livre, tenta de novo (até 10x) se colidir. Como
mutations do Convex são transacionais, não existe corrida real entre duas execuções
concorrentes desta mutation — o retry cobre só a colisão dentro do espaço de valores possíveis
do código (8 caracteres de um alfabeto de 32 símbolos sem ambiguidade visual — ver plano 04-02).

## 6. Paginação — não se aplica a esta fase

`usePaginatedQuery`/paginação (armadilha #8 do PITFALLS.md) é relevante para `messages` (F5) e
potencialmente para listas grandes. Nesta fase, todas as listas são limitadas pelo tamanho real
do grupo (~10 pessoas, poucos servidores, poucos canais por servidor) — `.collect()` sem
paginação é apropriado e não é a armadilha "full table scan": toda consulta já está escopada
por índice (`by_server`, `by_user`, `by_server_user`) antes do `.collect()`, nunca varre a
tabela inteira.

## 7. Decisões que este research fixa para os planos

- `serverMembers`: dois índices (`by_server_user` composto, `by_user` single-field) — nenhum
  índice `by_server` isolado, porque o composto já serve como prefixo.
- Helper de autorização centralizado em `convex/lib/membership.ts`, importado (não reexportado
  via `api`) por todo arquivo de domínio desta fase.
- Convite: código de 8 caracteres, alfabeto sem ambiguidade visual (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  — sem `0/O`, `1/I/L`), gerado com `Math.random()`, retry de até 10 tentativas contra o índice
  `by_code`.
- Todo teste novo segue exatamente o padrão de `convex/presence.test.ts` (`anyApi`,
  `import.meta.glob`, `t.withIdentity`, `t.run`).
