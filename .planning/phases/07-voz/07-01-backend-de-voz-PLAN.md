---
phase: 07-voz
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - convex/schema.ts
  - convex/voice.ts
  - convex/voice.test.ts
autonomous: true

must_haves:
  truths:
    - "Só um membro do servidor dono do canal consegue entrar num canal de voz; não-membro é rejeitado"
    - "Entrar num canal de voz produz um JWT do LiveKit escopado à sala (room = channelId) e, no mesmo fluxo, uma linha em voiceStates — nunca um sem o outro"
    - "Sair do canal remove a própria linha de voiceStates; chamar de novo sem estar em nenhum canal não quebra"
    - "Ensurdecer sempre muta junto; desmutar enquanto ensurdecido também remove o ensurdecimento"
  artifacts:
    - path: "convex/schema.ts"
      provides: "Tabela voiceStates (channelId·, userId·, muted, deafened, sharing) com índices by_channel, by_user e by_channel_and_user"
      contains: "voiceStates"
    - path: "convex/voice.ts"
      provides: "joinVoiceChannel (action), leaveVoiceChannel, setMuted, setDeafened (mutations), com autorização por membership"
      exports: ["joinVoiceChannel", "leaveVoiceChannel", "setMuted", "setDeafened"]
  key_links:
    - from: "convex/voice.ts joinVoiceChannel"
      to: "process.env.LIVEKIT_API_KEY / LIVEKIT_API_SECRET"
      via: "AccessToken(apiKey, apiSecret) da livekit-server-sdk, nunca hardcoded, nunca devolvido ao cliente"
      pattern: "LIVEKIT_API_SECRET"
    - from: "convex/voice.ts joinVoiceChannel"
      to: "serverMembers (schema de F4)"
      via: "runQuery interno confirma que o usuário é membro do servidor dono do canal antes de assinar qualquer token"
      pattern: "serverMembers"
---

