# Fase 02 · Plano 05 — Identidade username#tag (AUTH-06)

**Status:** concluído
**Tipo:** TDD
**Tags:** convex, mutations, testing, vitest, convex-test, identity

## O que foi feito

`ensureUser` (mutation sem argumentos, tudo derivado de `ctx.auth.getUserIdentity()`)
faz upsert por `workosId`: primeiro login gera um `username#tag` único; logins
seguintes só retornam o documento já existente, nunca criam um segundo. A
unicidade do par `(username, tag)` é garantida por checagem no índice
`by_username_tag` antes do insert — Convex não tem constraint de unicidade
nativa (02-RESEARCH.md §5) — com retry limitado a `TAG_DEFAULT_MAX_ATTEMPTS`
(10) tentativas, e um erro explícito ao esgotar, nunca um insert duplicado.

A lógica de "sortear e checar até achar livre" foi extraída para
`convex/lib/tag.ts` como função pura (`findAvailableTag`, com `existsFn` e
`generateTag` injetáveis), testável sem Convex e sem popular as 10.000
combinações possíveis para testar o caminho de esgotamento.

## Arquivos criados/modificados

- `convex/lib/tag.ts` (novo, meu) — `generateFourDigitTag()` e
  `findAvailableTag()`.
- `convex/lib/tag.test.ts` (novo, meu) — 5 testes: distribuição de 1000
  gerações batendo `/^\d{4}$/`, retorno do primeiro candidato livre, retry
  até achar livre, esgotamento exato de `maxAttempts` (padrão e customizado).
- `convex/users.ts` (novo, meu) — mutation `ensureUser`.
- `convex/users.test.ts` (novo, meu) — 4 testes: rejeição sem identidade,
  primeiro login gera tag válida, idempotência (duas chamadas → 1 documento,
  mesmo username/tag), colisão de `(username, tag)` resolvida com uma tag
  diferente (via `vi.spyOn` em `generateFourDigitTag`, mock só no teste).
- `convex/_generated/dataModel.ts`, `convex/_generated/server.ts` (infra,
  ver "Deviations" — na prática já existiam no disco quando cheguei a este
  ponto, criados de forma independente e byte-a-byte equivalentes pelo agente
  irmão 02-06; não precisei escrevê-los).
- `vitest.config.ts` (novo, raiz do projeto, meu) — `environment:
  'edge-runtime'`, `server.deps.inline: ['convex-test']`.
- `package.json` / `package-lock.json` — `vitest@^1.6.1` e
  `@edge-runtime/vm@^5.0.0` adicionados a `devDependencies` (via `npm
  install --save-dev`). Só apareceram sem diff contra `HEAD` no fim da minha
  execução porque um commit de um agente irmão (`feat(02-03): ...`) já havia
  absorvido essa mesma mudança de `package.json`/lockfile do working
  directory compartilhado antes de eu checar — nada a re-commitar aqui.

Não toquei `convex/schema.ts`, `convex/presence.ts` nem nada em `src/`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `convex/_generated/` não existia neste worktree**

- **Encontrado em:** antes da Task 1, ao ler `convex/users.ts` planejado
  (`import { mutation } from './_generated/server'`).
- **Causa:** o plano assumia que `_generated/` já existia "depois do
  checkpoint 02-04" — verdade na máquina Windows onde `npx convex dev` rodou
  de fato (02-04-SUMMARY.md), mas essa pasta nunca foi commitada
  (`git log -- convex/_generated` vazio) e não existe neste checkout Linux.
- **Por que não rodei `npx convex dev`/`npx convex codegen`:** ambos exigem
  credenciais de deployment (`CONVEX_DEPLOYMENT` + acesso autenticado ao
  projeto) que só existem no `.env.local` da máquina Windows, gitignored e
  ausente aqui — confirmado empiricamente (`npx convex codegen` falha com
  "No CONVEX_DEPLOYMENT set"; mesmo definindo a variável manualmente, falha
  com "You don't have access to the selected project"). Rodar login/deploy
  aqui violaria a instrução de safety explícita de não mexer no deployment
  ao vivo.
- **Fix:** reconstruí `convex/_generated/dataModel.ts` e
  `convex/_generated/server.ts` manualmente, mas usando o texto literal dos
  templates oficiais do próprio pacote `convex` instalado
  (`node_modules/convex/dist/esm/cli/codegen_templates/{dataModel,server}.js`),
  não memória — comportamento idêntico ao que `npx convex codegen`
  produziria para o `schema.ts` atual. Ao terminar de escrever essas duas
  cópias, descobri que o agente irmão 02-06 (dono de `convex/presence.ts`)
  já havia criado arquivos praticamente byte-idênticos de forma
  independente (mesmo raciocínio, mesma fonte) — mantive os dele e não
  sobrescrevi.
