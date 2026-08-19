---
phase: quick/001-corrigir-deadlock-do-vad-microfone-mudo
plan: 001
type: execute
wave: 1
depends_on: []
files_modified:
  - src/renderer/src/state/voice-context.tsx
  - src/renderer/src/components/shell/VoiceSettingsPopover.tsx
autonomous: false
must_haves:
  truths:
    - "Usuário com perfil limpo (sem `janja:voice-preferences` no localStorage) entra num canal em modo VAD, fala, e os outros participantes ouvem — sem tocar em nenhuma configuração"
    - "O monitor de VAD continua lendo nível de áudio real enquanto a track publicada está mutada (o silêncio digital da publicação não cega o analisador)"
    - "Mute manual (botão do rodapé) continua vencendo o VAD: mutado, falar não reabre o microfone"
    - "Voltar de PTT para VAD, sem sair da call, volta a transmitir"
    - "Trocar de microfone nas configurações faz o VAD passar a ouvir o microfone NOVO"
    - "Nenhuma captura de microfone fica aberta depois de sair do canal, trocar de modo, trocar de dispositivo ou desmontar o provider"
    - "Se o VAD não conseguir se instalar, o microfone permanece ABERTO (fail-open) e o erro aparece no console — nunca mudo silencioso"
  artifacts:
    - path: "src/renderer/src/state/voice-context.tsx"
      provides: "VAD sobre track de análise clonada, ordenação fail-open, cleanup do clone, resposta a troca de dispositivo"
      contains: "vadAnalysisTrackRef"
    - path: "src/renderer/src/components/shell/VoiceSettingsPopover.tsx"
      provides: "Medidor de nível lendo fonte viva (não a publicação mutada pelo VAD)"
      contains: "getVadAnalysisTrack"
  key_links:
    - from: "src/renderer/src/state/voice-context.tsx (startVadMonitor)"
      to: "MediaStreamTrack.clone() da publicação do microfone"
      via: "clone independente de `enabled`, nunca publicado"
      pattern: "\\.clone\\(\\)"
    - from: "src/renderer/src/state/voice-context.tsx (applyVoicePreferences)"
      to: "room.localParticipant.setMicrophoneEnabled(false, ...)"
      via: "só executa DEPOIS de o monitor estar rodando"
      pattern: "setMicrophoneEnabled\\(false"
    - from: "RoomEvent.ActiveDeviceChanged ('audioinput')"
      to: "applyVoicePreferences()"
      via: "reinstala o VAD sobre a nova track publicada"
      pattern: "ActiveDeviceChanged"
---

<working_directory>
**O diretório de trabalho deste plano é `/home/leo/workspace/janja`.**

O cwd herdado pelo executor está ERRADO (é um worktree vazio de outro repo). Comece TODO
comando com `cd /home/leo/workspace/janja &&` e use caminhos absolutos ao ler/escrever
arquivos. Não crie nada fora de `/home/leo/workspace/janja`.
</working_directory>

<objective>
Corrigir o deadlock do VAD: hoje, em modo `vad` (o padrão de todo usuário novo), o
`AnalyserNode` é ligado na MESMA `MediaStreamTrack` que o LiveKit muta. Track mutada =
`enabled = false` = silêncio digital para o Web Audio, então o VAD lê RMS ≈ 0 para
sempre, nunca cruza o limiar, nunca reabre o microfone. O usuário fica permanentemente
mudo, sem nenhum erro visível.

Purpose: é o caminho padrão de TODO usuário novo. O critério de sucesso do projeto é o
grupo largar o Discord — quem entra e não é ouvido desiste antes de chegar em qualquer
outra funcionalidade.

Output: VAD analisando uma track de análise clonada (viva independentemente do estado de
publicação), ordenação fail-open (nunca muta antes de o monitor estar de pé, nunca fica
mudo por falha de setup), cleanup em 100% dos caminhos, e a fonte de análise acompanhando
troca de dispositivo.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@HANDOFF.md

