---
phase: 02-convex-auth-workos
plan: 05
type: tdd
wave: 3
depends_on: ["02-01", "02-04"]
files_modified:
  - convex/lib/tag.ts
  - convex/lib/tag.test.ts
  - convex/users.ts
  - convex/users.test.ts
autonomous: true

must_haves:
  truths:
    - "Primeiro login de um usuário gera um username#tag único, exibível a ele"
    - "Se o par (username, tag) já existir, uma nova tag é sorteada até achar uma livre, sem duplicar usuário nem travar"
    - "Login de um usuário que já existe (mesmo workosId) nunca cria um segundo documento — apenas retorna o existente"
  artifacts:
    - path: "convex/users.ts"
      provides: "Mutation ensureUser(identity) — upsert por workosId, gera username#tag só no primeiro login"
      contains: "by_username_tag"
    - path: "convex/lib/tag.ts"
      provides: "Função pura de geração de tag de 4 dígitos, testável sem Convex"
      exports: ["generateFourDigitTag"]
  key_links:
    - from: "convex/users.ts"
      to: "ctx.auth.getUserIdentity()"
      via: "toda escrita usa o subject validado pelo JWT, nunca um workosId vindo do cliente sem validação"
      pattern: "getUserIdentity"
---

<feature>
  <name>Identidade username#tag (AUTH-06)</name>
  <files>convex/lib/tag.ts, convex/lib/tag.test.ts, convex/users.ts, convex/users.test.ts</files>
  <behavior>
    `generateFourDigitTag()`: retorna uma string de 4 dígitos com zero à esquerda quando
    necessário (`"0000"` a `"9999"`). Caso de teste: rodar 1000 vezes e confirmar que todo
    resultado casa com `/^\d{4}$/`.

    `ensureUser(ctx)` (mutation, sem argumentos — deriva tudo de `ctx.auth.getUserIdentity()`):
    - Se não houver identidade autenticada (`getUserIdentity()` retorna `null`): lança erro.
      Caso de teste: chamar sem `withIdentity(...)` no `convex-test` e esperar rejeição.
    - Se já existir um documento em `users` com `workosId === identity.subject` (via índice
      `by_workos_id`): retornar esse documento sem criar outro. Caso de teste: chamar
      `ensureUser` duas vezes com a mesma identidade simulada e confirmar
      `(await ctx.db.query('users').collect()).length === 1` depois da segunda chamada, e que
      o `username`/`tag` retornados na segunda chamada são idênticos aos da primeira.
    - Se não existir: derivar um `username` base a partir do e-mail da identidade (parte
      antes do `@`, minúscula, caracteres fora de `[a-z0-9_]` substituídos por `_`), e
      tentar até 10 vezes gerar uma `tag` de 4 dígitos com `generateFourDigitTag()` tal que
      `(username, tag)` não exista no índice `by_username_tag`; inserir com esse par assim
      que achar um livre. Caso de teste: pré-popular `users` com um documento
      `username: "leo", tag: "0001"` via `t.run(...)`, então simular
      `generateFourDigitTag` retornando sempre `"0001"` na primeira chamada e um valor livre
      na segunda (mock/stub determinístico só dentro do teste, não no código de produção),
      e confirmar que o usuário criado não fica com `tag: "0001"`.
    - Se esgotar as tentativas sem achar um par livre: lança erro explícito (não insere um
      usuário com par duplicado). Caso de teste: pré-popular todas as 10.000 combinações
      seria caro — em vez disso, testar a função pura de tentativa isoladamente (extrair a
      lógica de "tentar N vezes" para uma função auxiliar testável com um `existsFn` injetado
      que sempre retorna `true`, confirmando que lança depois de exatamente `MAX_ATTEMPTS`
      chamadas).
  </behavior>
  <implementation>
    Usar `convex-test` (`convexTest(schema)`), instalado no plano 02-01. Ler a documentação
    de uso de `convex-test` para simular identidade autenticada (`t.withIdentity({ subject:
    'workos_user_123', email: '...' })`) antes de chamar a mutation — é assim que
    `ctx.auth.getUserIdentity()` recebe um valor dentro do teste, sem precisar de um JWT real
    nem de rede. `convex/users.ts` importa `mutation` de `./_generated/server` (já existe
    depois do checkpoint 02-04) e `v` de `convex/values` só se a mutation expuser argumentos
    (aqui não expõe — tudo vem da identidade).

    Sequência RED → GREEN → REFACTOR:
    1. RED: escrever `convex/lib/tag.test.ts` e `convex/users.test.ts` cobrindo os casos
       acima contra uma implementação ainda inexistente/vazia; confirmar que falham.
    2. GREEN: implementar `convex/lib/tag.ts` e `convex/users.ts` até os testes passarem.
    3. REFACTOR: extrair a lógica de "tentar N vezes até achar um par livre" para uma função
       nomeada e testável isoladamente (ver caso de teste do esgotamento acima), se ainda não
       estiver assim depois do GREEN.

    Rodar os testes com o runner já configurado no projeto (`npx vitest run convex` ou
    equivalente — se não houver `vitest` configurado, adicionar como devDependency mínima
    necessária só para rodar `convex-test`, seguindo a documentação oficial do `convex-test`
    para o setup exato do `vitest.config.ts` com o Convex).
  </implementation>
</feature>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/02-convex-auth-workos/02-RESEARCH.md
@docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md

# 02-RESEARCH.md §5: Convex não tem constraint de unicidade nativa — o índice
# by_username_tag só acelera a consulta "já existe esse par?"; a garantia de unicidade é
# 100% responsabilidade desta mutation. Como mutations do Convex são transacionais, não há
# corrida real entre duas execuções concorrentes desta mutation — o retry aqui é só para
# colisão de tag dentro do espaço de 10.000 combinações.
#
# Escopo: SÓ a tabela users (schema já criado no plano 02-01). Não criar servers, channels,
# friendships etc. — fora de escopo desta fase.
</context>

<verification>
- `npx vitest run` (ou o comando equivalente configurado) passa para `convex/lib/tag.test.ts` e `convex/users.test.ts`.
- Chamar `ensureUser` duas vezes com a mesma identidade simulada nunca cria um segundo documento.
- Colisão de `(username, tag)` sempre resulta em uma tag diferente, nunca em erro nem em duplicata, dentro do limite de tentativas.
</verification>

<success_criteria>
AUTH-06 satisfeito no nível de dados: qualquer primeiro login produz um `username#tag`
único e estável, verificável por teste automatizado, sem depender de nenhuma etapa manual.
</success_criteria>

<output>
After completion, create `.planning/phases/02-convex-auth-workos/02-05-SUMMARY.md`.
</output>
