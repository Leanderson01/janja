---
phase: 10-versao-web
plan: 06
type: execute
wave: 4
depends_on: ["10-04"]
files_modified:
  - src/renderer/src/platform/web/screenshare.tsx
  - src/renderer/src/platform/web/screenshare.test.tsx
  - src/renderer/src/lib/web-screenshare-audio.ts
  - src/renderer/src/lib/web-screenshare-audio.test.ts
autonomous: true

must_haves:
  truths:
    - "Depois de compartilhar na web, o app LÊ DE VOLTA o que o Chrome concedeu e escreve isso no console — se veio faixa de áudio, e se `restrictOwnAudio` foi de fato aplicado"
    - "Compartilhar uma JANELA na web avisa que vai sem som, porque no Chrome/Windows janela não tem áudio — em vez de deixar a pessoa descobrir que ninguém ouviu nada"
    - "Quando o pedido de `restrictOwnAudio` não é atendido, isso aparece como aviso explícito, não como silêncio"
    - "O veredito é produzido por uma função pura, testável sem navegador, e o teste cobre os cinco resultados possíveis"
    - "Nada disso toca o caminho do Electron: `platform/electron/screenshare.tsx` tem diff vazio neste plano"
  artifacts:
    - path: "src/renderer/src/lib/web-screenshare-audio.ts"
      provides: "função pura que traduz o que o navegador concedeu em veredito + texto para a pessoa"
      exports: ["describeWebScreenShareAudio"]
      min_lines: 70
    - path: "src/renderer/src/lib/web-screenshare-audio.test.ts"
      provides: "os cinco vereditos provados sem navegador"
      min_lines: 80
    - path: "src/renderer/src/platform/web/screenshare.tsx"
      provides: "constraints do Chrome + leitura de volta pós-publicação"
      exports: ["screenShare"]
  key_links:
    - from: "src/renderer/src/platform/web/screenshare.tsx"
      to: "MediaStreamTrack.getSettings"
      via: "leitura de volta de restrictOwnAudio e displaySurface na track publicada"
      pattern: "getSettings\\(\\)"
    - from: "src/renderer/src/platform/web/screenshare.tsx"
      to: "src/renderer/src/lib/web-screenshare-audio.ts"
      via: "describeWebScreenShareAudio produzindo o veredito"
      pattern: "describeWebScreenShareAudio"
---

<objective>
Fazer o alvo web dizer, toda vez, o que o navegador realmente concedeu no
compartilhamento — e transformar isso na instrumentação que o experimento do
eco (Plano 10-09) vai precisar.

Purpose: na web o LiveKit faz sozinho o que custa 140 linhas de ponte PCM no
Electron: se o stream do `getDisplayMedia` trouxer faixa de áudio, ele cria um
`LocalAudioTrack` com `source = Track.Source.ScreenShareAudio` e publica junto
(`livekit-client.esm.mjs:29010-29013`). O trabalho aqui não é fazer o áudio
existir — é **provar o que existe**. Duas coisas tornam isso obrigatório:

1. **`restrictOwnAudio` é best-effort por especificação.** Se a remoção por
   processamento falhar, o agente pode excluir todo o áudio originado da aba
   capturadora — ou não excluir nada. A única prova de que o pedido foi
   atendido é ler `track.getSettings().restrictOwnAudio`, e ela é barata.
2. **"Compartilhar janela" no Chrome/Windows é sempre mudo.** Não existe áudio
   de janela (issue 40947205 do Chromium). Quem escolhe a superfície é a
   pessoa, no diálogo nativo — o app não pode escolher por ela, mas pode dizer
   o que aconteceu.

Output: um veredito produzido por função pura, com texto para a pessoa e log
para quem for depurar, e cinco casos cobertos por teste sem navegador nenhum.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-versao-web/10-RESEARCH.md
@.planning/phases/10-versao-web/10-02-SUMMARY.md
@.planning/phases/10-versao-web/10-04-SUMMARY.md
@src/renderer/src/platform/web/screenshare.tsx
@src/renderer/src/platform/contract.ts