@src/renderer/src/state/voice-context.tsx
@src/renderer/src/lib/vad.ts
@src/renderer/src/lib/mic-test.ts
@src/renderer/src/components/shell/VoiceSettingsPopover.tsx
@src/renderer/src/lib/voice-preferences.ts
@.planning/todos/pending/2026-08-19-voz-nao-sai-em-modo-vad-no-primeiro-uso.md
</context>

<diagnostico_fechado>
Investigação de causa raiz JÁ FEITA e confirmada no código — **não refazer**:

1. `applyVoicePreferences()` (`voice-context.tsx:255-280`), em modo `vad`, dispara
   `setMicrophoneEnabled(false, ...)` SEM `await` e em seguida chama `startVadMonitor()`.
2. `startVadMonitor()` (`voice-context.tsx:232-250`) liga o `AnalyserNode` na
   `MediaStreamTrack` **da publicação do LiveKit**:
   `room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack`.
3. `livekit-client` 2.22, `LocalTrack.setTrackMuted` (confirmado em
   `node_modules/livekit-client/dist/livekit-client.esm.mjs:20778-20785`):
   `this._mediaStreamTrack.enabled = !muted`. Track com `enabled = false` entrega
   **silêncio digital** ao Web Audio — não "menos volume", zero.
4. Logo: microfone fechado → VAD lê RMS ≈ 0 → nunca cruza `threshold` (0.15) → nunca
   chama `onSpeakingChange(true)` → microfone permanece fechado. Deadlock permanente.

Falha secundária no mesmo caminho, que pode coexistir: se a publicação do microfone ainda
não existir quando `applyVoicePreferences()` roda, `startVadMonitor()` cai no
`if (!mediaStreamTrack) return` (`voice-context.tsx:235`) e NENHUM monitor é criado — mas
o `setMicrophoneEnabled(false)` da linha anterior já aconteceu. Mudo idêntico, igualmente
silencioso.

**Princípio da correção: o VAD não pode analisar a track que ele mesmo silencia.**
</diagnostico_fechado>

<decisao>
## Abordagem escolhida: track de ANÁLISE clonada (`publishedTrack.clone()`)

O VAD passa a analisar um **clone** da `MediaStreamTrack` publicada. O clone compartilha a
mesma fonte de captura (mesmo dispositivo, mesma sessão de `getUserMedia`, mesmo
processamento de eco/ruído/ganho), mas tem `enabled` **próprio e independente**: quando o
LiveKit faz `publishedTrack.enabled = false` para mutar, o clone continua entregando áudio
real ao `AnalyserNode`. O deadlock deixa de existir por construção.

Esta é a decisão do plano. O executor **não** deve reavaliá-la.

### Por que não as alternativas

| Alternativa | Por que não |
|---|---|
| **Captura independente via `openMicCapture()`** (segundo `getUserMedia`) | Funciona, e o código já existe (`lib/mic-test.ts`) — mas abre um SEGUNDO dispositivo de verdade: pode falhar em drivers Windows com modo exclusivo (`NotReadableError`), duplica o pipeline de processamento (mais CPU/bateria numa call longa), torna `startVadMonitor` assíncrono (mais janelas de corrida), exige rastrear `deviceId` por fora e refazer VOICE-16 num terceiro call-site. O clone não abre dispositivo nenhum, é síncrono, herda `AUDIO_CAPTURE_OPTIONS` da captura original e não pode divergir dela. |
| **Manter a track viva e silenciar só a publicação** | Não existe no SDK. `setTrackMuted` sempre faz `_mediaStreamTrack.enabled = !muted` (esm.mjs:20784), sem opção. `stopMicTrackOnMute: false` (o padrão, esm.mjs:19331) só evita PARAR a track — ela continua `enabled = false`. Só daria para contornar mexendo em campo interno do SDK, que quebra na próxima versão menor. |
| **Só `await setMicrophoneEnabled(false)` antes de `startVadMonitor`** | Conserta apenas a falha secundária (ordem). O deadlock principal continua idêntico: o analisador segue ligado numa track mutada. Ordenação entra como parte da correção, não como a correção. |

