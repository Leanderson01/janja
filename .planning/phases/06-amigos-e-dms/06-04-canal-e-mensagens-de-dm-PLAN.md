---
phase: 06-amigos-e-dms
plan: 04
type: tdd
wave: 2
depends_on: ["06-01"]
files_modified:
  - convex/dms.ts
  - convex/dms.test.ts
autonomous: true

must_haves:
  truths:
    - "Usuário abre uma conversa direta com um amigo — a mesma dupla nunca ganha dois canais de DM diferentes"
    - "Usuário só consegue obter/usar um canal de DM se for amigo do outro participante"
    - "Usuário envia uma mensagem de texto num canal de DM do qual é membro"
    - "Usuário que não é membro de um canal de DM não consegue enviar mensagem nele, mesmo sabendo o id do canal"
  artifacts:
    - path: "convex/dms.ts"
      provides: "Mutations getOrCreateDmChannel e sendDmMessage, com checagem de amizade e de membership"
      exports: ["getOrCreateDmChannel", "sendDmMessage"]
  key_links:
    - from: "convex/dms.ts (getOrCreateDmChannel)"
      to: "convex/schema.ts (friendships.by_pair)"
      via: "só cria/retorna canal se os dois usuários forem amigos"
      pattern: "by_pair"
    - from: "convex/dms.ts (sendDmMessage)"
      to: "convex/schema.ts (dmMembers.by_channel_user)"
      via: "checagem de membership antes de qualquer leitura/escrita em dmMessages"
      pattern: "by_channel_user"
---

<feature>
  <name>Canal de DM e envio de mensagem (SOCIAL-05, metade de escrita)</name>
  <files>convex/dms.ts, convex/dms.test.ts</files>
  <behavior>
    **`getOrCreateDmChannel({ friendUserId })`**:
    - Resolve "eu" via `users.by_workos_id` (mesmo padrão de
      `convex/friends.ts` — não importar de lá, `convex/dms.ts` tem sua
      própria `getCallerUser`, arquivos diferentes não compartilham função
      interna não-exportada).
    - **Autorização (hard constraint indireto — só amigos trocam DM)**: verifica
      `friendships.by_pair` com o par canônico entre eu e `friendUserId`. Caso
      de teste: chamar com um `friendUserId` que não é amigo → lança erro
      ("Vocês precisam ser amigos para conversar"), nenhum canal é criado.
    - Busca um canal existente entre os dois: lista meus `dmMembers` via
      `by_user`, e para cada `dmChannelId` candidato faz um lookup pontual em
      `dmMembers.by_channel_user` com `(dmChannelId, friendUserId)` — se
      algum bater, retorna esse `dmChannelId` sem criar nada novo. Caso de
      teste central: chamar `getOrCreateDmChannel` duas vezes seguidas com o
      mesmo par de amigos retorna o **mesmo** `dmChannelId` nas duas vezes, e
      `dmChannels`/`dmMembers` não ganham documentos extras na segunda
      chamada.
    - Caso de teste: chamado pelo outro lado do par (o amigo abre a conversa
      primeiro) encontra o mesmo canal que o primeiro usuário criou — não
      duplica por causa da direção de quem chamou primeiro.
    - Se não encontrar, cria: insere `dmChannels { createdAt }`, insere dois
      `dmMembers` (eu e o amigo) apontando para o novo canal, retorna o novo
      id. Caso de teste: primeira chamada entre dois amigos sem DM prévia
      cria exatamente 1 `dmChannels` e 2 `dmMembers`.

    **`sendDmMessage({ dmChannelId, content })`**:
    - **Autorização crítica (hard constraint da tarefa)**: antes de qualquer
      outra coisa, verifica que eu sou membro de `dmChannelId` via
      `dmMembers.by_channel_user` — se não for, lança erro ("Você não é
      membro desta conversa") e não insere nada. Caso de teste central: um
      terceiro usuário (nunca foi adicionado como membro daquele
      `dmChannelId`) tenta enviar mensagem → rejeitado, `dmMessages`
      continua vazio para aquele canal.
    - Valida `content` não-vazio depois de `trim()` — caso de teste: string
      vazia ou só espaços → lança erro, nenhuma mensagem inserida.
    - Caminho feliz: insere `dmMessages { dmChannelId, authorId: eu, content:
      content.trim(), createdAt: Date.now() }`. Caso de teste: membro válido
      envia mensagem, ela aparece em `t.run(ctx => ctx.db.query('dmMessages').collect())`
      com o `authorId` correto.
  </behavior>
  <implementation>
    Mesmo padrão de autorização de `convex/friends.ts` (plano 06-02):
    `getCallerUser(ctx)` local ao arquivo, nunca aceitar id de usuário do
    cliente para decidir "quem sou eu" — só para decidir "com quem" (via
    `friendUserId`/`dmChannelId`, que são validados contra a identidade real).

    Extrair uma função interna `assertDmMember(ctx, dmChannelId, userId)` que
    faz o lookup em `by_channel_user` e lança se não encontrar — reutilizada
    por `sendDmMessage` aqui e pelas queries de leitura do plano 06-05 (que
    depende deste).

    Sequência RED → GREEN → REFACTOR:
    1. RED: escrever `convex/dms.test.ts` cobrindo os casos acima contra um
       `convex/dms.ts` ainda vazio; confirmar que falham.
    2. GREEN: implementar `convex/dms.ts` até todos os testes passarem.
    3. REFACTOR: extrair `getCallerUser`/`assertDmMember` se ainda não
       estiverem assim; confirmar que os testes continuam passando.

    Mesmo padrão de `convex-test` do plano 06-02: `convexTest(schema,
    modules)`, `t.withIdentity({ subject, email })`, `anyApi.dms.<nome>`,
    seed via `t.run` para usuários e amizades pré-existentes (não depender de
    `convex/friends.ts` nos testes deste arquivo — inserir `friendships`
    diretamente via `t.run`, é mais rápido e mantém os dois arquivos de teste
    independentes um do outro).
  </implementation>
</feature>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/06-amigos-e-dms/06-RESEARCH.md
@.planning/research/PITFALLS.md

# 06-RESEARCH.md §4: autorização de leitura/escrita de DM é checagem explícita
# no início do handler (Convex não tem RLS automático) — mesmo padrão já usado
# em ensureUser/heartbeat.
#
# 06-RESEARCH.md §7 (design §5): dmChannels não guarda userA/userB — a relação
# vive inteiramente em dmMembers (hard constraint: join table, não array).
</context>

<verification>
- `npx vitest run convex/dms.test.ts` passa, cobrindo autorização de amizade
  (getOrCreateDmChannel) e de membership (sendDmMessage).
- Teste específico confirma que chamar getOrCreateDmChannel repetidamente
  nunca cria um segundo canal para o mesmo par.
- Teste específico confirma que um não-membro não consegue enviar mensagem em
  um dmChannelId que não é seu.
</verification>

<success_criteria>
Metade de escrita de SOCIAL-05 resolvida no nível de dados: abrir conversa é
idempotente e restrito a amigos; enviar mensagem é restrito a membros do
canal — ambos cobertos por teste automatizado.
</success_criteria>

<output>
After completion, create `.planning/phases/06-amigos-e-dms/06-04-SUMMARY.md`.
</output>
