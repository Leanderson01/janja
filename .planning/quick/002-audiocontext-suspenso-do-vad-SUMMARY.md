# quick/002 — AudioContext suspenso do VAD

**Sintoma (Leo, uso real):** "Quando você entra pela primeira vez, você precisa
clicar em testar microfone pelo servidor, e só então o canal de voz da pessoa
funciona."

**Commits:** `64da013` (correção), `901f967` (provas), `<este>` (resumo).

---

## 1. A pesquisa, antes da correção

### A pergunta que importava

Arquitetura de contexto único e longevo, ou `resume()` em cada contexto?

**Resposta: `resume()` basta.** Não inventei arquitetura. O `livekit-client`
que este app já usa — SDK de uma empresa cujo produto é voz em grupo em tempo
real — cria contextos **múltiplos e sob demanda** e retoma cada um. Não há
contexto único compartilhado. Trocar a arquitetura seria mudança grande, sem
respaldo, e não é o que o defeito pede.

### As fontes

**Spec do Web Audio** —
<https://webaudio.github.io/web-audio-api/#allowed-to-start>

> "An AudioContext is said to be **allowed to start** if the user agent allows
> the context state to transition from 'suspended' to 'running'. A user agent
> may disallow this initial transition, and to allow it only when the
> AudioContext's relevant global object has **sticky activation**."

**Chrome, política de autoplay** —
<https://developer.chrome.com/blog/autoplay#web_audio>

> "If an AudioContext is created before the document receives a user gesture,
> it will be created in the 'suspended' state, and you will need to call
> `resume()` after the user gesture."
>
> "To detect whether the browser requires a user interaction to play audio,
> check `AudioContext.state` after you've created it. If playing is allowed, it
> should immediately switch to `running`. Otherwise it will be `suspended`. If
> you listen to the `statechange` event, you can detect changes
> asynchronously."

Ou seja, o padrão recomendado é exatamente: checar `state`, chamar `resume()`,
e ouvir `statechange`. Nada além disso.

**MDN, `BaseAudioContext.state`** —
<https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state>

O achado que muda o código: existem **quatro** estados, não três. Além de
`running`/`suspended`/`closed` há **`interrupted`** — "the audio context has
been interrupted by an occurrence outside the control of the web app",
disparado por "a conferencing or phone app on the same system requiring
exclusive access to the device's audio hardware" e por "the user closing their
laptop". Congela o grafo exatamente como `suspended` e **passa batido por um
teste de igualdade com `'suspended'`**.

Isso responde diretamente à pergunta sobre suspensão posterior: não é
hipotética, tem estado próprio na spec, e é o SO/outro app que a causa.

**LiveKit (`node_modules/livekit-client/dist/livekit-client.esm.mjs`)** — o
precedente de produção mais próximo que existe, e ele já está neste repo:

- `getNewAudioContext()` (linha ~13260): se nasce `suspended`, registra um
  listener de `click` no `document.body` **para tentar de novo no próximo
  gesto**, auto-removível, e limpa em `statechange` → `closed`.
- `Room.acquireAudioContext` (~33528): `Promise.race([resume(), sleep(200)])` —
  **nunca espera `resume()` indefinidamente** — depois relê `state === 'running'`
  e emite `AudioPlaybackStatusChanged`. A falha vira evento observável.
- `RemoteAudioTrack` (~28592): `if (context.state !== 'running')` — repare:
  **`!== 'running'`, não `=== 'suspended'`** — retoma, relê e emite
  `AudioPlaybackFailed` se ainda não estiver rodando.

Sobre Discord e Meet especificamente: **não consegui fonte primária.** Os
buscadores acessíveis daqui devolveram lixo (Bing veio com registros de tribunais
da Louisiana; DuckDuckGo, vazio). Não vou citar o que não li. O que está acima é
spec, documentação do fornecedor do navegador, e o código de um SDK de voz em
grupo em produção — mais forte que um blog sobre o Discord, de qualquer forma.

---

## 2. A correção

`src/renderer/src/lib/vad.ts`. Local, não compartilhada — **não houve mudança
arquitetural, então não houve checkpoint.**

Nova função exportada `keepAudioContextRunning(ctx): () => void`, chamada por
`createVadMonitor` **antes de montar o grafo** e descartada em `stop()`:

1. **`state !== 'running'`, nunca `=== 'suspended''`** — cobre `interrupted`.
   `closed` fica de fora de propósito: dali não se volta.
2. **Ouve `statechange` pela vida do monitor** — suspensão posterior (SO
   dormindo, hardware tomado) mataria o VAD no meio da call.
3. **O veredito relê `state`, não confia na promise.** `resume()` **resolve sem
   retomar** quando a política de autoplay recusa. Quem confia na promise não vê
   nada.
4. **Timer de veredito (500 ms).** `resume()` pode ficar pendente para sempre;
   é o que o LiveKit contorna com `race`. Nada aqui é aguardado, então o timer
   só garante que o diagnóstico saia.
5. **Rearma no próximo gesto do usuário** (`pointerdown`/`mousedown`/`keydown`/
   `touchend`, capture) quando a retomada falha. É isto que tira o "funciona por
   sorte" da equação — e é exatamente o ritual que o Leo descobriu na marra:
   abrir o teste de microfone é um clique, o clique dá sticky activation à
   página, e o contexto seguinte nasce `running`.

### Os outros pontos que criam AudioContext