### Por que isto NÃO introduz eco nem áudio duplicado (critério de sucesso nº 2)

- O clone **nunca é publicado**. Ele nunca é passado para `setMicrophoneEnabled`,
  `publishTrack`, `switchActiveDevice` ou qualquer API do LiveKit — só para
  `createVadMonitor`, que é Web Audio puro e não conecta nada ao `destination`
  (`lib/vad.ts` liga `source → analyser` e para aí; nada é reproduzido em alto-falante).
- O clone não é uma segunda captura: é a MESMA fonte, com o MESMO
  `echoCancellation`/`noiseSuppression`/`autoGainControl` já aplicados na captura original
  (VOICE-16 continua satisfeito sem um novo call-site — não há novo `getUserMedia` aqui).
  Por isso esta abordagem é estritamente mais segura, quanto a eco, do que abrir uma
  segunda captura.
- Consequência: o LiveKit continua publicando exatamente uma track de microfone, como hoje.

### Fail-open: o microfone nunca fica mudo por falha de setup

Ordem obrigatória: **obter track → clonar → iniciar monitor → só então mutar**. Se
qualquer passo antes do mute falhar, o microfone **permanece aberto e transmitindo**, com
erro no console. Um microfone aberto por engano é constrangedor; um microfone mudo por
engano é o bug que estamos corrigindo (lição nº 3 do HANDOFF: "guarda que só marca sucesso
não protege o caminho de falha").

Efeito colateral aceito: no join, o microfone fica aberto por alguns milissegundos entre
`setMicrophoneEnabled(true)` e o mute do VAD. É o mesmo comportamento do Discord e é
preferível à alternativa.
</decisao>

<tasks>

<task type="auto">
  <name>Task 1: VAD sobre track de análise clonada, com ordenação fail-open e cleanup</name>
  <files>src/renderer/src/state/voice-context.tsx</files>
  <action>
No `VoiceProvider`, reescreva o trio `startVadMonitor` / `stopVadMonitor` /
`applyVoicePreferences`.

**1. Novas refs (junto de `vadMonitorRef`, ~linha 122):**

- `vadAnalysisTrackRef: useRef<MediaStreamTrack | null>(null)` — o clone de análise vivo
  agora. Comente que é um clone da track publicada, que NUNCA é publicado, e que existe
  exatamente porque o LiveKit muta fazendo `enabled = false` na track publicada.
- `vadGenerationRef: useRef(0)` — contador de geração, incrementado por `stopVadMonitor`.
  Serve para invalidar um `applyVoicePreferences` em voo (ele agora tem `await`): quem
  passou por um `await` compara a geração que capturou com a atual e aborta se mudou.

**2. `stopVadMonitor()` — para monitor E clone, nesta ordem:**

```ts
function stopVadMonitor(): void {
  // Invalida qualquer aplicação de preferências em voo (ver applyVoicePreferences).
  vadGenerationRef.current += 1
  vadMonitorRef.current?.stop()
  vadMonitorRef.current = null
  // Parar o CLONE não para a track publicada: a fonte de captura só encerra quando
  // TODAS as tracks derivadas dela param, e a track do LiveKit continua viva.
  // Mas não parar aqui deixa o microfone aberto para sempre — é o vazamento que
  // ninguém vê e todo mundo sente na bateria.
  vadAnalysisTrackRef.current?.stop()
  vadAnalysisTrackRef.current = null
}
```

**3. `startVadMonitor(prefs)` — passa a retornar `boolean` (`true` = monitor de pé):**

- Lê a track publicada como hoje
  (`room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack`).
- Se não houver track: `console.error('[voice] VAD: sem track de microfone publicada — microfone permanece ABERTO')` e `return false`. **Nunca mais um `return` silencioso.**
- `const analysisTrack = publishedTrack.clone()` dentro de `try/catch`; em erro, logar e
  `return false`.
- Se `analysisTrack.readyState !== 'live'`: `analysisTrack.stop()`, logar, `return false`.
- Guardar em `vadAnalysisTrackRef.current` e criar `createVadMonitor(analysisTrack, {...})`
  com o MESMO corpo de `onSpeakingChange` de hoje (incluindo a guarda
  `if (speaking && manualMuteRef.current) return` — mute manual vence o VAD, não regredir)
  e `threshold: prefs.vadThreshold`.
- Se `createVadMonitor` lançar: parar o clone, zerar as duas refs, logar, `return false`.
- Em sucesso: `console.info('[voice] VAD ativo sobre clone de análise da track publicada')`
  e `return true`. Este log é o que torna o checkpoint humano em Windows diagnosticável
  pelo DevTools sem outra rodada de ida e volta.

**4. `applyVoicePreferences` vira um par sync/async:**

```ts
async function applyVoicePreferencesAsync(): Promise<void> {
  const prefs = loadVoicePreferences()
  window.voice.setPttModeActive(prefs.mode === 'ptt')   // mantém 07-06 intacto
  if (activeChannelRef.current === null) return

  stopVadMonitor()                       // incrementa a geração
  const generation = vadGenerationRef.current

  if (prefs.mode !== 'vad') return       // modo 'ptt': 07-06 comanda a track

  if (!startVadMonitor(prefs)) return    // FAIL-OPEN: não muta o que não é monitorado

  if (vadGenerationRef.current !== generation) return   // teardown durante o setup
  try {
    await room.localParticipant.setMicrophoneEnabled(false, AUDIO_CAPTURE_OPTIONS)
  } catch (err) {
    console.error('[voice] VAD: falha ao fechar o microfone após iniciar o monitor', err)
  }
}

function applyVoicePreferences(): void {
  void applyVoicePreferencesAsync().catch((err) =>
    console.error('[voice] applyVoicePreferences falhou', err)
  )
}
```

Mantenha `applyVoicePreferences: () => void` no `VoiceContextValue` (o popover e o efeito
de PTT chamam de forma síncrona — não mexa nesses call-sites).

**5. No caminho de join (~linha 546):** troque `applyVoicePreferences()` por
`await applyVoicePreferencesAsync()`. Já está dentro de função `async`, dentro do `try` que
trata falha de join. Assim o join só termina com o estado de transmissão de fato aplicado,
e um leave imediatamente depois não corre contra um setup pela metade.

**Não mexer em:** `manualMuteRef`, `deafenedRef`, a fila `transitionChainRef`,
`lastEnqueuedTargetRef`, os handlers de `Disconnected`/`ActiveSpeakersChanged`, nem os
call-sites de PTT. Eles já chamam `stopVadMonitor()` nos lugares certos e continuam
corretos — agora com o benefício de o `stopVadMonitor` também soltar o clone.

**Revisão obrigatória de cleanup (parte da entrega, não opcional):** confirme lendo o
arquivo que o clone é liberado em TODOS estes caminhos, e registre a conferência no
SUMMARY: (a) saída do canal / troca de canal (`stopVadMonitor()` na transição de leave);
(b) `RoomEvent.Disconnected` inesperado; (c) desmonte do provider (cleanup do efeito de
listeners); (d) troca de modo VAD→PTT (`stopVadMonitor()` no topo de
`applyVoicePreferencesAsync`); (e) reaplicação de preferências (mesmo ponto); (f) falha no
meio de `startVadMonitor` (os `catch` param o clone antes de retornar `false`).
  </action>
  <verify>
```
cd /home/leo/workspace/janja && npm run typecheck:web && npm run lint
```
Ambos verdes. Além disso, prove por leitura (não por execução — não há microfone em WSL2):
`grep -n "clone()\|vadAnalysisTrackRef\|vadGenerationRef" src/renderer/src/state/voice-context.tsx`
mostra o clone criado em `startVadMonitor` e parado em `stopVadMonitor`, e
`grep -n "setMicrophoneEnabled(false" src/renderer/src/state/voice-context.tsx` mostra que
o mute do VAD aparece DEPOIS da chamada a `startVadMonitor`, nunca antes.
  </verify>
  <done>
`createVadMonitor` recebe o clone (nunca a track publicada); o mute do VAD só acontece após
o monitor estar de pé; falha de setup deixa o microfone aberto com erro no console; o clone
é parado nos 6 caminhos de cleanup listados; `typecheck:web` e `lint` verdes.
  </done>
</task>

<task type="auto">
  <name>Task 2: fonte de análise acompanha troca de microfone, e o medidor do painel lê fonte viva</name>
  <files>src/renderer/src/state/voice-context.tsx, src/renderer/src/components/shell/VoiceSettingsPopover.tsx</files>
  <action>
Duas pontas da MESMA classe de defeito da Task 1 — "analisar uma fonte que não representa o
áudio real" (HANDOFF, lição nº 4: corrigir a classe, não o caso).

**A) O VAD precisa seguir a troca de dispositivo (`voice-context.tsx`)**