- Não criei `convex/_generated/api.ts`: segui a convenção que o agente
  02-06 já havia estabelecido em `convex/presence.test.ts` — importar
  `anyApi` de `convex/server` diretamente e passar `import.meta.glob('./**/*.ts')`
  como `modules` para `convexTest`, dispensando um `api.ts` gerado (o
  `export const api = anyApi as any` do template oficial é só uma anotação
  de tipo por cima do mesmo `anyApi` — equivalente em runtime).
- **Arquivos:** `convex/_generated/dataModel.ts`,
  `convex/_generated/server.ts` (não modificados por mim, apenas
  confirmados como corretos e idênticos ao que eu teria escrito).
- **Nota para quem revisar:** na próxima vez que `npx convex dev` rodar de
  verdade (máquina com credenciais), ele vai regenerar essa pasta — é
  esperado e inofensivo, o conteúdo à mão já bate com o oficial para o
  schema atual.

**2. [Rule 3 - Blocking] `vitest` não estava instalado no projeto**

- **Encontrado em:** antes da Task 1 (RED), ao tentar rodar os testes.
- **Fix:** adicionei `vitest@^1.6.1` e `@edge-runtime/vm@^5.0.0` como
  devDependencies (`convex-test` já estava presente desde 02-01) e criei
  `vitest.config.ts` na raiz com `environment: 'edge-runtime'` — ambiente
  Edge Runtime é o recomendado pela documentação do `convex-test` para
  simular o runtime de funções do Convex.
- **Arquivos:** `package.json`, `package-lock.json`, `vitest.config.ts`.

Nenhum desvio de Rule 4 (arquitetural) — nada exigiu alterar `schema.ts` ou
decisão de design; o par `(username, tag)` e os índices já estavam corretos
desde o plano 02-01.

## Verificação

`npx vitest run` — 3 arquivos, 12 testes, todos verdes (5 em
`convex/lib/tag.test.ts`, 4 em `convex/users.test.ts`, 3 em
`convex/presence.test.ts`, este último do agente irmão 02-06):

```
 ✓ convex/lib/tag.test.ts  (5 tests) 10ms
 ✓ convex/users.test.ts  (4 tests) 33ms
 ✓ convex/presence.test.ts  (3 tests) 37ms

 Test Files  3 passed (3)
      Tests  12 passed (12)
```

`npm run typecheck` (tsc para `tsconfig.node.json` + `tsconfig.web.json`) —
passou sem erros. `convex/**` não está incluído em nenhum dos dois
tsconfigs do projeto (nem estava antes desta mudança), então esses arquivos
não são checados por este comando; a correção de tipos para o código Convex
é feita implicitamente pelo transform do Vitest ao rodar os testes.

`npm run build` — passou (`electron-vite build`, main + preload + renderer),
sem regressão.

## Truths do plano confirmadas

- Primeiro login gera um `username#tag` único, exibível ao usuário —
  confirmado pelo teste "primeiro login gera um username#tag de 4 dígitos".
- Colisão de `(username, tag)` sorteia uma tag nova sem duplicar usuário nem
  travar — confirmado pelo teste de colisão (mock de `generateFourDigitTag`
  forçando `"0001"` na primeira tentativa) e pelos testes de esgotamento em
  `tag.test.ts` (lança depois de exatamente `maxAttempts` chamadas, nunca
  retorna candidato não confirmado).
- Login de um usuário existente (mesmo `workosId`) nunca cria um segundo
  documento — confirmado pelo teste de idempotência
  (`ctx.db.query('users').collect()).length === 1` depois da segunda
  chamada).

## Next Phase Readiness

`convex/users.ts` exporta `ensureUser`, pronto para ser chamado pelo
renderer (plano 02-07/02-08) logo após autenticação bem-sucedida. Nenhum
bloqueio conhecido para os próximos planos desta fase. Ponto de atenção para
quem rodar `npx convex dev` na máquina com credenciais: ele vai regenerar
`convex/_generated/` (incluindo criar `api.ts`, que hoje não existe) — sem
impacto esperado, já que nada neste plano ou no de presença depende de
`api.ts` existir.