| Arquivo                           | Situação                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/mic-test.ts`                 | **Não precisou de mudança.** `startLevelMeter` delega a `createVadMonitor` — herdou a correção inteira. (Ironia: é o painel que o Leo usava como muleta.) |
| `lib/screenshare-audio-bridge.ts` | Já corrigido no Plano 08.5-03.                                                                                                                            |
| `lib/voice-sounds.ts`             | Já checa `suspended` e retoma. Fora do escopo; sem defeito de silêncio (é som decorativo).                                                                |
| `state/voice-context.tsx`         | Não toquei, conforme instrução. Não cria contexto próprio.                                                                                                |

### O defeito deixou de ser silencioso

Todos com prefixo `[voice]`, como o resto do subsistema:

- `console.warn` ao detectar o contexto parado (com o `state` e o motivo);
- `console.warn` ao ficar esperando um gesto;
- `console.error` — **"a detecção de voz está INOPERANTE"** — quando não retoma;
- `console.info` quando retoma.

No caminho feliz, silêncio total.

---

## 3. Como provei

`src/renderer/src/lib/vad.test.ts`, **21 testes** (o arquivo não tinha nenhum).
Duplo injetado com os cinco comportamentos reais de `resume()`: retoma;
**RESOLVE-SEM-RETOMAR**; rejeita; nunca assenta; lança síncrono.

**Campanha de mutação: 12 mutantes, 12 mortos.**

| Mutante                                   | Morto por             |
| ----------------------------------------- | --------------------- |
| `isStalled` vira `=== 'suspended'`        | 2, 6                  |
| não tenta retomar no nascimento           | 1, 2, 7–13, 15, 18–20 |
| não escuta `statechange`                  | 5, 6, 16              |
| confia na promise em vez de reler `state` | 8–13, 15, 19          |
| não rearma no gesto                       | 12, 13, 15, 19        |
| `dispose` esquece de soltar o listener    | 15, 19                |
| `stop()` não descarta o keeper            | 19                    |
| sem timer de veredito                     | 10                    |
| `isStalled` inclui `closed`               | 4                     |
| `onGesture` não desarma                   | 14                    |
| `createVadMonitor` não chama o keeper     | 18, 19, 20            |
| sem `console.error` no veredito           | 8–11                  |

**Duas rodadas foram necessárias.** Na primeira, os mutantes de listener vazado
(`dispose` sem desarme, `onGesture` sem desarme) **SOBREVIVERAM**: os testes
observavam _efeito_ ("o clique não retomou"), e as guardas de `disposed` e de
estado fazem um listener vazado parecer inofensivo. Reescrevi 14/15/19 para
instrumentar `document.addEventListener`/`removeEventListener` e contar o
**registro em si**. Aí morreram.

### O que NÃO está provado, e por quê

Que um `AudioContext` **real** suspenso congela o `AnalyserNode` e devolve
zeros. Nem jsdom nem edge-runtime têm Web Audio — não existe `AudioContext`,
`AnalyserNode` nem `MediaStream` no ambiente de teste, e esta máquina não tem
placa de som nem janela. Esse elo é comportamento do Chromium, está na spec, e
só o app rodando confirma.

### Verificação

- Quatro passadas de typecheck limpas (`node`, `web`, `web-target`, `convex`).
- ESLint limpo nos dois arquivos.
- Suíte: **46 arquivos, 711 testes, tudo passando** (baseline era 41/664; +1
  arquivo e +21 testes meus, o resto de agentes trabalhando em paralelo nesta
  mesma árvore durante a sessão).

---

## 4. Honestidade sobre o diagnóstico

A correção é necessária e correta **independentemente**: o código criava um
`AudioContext` e nunca olhava para `state`, o que é uma falha silenciosa de
exatamente a forma descrita. Mas não posso afirmar daqui que é _a_ causa do
sintoma do Leo, e não vou repetir o erro de quick/001 fingindo certeza:

- No alvo **web** (`npm run dev:web`, o deploy da Fase 10) a política do
  Chromium vale integralmente e o contexto **nasce suspenso** sem gesto. Aqui a
  correção é claramente necessária.
- No alvo **desktop**, o Electron usa `webPreferences.autoplayPolicy` com default
  `no-user-gesture-required`
  (<https://www.electronjs.org/docs/latest/api/structures/web-preferences>), e
  `src/main/index.ts` não sobrescreve. Sob esse default o contexto _deveria_
  nascer `running` — o que deixa espaço para outra causa, ou para o caso
  `interrupted` (hardware tomado), que a correção também passa a cobrir.

**É para isso que servem os logs novos.** Se o Leo reproduzir e **não** vir
nenhum `[voice] VAD: AudioContext ...` no console, a teoria do AudioContext está
errada e procuramos noutro lugar — com uma ida e volta, não três.

---

## 5. O que o Leo precisa fazer

O teste é justamente o ritual invertido:

1. **Perfil limpo** (fecha o app, abre de novo; se for web, janela anônima).
2. Abre o DevTools no console **antes** de entrar no canal.
3. Entra num canal de voz e **fala — sem tocar em mais nada.** Nada de teste de
   microfone, nada de painel de configurações.
4. Alguém confirma se te ouviu.

E olha o console:

- Nenhuma linha `[voice] VAD: AudioContext` → o contexto nasceu `running`; se
  ainda assim não funcionar, **a causa é outra** e essa informação vale ouro.
- `... em estado "suspended" ... chamando resume()` seguido de `... retomado` →
  era isto, e está corrigido.
- `... AudioContext NÃO retomou ... INOPERANTE` → o diagnóstico está certo e a
  retomada automática foi recusada; me manda a linha inteira.

Se der certo, o teste de microfone volta a ser o que sempre deveria ter sido:
um teste de microfone.