`VoiceSettingsPopover` troca o microfone com `room.switchActiveDevice('audioinput', id)`
(linhas 163-177), que substitui a `MediaStreamTrack` publicada por baixo. Sem tratamento, o
clone de análise continua preso ao microfone ANTIGO: o VAD passaria a decidir "está
falando" ouvindo um dispositivo que o usuário abandonou — e ainda manteria esse dispositivo
aberto (vazamento).

No efeito de listeners do `Room` (o que registra `ConnectionStateChanged`/`Disconnected`,
~linha 335), registre também:

```ts
function handleActiveDeviceChanged(kind: MediaDeviceKind): void {
  if (kind !== 'audioinput') return
  if (activeChannelRef.current === null) return
  // Reinstala o VAD sobre a track nova: para o monitor e o clone antigos e recria
  // tudo pelo caminho único de applyVoicePreferences (que já respeita o modo salvo).
  applyVoicePreferences()
}
room.on(RoomEvent.ActiveDeviceChanged, handleActiveDeviceChanged)
```

com o `room.off(...)` correspondente no cleanup. O evento existe em `livekit-client` 2.22
(`RoomEvent.ActiveDeviceChanged`, emitido por `switchActiveDevice`) e a assinatura entrega
`(kind: MediaDeviceKind, deviceId: string)` — a guarda por `kind` é obrigatória, senão
trocar a SAÍDA de áudio reinicia o VAD à toa.