<feature>
  <name>Backend de voz — entrar, sair, mutar e ensurdecer com autorização (VOICE-01, VOICE-03, VOICE-06, VOICE-07)</name>
  <files>convex/schema.ts, convex/voice.ts, convex/voice.test.ts</files>
  <behavior>
    **Pré-requisito de execução (não de código):** este plano assume que
    `convex/schema.ts` já contém as tabelas `channels` (`serverId·`, `name`,
    `type: 'text' | 'voice'`, `position`) e `serverMembers` (`serverId·`,
    `userId·`, ...) produzidas pela Fase 4, com o formato descrito em
    `docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md` §5. Se
    a Fase 4 ainda não rodou quando este plano for executado, **parar e
    reportar o bloqueio** em vez de inventar essas tabelas aqui — schema é
    responsabilidade de quem o requisito realmente pertence.

    Este plano também assume que o Plano `07-00` (credenciais do LiveKit no
    Convex) já rodou — sem `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/`LIVEKIT_URL`
    no ambiente do Convex, `joinVoiceChannel` falha em runtime real mesmo com
    os testes (que usam `convex-test`, sem rede) passando.

    **Spike primeiro, antes de qualquer lógica de autorização** (`07-RESEARCH.md`
    §1): escrever um teste isolado que importa `AccessToken` de
    `livekit-server-sdk`, constrói um token com uma chave/segredo fake e chama
    `await token.toJwt()` dentro de `convexTest`, sem `"use node"` no arquivo.
    Se esse teste falhar por incompatibilidade de runtime, é a primeira coisa a
    resolver (pode exigir `"use node"` em `convex/voice.ts`, o que muda a forma
    do resto do arquivo) — não prosseguir com o restante da feature até este
    teste passar.

    **Schema** — adicionar em `convex/schema.ts`:
    ```
    voiceStates: defineTable({
      channelId: v.id('channels'),
      userId: v.id('users'),
      muted: v.boolean(),
      deafened: v.boolean(),
      sharing: v.boolean(),
    })
      .index('by_channel', ['channelId'])
      .index('by_user', ['userId'])
      .index('by_channel_and_user', ['channelId', 'userId'])
    ```
    `sharing` existe desde já (é campo do design §5) mas só é escrito pela
    Fase 8 — aqui sempre `false` na criação da linha.

    **`joinVoiceChannel` (action, args: `{ channelId: v.id('channels') }`)**:
    1. `ctx.auth.getUserIdentity()` — sem identidade, lança erro. Caso de
       teste: chamar sem `withIdentity`, esperar rejeição, e confirmar que
       nenhuma linha aparece em `voiceStates`.
    2. `ctx.runQuery` para um `internalQuery` que resolve o documento `users`
       pelo `workosId` da identidade, resolve o `channel` pelo `channelId`, e
       confirma `channel.type === 'voice'` e que existe uma linha em
       `serverMembers` para `(channel.serverId, user._id)`. Qualquer uma
       dessas condições falhando lança erro descritivo. Casos de teste:
       usuário sem documento em `users`; canal inexistente; canal do tipo
       `'text'`; usuário autenticado mas não-membro do servidor dono do
       canal. Em todos, nenhuma linha deve aparecer em `voiceStates` e nenhum
       token deve ser retornado.
    3. Ler `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/`LIVEKIT_URL` de
       `process.env`; faltando qualquer uma, lançar erro explícito
       ("LiveKit não configurado — ver 07-00"), nunca deixar `undefined`
       silenciosamente virar parte da chamada ao SDK.
    4. Assinar o `AccessToken` com `identity: user._id` (não `workosId`, não
       `username#tag` — ver `07-RESEARCH.md` §6, o `identity` do token é o
       mesmo valor que o webhook do Plano 07-02 vai usar para achar a linha
       certa em `voiceStates`) e um `VideoGrant` com `room: channelId,
       roomJoin: true, canPublish: true, canSubscribe: true`.
    5. `ctx.runMutation` para um `internalMutation` que faz upsert da linha em
       `voiceStates` (busca por `by_channel_and_user`; se existir, não faz
       nada além de garantir que existe — não reseta `muted`/`deafened` de
       uma sessão anterior nesse mesmo canal; se não existir, insere com
       `muted: false, deafened: false, sharing: false`). Caso de teste:
       chamar `joinVoiceChannel` duas vezes seguidas para o mesmo usuário no
       mesmo canal e confirmar que existe exatamente uma linha, não duas.
    6. Retornar `{ token, url: process.env.LIVEKIT_URL }`.

    Caso de teste central: membro autorizado chamando `joinVoiceChannel`
    recebe um token (string JWT não-vazia — decodificar o payload sem
    verificar assinatura só para confirmar `video.room === channelId` e
    `sub`/`identity` correspondendo ao `user._id`) e, no mesmo `t.run`, uma
    linha em `voiceStates` com `channelId`, `userId` e os três booleanos
    default.

    **`leaveVoiceChannel` (mutation, sem args)**: identidade autenticada
    obrigatória; encontra a linha de `voiceStates` do usuário (por
    `by_user` — um usuário só está em um canal de voz por vez neste produto)
    e apaga. Se não existir nenhuma linha, não lança erro — é idempotente
    (cobre o caso de UI dessincronizada chamando leave duas vezes). Caso de
    teste: chamar sem nunca ter entrado em canal nenhum, não deve lançar.

    **`setMuted({ muted: v.boolean() })` e `setDeafened({ deafened: v.boolean() })`**
    (mutations, identidade autenticada obrigatória): encontram a própria
    linha de `voiceStates` (por `by_user`); se não existir (usuário não está
    em nenhum canal), lançam erro. Semântica obrigatória, testada
    explicitamente:
    - `setDeafened({ deafened: true })` seta `deafened: true` **e**
      `muted: true` na mesma chamada.
    - `setMuted({ muted: false })` enquanto `deafened === true` também seta
      `deafened: false` (desmutar remove o ensurdecimento — design §8, evita
      "falar no vácuo").
    - `setMuted({ muted: true })` isolado não mexe em `deafened`.
    - `setDeafened({ deafened: false })` isolado não mexe em `muted` (só
      remove a surdina; o microfone continua como estava).
  </behavior>
  <implementation>
    `npm install livekit-server-sdk` como dependência (não devDependency —
    roda em produção, dentro da action). Importar `AccessToken` de
    `livekit-server-sdk` em `convex/voice.ts`.

    Seguir o padrão já usado em `convex/presence.ts` para autenticação
    (`ctx.auth.getUserIdentity()`, resolver `users` por `by_workos_id`) — não
    duplicar a lógica de resolver o `user` a partir da identidade sem
    necessidade; extrair um helper se o mesmo trecho aparecer em mais de uma
    função deste arquivo.

    RED → GREEN → REFACTOR, nesta ordem específica (o spike do SDK primeiro,
    depois autorização, depois os efeitos colaterais):
    1. RED: teste do spike `AccessToken`/`toJwt()` isolado.
    2. GREEN: confirma que roda sem `"use node"`.
    3. RED: os casos de rejeição de `joinVoiceChannel` (sem identidade, sem
       user, canal errado, não-membro).
    4. GREEN: `internalQuery` de validação.
    5. RED: caso de sucesso de `joinVoiceChannel` (token + linha em
       `voiceStates`) e o caso de idempotência (join duas vezes).
    6. GREEN: `internalMutation` de upsert + composição da action.
    7. RED: `leaveVoiceChannel`, `setMuted`, `setDeafened` (todos os casos de
       semântica listados acima).
    8. GREEN: implementação das três mutations.
    9. REFACTOR: extrair helper de "resolver `user` autenticado ou lançar" se
       repetido 3+ vezes no arquivo.

    Rodar com `npx vitest run convex/voice.test.ts`.
  </implementation>
</feature>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/07-voz/07-RESEARCH.md
@docs/superpowers/specs/2026-08-18-janja-discord-clone-design.md
@convex/schema.ts
@convex/presence.ts
@convex/presence.test.ts

# Este plano NÃO cria nenhuma query de leitura para a UI (ex.: "listar
# participantes de um canal") — isso fica no Plano 07-04, junto da tela que
# consome. Não adicionar `convex/http.ts` aqui — isso é do Plano 07-02.
</context>

<verification>
- `npx vitest run convex/voice.test.ts` passa, incluindo o teste de spike do `AccessToken`.
- Um não-membro do servidor nunca recebe token nem gera linha em `voiceStates` (autorização real, não só checada na UI).
- `setDeafened(true)` sempre implica `muted: true` na mesma linha; `setMuted(false)` estando ensurdecido sempre remove o ensurdecimento — nenhuma combinação contrária é alcançável pelas mutations.
</verification>

<success_criteria>
VOICE-01 (autorização de entrada), VOICE-03 (saída) e a semântica de
VOICE-06/VOICE-07 (mute/deafen) estão corretas no nível de dados, provadas
por teste automatizado — antes de qualquer UI ou conexão real de mídia
depender delas.
</success_criteria>

<output>
After completion, create `.planning/phases/07-voz/07-01-SUMMARY.md`
</output>