# O caminho do desktop, que este plano NÃO toca — e a nota histórica sobre por
# que `restrictOwnAudio` foi abandonada LÁ, que não vale aqui
@src/renderer/src/platform/electron/screenshare.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: O veredito, como função pura</name>
  <files>src/renderer/src/lib/web-screenshare-audio.ts, src/renderer/src/lib/web-screenshare-audio.test.ts</files>
  <action>
    Criar `describeWebScreenShareAudio(input)` — sem tocar em DOM, sem tocar em
    LiveKit, recebendo só o que já foi lido:

        type WebScreenShareAudioInput = {
          /** A captura trouxe alguma faixa de áudio? */
          hasAudioTrack: boolean
          /** `getSettings().displaySurface` da faixa de VÍDEO: 'browser' | 'window' | 'monitor' | undefined */
          displaySurface?: string
          /** `getSettings().restrictOwnAudio` da faixa de ÁUDIO. `undefined` = o
           *  navegador nem reporta a propriedade (Chrome < 141, ou não-Chromium). */
          restrictOwnAudio?: boolean
        }

        type WebScreenShareAudioVerdict = {
          kind: 'no-audio-window' | 'no-audio-declined' | 'audio-protected'
              | 'audio-unprotected' | 'audio-unknown-support'
          /** Frase curta, em português, para a pessoa. `null` quando não há o que dizer. */
          message: string | null
          /** Linha longa para o console — é a que serve ao experimento do eco. */
          log: string
        }

    As cinco regras, em ordem de avaliação:
    1. `!hasAudioTrack && displaySurface === 'window'` -> `no-audio-window`.
       Mensagem: compartilhar uma janela não leva som; para levar, escolher uma
       aba ou a tela inteira. **Esta é a única das cinco que a pessoa
       *precisa* ler** — as outras são diagnóstico.
    2. `!hasAudioTrack` (qualquer outra superfície) -> `no-audio-declined`. A
       pessoa não marcou "compartilhar áudio" no diálogo. Mensagem curta
       dizendo isso, sem culpar ninguém.
    3. `hasAudioTrack && restrictOwnAudio === true` -> `audio-protected`.
       `message: null` (não há nada a dizer quando deu certo), log afirmando
       que o filtro foi aplicado.
    4. `hasAudioTrack && restrictOwnAudio === false` -> `audio-unprotected`. O
       pedido foi feito e **negado**: existe risco real de os outros ouvirem a
       si mesmos. Mensagem avisando que o áudio pode retornar como eco.
    5. `hasAudioTrack && restrictOwnAudio === undefined` ->
       `audio-unknown-support`. O navegador não reporta a propriedade — muito
       provavelmente Chrome < 141 ou não-Chromium. Mensagem no mesmo tom da 4,
       e log dizendo explicitamente "este navegador não reporta
       `restrictOwnAudio`; a versão do Chrome precisa ser >= 141".

    O `log` de todos os casos inclui os três valores de entrada. **Isso não é
    zelo: é a instrumentação do experimento do Plano 10-09**, que separa "não
    houve eco porque o filtro funcionou" de "não houve eco por acaso" de "a
    flag nem existe neste Chrome". Sem esse log, os três resultados são
    indistinguíveis pelo relato de quem estava na call.

    Cabeçalho do arquivo com a matriz do Chrome/Windows, que é o que torna as
    regras legíveis:

    | Superfície | Vídeo | Áudio |
    |---|---|---|
    | Aba (`browser`) | sim | sim — só o áudio daquela aba, **sem eco por construção** |
    | Janela (`window`) | sim | **não existe** no Chrome/Windows |
    | Tela inteira (`monitor`) | sim | sim, com `systemAudio: 'include'` — e é o áudio do sistema INTEIRO, que inclui a voz dos outros que a nossa própria aba está tocando |

    Teste: um caso por regra, mais um provando que `displaySurface: 'monitor'`
    sem áudio cai na regra 2 (e não na 1).
  </action>
  <verify>`npx vitest run src/renderer/src/lib/web-screenshare-audio.test.ts` — 6 testes passando; `npm run typecheck` + `npm run typecheck:web-target` exit 0.</verify>
  <done>O veredito é uma função pura com cinco saídas nomeadas, provada sem navegador, e o log carrega o que o experimento do eco precisa.</done>
</task>