**B) Expor a fonte de análise para o medidor de nível (`voice-context.tsx` + popover)**

Hoje o medidor do painel (`VoiceSettingsPopover.tsx:104-137`) lê a MESMA track publicada —
ou seja, em modo VAD com o microfone fechado ele marca zero permanente, e o slider de
limiar fica impossível de calibrar (é o mesmo defeito, na UI de configuração).

1. Em `VoiceContextValue`, adicione
   `getVadAnalysisTrack: () => MediaStreamTrack | null`, implementado como
   `() => vadAnalysisTrackRef.current`, com TSDoc explicando: é a track de análise do VAD
   (clone vivo da publicada), exposta para quem precisa MEDIR nível sem ser cego pelo mute;
   quem consome **não pode** chamar `.stop()` nela — o dono é o provider.
2. No efeito do medidor do popover, resolva a fonte assim:
   - `const shared = getVadAnalysisTrack()`
   - se `shared` existe e `shared.readyState === 'live'`: usa `shared`, com
     `ownsTrack = false`;
   - senão: pega a track publicada e usa `publicada.clone()` (mesma técnica da Task 1 — o
     medidor também não pode ser cego pelo mute do VAD ou do botão do rodapé), com
     `ownsTrack = true`; se não houver publicação, `return` como hoje.
   - No cleanup: `monitor?.stop()`, `setLevel(0)` e **só se `ownsTrack`**
     `meterTrack.stop()`. Parar a track do provider aqui mataria o VAD ao fechar o painel —
     é o erro exato a evitar, comente isso no código.