<task type="auto">
  <name>Task 2: A leitura de volta na implementação web, e o teste do gancho</name>
  <files>src/renderer/src/platform/web/screenshare.tsx, src/renderer/src/platform/web/screenshare.test.tsx</files>
  <action>
    Substituir o stub de `startAudio(room)` do Plano 10-02 pela leitura de
    volta de verdade. O gancho já é chamado por `voice-context.tsx` logo depois
    de `setScreenShareEnabled(true)` resolver — não mudar o call-site, que
    pertence a outro plano.

    `startAudio(room)` faz, sem lançar nunca:
    1. Achar as publicações locais de `Track.Source.ScreenShare` (vídeo) e
       `Track.Source.ScreenShareAudio` (áudio) em
       `room.localParticipant.trackPublications`.
    2. `displaySurface` = `videoTrack.mediaStreamTrack.getSettings().displaySurface`.
       `restrictOwnAudio` = `audioTrack?.mediaStreamTrack.getSettings().restrictOwnAudio`
       (com o cast necessário: a propriedade é recente e pode não estar no
       `MediaTrackSettings` do TypeScript instalado — usar um tipo local
       `{ restrictOwnAudio?: boolean; displaySurface?: string }` em vez de
       `any`, e comentar o porquê).
    3. Chamar `describeWebScreenShareAudio(...)`, sempre `console.info` do
       `log`, e `toast.warning(message)` quando `message !== null` (o projeto
       já usa `sonner`; seguir o padrão de `platform/electron/screenshare.tsx`).
    4. **Envolver tudo num try/catch que só loga.** O contrato de `startAudio`
       é o mesmo do Electron: NUNCA lança e NUNCA derruba o vídeo. Uma falha ao
       ler `getSettings()` não pode encerrar um compartilhamento que já está no
       ar.

    **Não** implementar retry, não tentar republicar áudio, não mexer nas
    constraints (elas ficaram certas no Plano 10-02). Se a faixa de áudio não
    veio, ela não vem — quem decide é o diálogo do Chrome.

    `stopAudio()` continua no-op documentado: não há captura própria a
    encerrar; o LiveKit despublica a faixa de áudio junto com a de vídeo
    porque ela nasceu com `source = ScreenShareAudio`.

    **`platform/web/screenshare.test.tsx`** (jsdom, import relativo
    `./screenshare`), com um `room` falso cujas publicações devolvem
    `getSettings()` controlado: (1) só vídeo, `displaySurface: 'window'` ->
    avisa que vai sem som; (2) vídeo + áudio com `restrictOwnAudio: true` ->
    nenhum toast, log presente; (3) vídeo + áudio com `restrictOwnAudio:
    false` -> avisa sobre eco; (4) `getSettings()` lançando -> `startAudio`
    resolve mesmo assim e não propaga; (5) `captureOptions` devolve
    `restrictOwnAudio` **dentro** de `audio` e `systemAudio: 'include'`,
    `selfBrowserSurface: 'exclude'` — a prova, em teste, do que o SDK repassa
    ao `getDisplayMedia` e do que ele **não** repassa
    (`suppressLocalAudioPlayback` do nível de cima é descartado por
    `screenCaptureToDisplayMediaStreamOptions`, `livekit-client.esm.mjs:13350-13359`).
  </action>
  <verify>
    `npx vitest run src/renderer/src/platform/web/screenshare.test.tsx` — 5 testes passando.
    `git diff --stat src/renderer/src/platform/electron/screenshare.tsx` **vazio**.
    `git diff --stat src/renderer/src/state/voice-context.tsx` **vazio** neste plano.
    `npm run typecheck` + `npm run typecheck:web-target` exit 0; `npx vitest run` sem regressão sobre a baseline da fase (644 testes em 38 arquivos, mais os que os planos anteriores acrescentaram); `npm run build:web && npm run verify:web-bundle -- --strict-bridges` exit 0.
  </verify>
  <done>Toda transmissão de tela na web deixa no console a prova do que o navegador concedeu, e avisa a pessoa nos dois casos em que ela precisa saber.</done>
</task>

</tasks>

<verification>
**O que passou a ser verificável no Chrome do Windows via `localhost:5173`:**
- Que `restrictOwnAudio` aparece (ou não) em `getSettings()` **na máquina do
  Leo, com o Chrome dele**. Esta é a pergunta em aberto nº 1 da pesquisa, e a
  pesquisa recomendou que ela fosse o PRIMEIRO passo do checkpoint: se o
  Chrome for < 141, a base de comparação do experimento do eco está errada e
  o teste precisa ser refeito. Custo: 1 minuto, sozinho, sem instalar nada.
- Que compartilhar aba, janela e tela inteira produzem os três vereditos
  esperados — sozinho, sem mais ninguém na call.

**O que continua exigindo três máquinas e três pessoas:**
- **Se há eco.** Esta é a parte que nenhuma leitura substitui: por padrão, o
  áudio de sistema capturado pelo Chrome "inclui todo o áudio tocado pelo
  sistema nos dispositivos de saída" — inclusive a voz dos outros que a
  própria aba está tocando. O experimento está no Plano 10-09, §5.4 da
  pesquisa, com os três resultados possíveis e o que cada um significa para a
  Fase 8.6. Este plano só constrói a instrumentação que torna o resultado
  interpretável.

**Prova de que o desktop não regrediu:** este plano **não toca em nenhum
arquivo do caminho Electron**. Os dois `git diff --stat` vazios no `<verify>`
são a prova, e são obrigatórios. Se algum deles não estiver vazio, o plano saiu
do escopo.
</verification>

<success_criteria>
- `describeWebScreenShareAudio` com cinco vereditos, provados por teste sem
  navegador.
- `startAudio` da web lê `getSettings()` das duas faixas, loga sempre e avisa
  quando precisa — e nunca lança.
- `captureOptions` provado em teste: `restrictOwnAudio` dentro de `audio`.
- Diff vazio em `platform/electron/screenshare.tsx` e em `voice-context.tsx`.
- `verify:web-bundle --strict-bridges` continua exit 0.
</success_criteria>

<output>
Ao terminar, criar `.planning/phases/10-versao-web/10-06-SUMMARY.md`, incluindo
o formato exato da linha de log que o experimento do Plano 10-09 vai procurar
no console — copiada literalmente, para o roteiro do checkpoint poder pedir
"cole esta linha".
</output>