3. Acrescente `prefs.mode` e `activeInputId` às deps desse efeito, para o medidor ser
   recriado quando o usuário troca de modo ou de microfone com o painel aberto (hoje as
   deps são `[open, room, hasVoiceIntention]` e ele ficaria lendo uma fonte morta).

Não mexa em `MicTestPanel` nem em `lib/mic-test.ts` — o testador de microfone já abre a
própria captura e não é afetado por este defeito.
  </action>
  <verify>
```
cd /home/leo/workspace/janja && npm run typecheck:web && npm run lint
```
Ambos verdes. Por leitura:
`grep -n "ActiveDeviceChanged" src/renderer/src/state/voice-context.tsx` mostra o listener
registrado E removido no cleanup;
`grep -n "getVadAnalysisTrack\|ownsTrack" src/renderer/src/components/shell/VoiceSettingsPopover.tsx`
mostra que o popover só chama `.stop()` na track que ele mesmo clonou.
  </verify>
  <done>
Trocar de microfone com o VAD ativo reinstala monitor e clone sobre a track nova (e solta a
antiga); o medidor do painel lê uma fonte viva em modo VAD; fechar o painel nunca para a
track de análise do provider; `typecheck:web` e `lint` verdes.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: verificação humana em Windows nativo</name>
  <what-built>
VAD analisando um clone da track publicada (nunca mais a track que ele silencia), mute do
VAD só depois de o monitor estar de pé, fail-open em qualquer falha de setup, cleanup do
clone em todos os caminhos, VAD seguindo troca de microfone, e medidor de nível do painel
lendo fonte viva.
  </what-built>
  <o-que-nao-pode-ser-verificado-aqui>
Este ambiente é WSL2: **não existe microfone, nem Windows, nem alto-falante**. O que foi
provado no ambiente de desenvolvimento é apenas: `npm run typecheck:web` verde,
`npm run lint` verde, e a revisão por leitura dos caminhos de cleanup. Isso **não** prova
que o áudio sai (HANDOFF, lição nº 1: "verificar no ambiente errado não é verificar";
lição nº 2: "build verde não significa app funcionando"). Tudo abaixo só vale rodado em
Windows nativo, com DUAS máquinas (ou uma máquina + um segundo usuário real).
  </o-que-nao-pode-ser-verificado-aqui>
  <how-to-verify>
Prepare: Windows nativo, app rodando, DevTools do renderer aberto (aba Console), e um
segundo participante em outra máquina no mesmo canal de voz.

**1. Perfil limpo, fala sem tocar em nada (o caso do bug):**
   1. DevTools → Application → Local Storage → apague a chave `janja:voice-preferences`.
   2. Feche e reabra o app (não só recarregue).
   3. Entre no canal de voz e **fale, sem abrir configurações, sem tocar em PTT, sem sair
      e entrar de novo**.
   4. Esperado: o outro participante **ouve**; o anel de fala acende na sua foto; ao parar
      de falar, o anel apaga em ~300 ms e o outro deixa de ouvir você.
   5. No Console deve aparecer `[voice] VAD ativo sobre clone de análise da track publicada`
      e **nenhuma** linha `[voice] VAD:` de erro.

**2. Mute manual vence o VAD (não regredir):** mute pelo botão do rodapé e fale → o outro
   **não** ouve e o anel não acende. Desmute → volta a ser ouvido.

**3. Regressão PTT → VAD, sem sair da call:** configurações → push-to-talk; segure a tecla
   e fale (o outro ouve), solte (o outro deixa de ouvir); volte para detecção de voz **na
   mesma call** e fale sem tocar em mais nada → o outro **ouve**.

**4. Troca de microfone com o VAD ativo:** em modo VAD, configurações → escolha outro
   microfone; fale no microfone NOVO → o outro ouve. (Com um microfone só, alterne entre a
   entrada "Padrão" e a entrada nomeada do mesmo dispositivo e confirme que a voz continua
   saindo.)

**5. Medidor de nível do painel:** em modo VAD, abra as configurações e fale → a barra de
   nível se mexe (antes da correção ficava zerada) e dá para calibrar o slider de limiar
   vendo o ruído da sala abaixo da marca e a própria voz acima.

**6. Sem vazamento de microfone:** saia do canal e feche o painel de configurações →
   o ícone de microfone em uso do Windows some (barra de tarefas, ou Configurações →
   Privacidade e segurança → Microfone → "atividade recente" para de mostrar o app em uso).
   Repita depois de trocar VAD→PTT e depois de trocar de dispositivo.

**7. Eco:** com as duas máquinas com alto-falante ligado, converse por ~1 minuto → nenhum
   eco novo, nenhuma duplicação da própria voz em relação ao comportamento anterior.

Se qualquer passo falhar, copie as linhas `[voice]` do Console — elas dizem em qual etapa
o setup do VAD parou.
  </how-to-verify>
  <resume-signal>Responda "aprovado" ou descreva exatamente qual passo (1-7) falhou e o que apareceu no Console.</resume-signal>
</task>

</tasks>

<verification>
No ambiente de desenvolvimento (WSL2), o que dá para provar e é obrigatório:

```
cd /home/leo/workspace/janja && npm run typecheck:web && npm run lint
```

Mais a revisão por leitura, registrada no SUMMARY:
- `createVadMonitor` nunca mais recebe a track publicada — só o clone.
- O mute do VAD nunca acontece antes de o monitor estar de pé.
- O clone é parado nos 6 caminhos: leave/troca de canal, `Disconnected`, desmonte do
  provider, VAD→PTT, reaplicação de preferências, falha no meio do setup.
- O popover só chama `.stop()` numa track que ele mesmo clonou.

O restante (a voz sair de verdade) só existe depois do checkpoint da Task 3, em Windows.
</verification>

<success_criteria>
- [ ] Usuário com `localStorage` limpo entra no canal, fala, e é ouvido — sem tocar em
      nenhuma configuração (verificado em Windows, com dois participantes)
- [ ] Console mostra `[voice] VAD ativo sobre clone de análise da track publicada` e nenhum
      erro `[voice] VAD:`
- [ ] Mute manual continua vencendo o VAD
- [ ] PTT → VAD, na mesma call, volta a transmitir
- [ ] Troca de microfone reinstala o VAD sobre o dispositivo novo
- [ ] Medidor de nível do painel se mexe em modo VAD
- [ ] Nenhum microfone continua aberto após sair do canal / trocar de modo / trocar de
      dispositivo
- [ ] Sem eco novo nem áudio duplicado
- [ ] `npm run typecheck:web` e `npm run lint` verdes
</success_criteria>

<output>
Ao concluir, crie
`/home/leo/workspace/janja/.planning/quick/001-corrigir-deadlock-do-vad-microfone-mudo/001-SUMMARY.md`
e mova
`/home/leo/workspace/janja/.planning/todos/pending/2026-08-19-voz-nao-sai-em-modo-vad-no-primeiro-uso.md`
para `.planning/todos/done/` **somente depois** do "aprovado" da Task 3 — enquanto o
checkpoint em Windows não passar, o defeito continua aberto.

Stage por caminho explícito (HANDOFF, lição nº 5 — nunca `git add src/renderer`):
`git add src/renderer/src/state/voice-context.tsx src/renderer/src/components/shell/VoiceSettingsPopover.tsx`
</output>
