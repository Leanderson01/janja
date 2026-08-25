---
phase: 10-versao-web
plan: 09
type: execute
wave: 6
depends_on: ["10-07", "10-08"]
files_modified:
  - .planning/CHECKPOINT-WEB.md
  - .planning/REQUIREMENTS.md
autonomous: false

must_haves:
  truths:
    - "Existe um veredito escrito sobre o eco na web, com a leitura de `restrictOwnAudio` que separa os três resultados possíveis — e esse veredito informa o que fazer com a Fase 8.6"
    - "Duas pessoas se ouvem pelo navegador, e uma delas compartilha tela com som"
    - "O roteiro de texto (servidores, canais, chat, amigos, DMs) foi percorrido inteiro pelo navegador"
    - "O comportamento de dois clientes da mesma pessoa foi observado, e o que acontece com a lista de participantes está registrado"
    - "O app DESKTOP instalado foi aberto na mesma sessão e continua funcionando: login, voz e configurações de áudio"
  artifacts:
    - path: ".planning/CHECKPOINT-WEB.md"
      provides: "roteiro operacional completo da fase, com o experimento do eco em primeiro lugar"
      min_lines: 200
  key_links: []
---

<objective>
Responder, com máquinas e pessoas de verdade, as perguntas que nenhum agente
consegue responder — e uma delas vale sozinha uma fase inteira.

Purpose: **a web dá acesso a um botão que o desktop nunca teve.** Do lado do
Electron, a concessão de áudio é feita pelo processo main e o tipo publicado
(`node_modules/electron/electron.d.ts:23716-23731`) mostra que `Streams.audio`
só aceita `'loopback'`, `'loopbackWithMute'` ou um `WebFrameMain` — não existe
"áudio do sistema menos o meu documento". A fonte já está fixada pela concessão
antes de qualquer constraint ser avaliada; `'loopback'` é o dispositivo
inteiro, por definição. No navegador não: `restrictOwnAudio` é uma constraint
de áudio de verdade, shipped no Chrome 141 (Windows e Mac), e o
`livekit-client@2.22.0` instalado já a expõe.

Isso torna possível um experimento barato que o desktop sozinho não consegue
produzir, e cujo resultado muda o que se acredita sobre o eco de 2026-08-20 —
e portanto sobre a Fase 8.6.

Output: um veredito por item, escrito sem suavizar, e uma conclusão explícita
sobre qual dos três cenários do eco é o verdadeiro.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-versao-web/10-RESEARCH.md
@.planning/phases/10-versao-web/10-04-SUMMARY.md
@.planning/phases/10-versao-web/10-05-SUMMARY.md
@.planning/phases/10-versao-web/10-06-SUMMARY.md
@.planning/phases/10-versao-web/10-07-SUMMARY.md
@.planning/phases/10-versao-web/10-08-SUMMARY.md
@.planning/CHECKPOINT-WEB.md
@.planning/CHECKPOINT-WINDOWS.md

# A nota histórica do desktop que este checkpoint pode confirmar ou derrubar
@src/renderer/src/platform/electron/screenshare.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: Escrever o roteiro e registrar os requisitos de paridade</name>
  <files>.planning/CHECKPOINT-WEB.md, .planning/REQUIREMENTS.md</files>
  <action>
    Acrescentar a `.planning/CHECKPOINT-WEB.md` (que já tem os blocos A-D de
    configuração, do Plano 10-04) uma **Parte 2 — verificação**, agrupada por
    **quantas pessoas cada bloco exige**, que é o recurso escasso — mesmo
    critério de organização de `.planning/CHECKPOINT-WINDOWS.md`:

    - **Sessão W0 (sozinho, ~5 min):** a versão do Chrome e a leitura de
      `restrictOwnAudio`. É o primeiro item de todos: se o Chrome for < 141, a
      base de comparação do experimento está errada e o resto do bloco de eco
      precisa ser refeito depois.
    - **Sessão W1 (sozinho, ~20 min):** regressão de texto pelo navegador,
      largura estreita, avisos de paridade, F5 com call ativa (autoplay), e o
      teste dos dois clientes da mesma pessoa.
    - **Sessão W2 (2 pessoas, ~15 min):** voz na web ponta a ponta e
      compartilhamento com som.
    - **Sessão W3 (3 pessoas, ~15 min):** **o experimento do eco.**
    - **Sessão W4 (sozinho, 5 min):** o desktop instalado continua inteiro.

    Cada item com caixa de marcar, o que observar, e — onde couber — o que a
    falha significa. Copiar do SUMMARY do Plano 10-06 a linha de log exata que
    o console imprime, para o roteiro poder pedir "cole esta linha".

    Em `.planning/REQUIREMENTS.md`, registrar os requisitos que esta fase
    introduz, no mesmo formato das seções existentes, todos como **pendentes**
    (só o checkpoint pode marcá-los):
    - **WEB-01**: Quem não quer instalar nada usa o Hydra pelo navegador, contra
      o mesmo backend.
    - **WEB-02**: A sessão do navegador persiste entre recargas e fechamentos
      de aba.
    - **WEB-03**: Voz funciona no navegador, incluindo o destravamento de
      autoplay.
    - **WEB-04**: Compartilhamento de tela com som funciona no navegador, e o
      app diz quando não vai ter som.
    - **WEB-05**: **Paridade declarada** — a interface diz o que a web não faz,
      a partir de uma única fonte de verdade.
    Acrescentar as linhas correspondentes à tabela de rastreio, com "Fase 10" e
    "Pendente".
    **Não marcar nada como verificado neste passo** — a Task 2 e a Task 3 é que
    produzem o veredito.
  </action>
  <verify>`.planning/CHECKPOINT-WEB.md` tem as cinco sessões W0-W4 com itens numerados e caixas; `grep -c "WEB-0" .planning/REQUIREMENTS.md` >= 10 (definições + tabela de rastreio); nenhum `[x]` novo.</verify>
  <done>O roteiro existe, ordenado por quanta gente cada bloco exige, e os cinco requisitos da fase estão registrados como pendentes.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    A instrumentação que transforma "achei que teve eco" em dado: toda
    transmissão de tela pela web lê de volta o que o Chrome concedeu
    (`displaySurface` da faixa de vídeo, `restrictOwnAudio` da faixa de áudio)
    e imprime uma linha no console, além de avisar a pessoa nos dois casos em
    que ela precisa saber.

    As constraints pedidas na web são `audio: { restrictOwnAudio: true }`,
    `systemAudio: 'include'`, `selfBrowserSurface: 'exclude'`,
    `surfaceSwitching: 'include'` — e a faixa de áudio, quando existe, é
    publicada automaticamente pelo LiveKit como `ScreenShareAudio`. **Nenhuma
    ponte PCM, nenhum `AudioWorklet`, nenhum IPC de 100 msg/s**: na web, o
    caminho que custa 140 linhas no desktop simplesmente não existe.
  </what-built>
  <how-to-verify>
    ════════════════════════════════════════════════════════════
    **PASSO 1 — A VERSÃO DO CHROME. Faça este primeiro; 1 minuto.**
    ════════════════════════════════════════════════════════════
    Em `chrome://version`, anotar a versão. **Precisa ser >= 141**
    (`restrictOwnAudio` foi shipped no Chrome 141, Windows e Mac; Linux e
    ChromeOS não fornecem o necessário). Se for menor: atualizar antes de
    seguir. Sem isso, o resultado do passo 3 é ininterpretável — e essa é
    justamente uma das três saídas possíveis, então é melhor eliminá-la agora.

    ════════════════════════════════════════════════════════════
    **PASSO 2 — A LEITURA, SOZINHO. 3 minutos.**
    ════════════════════════════════════════════════════════════
    Na URL da web, entrar num canal de voz sozinho e compartilhar, uma vez
    cada, com o DevTools aberto:
    a) uma **aba** (marcando "compartilhar áudio da aba");
    b) uma **janela**;
    c) a **tela inteira** (marcando "compartilhar áudio do sistema").
    Para cada um, **colar a linha `[screenshare]` do console**. O que se espera:
    - aba: faixa de áudio presente;
    - janela: **sem** faixa de áudio + o aviso na tela dizendo que janela não
      leva som (é limitação do Chrome no Windows, não do Hydra);
    - tela inteira: faixa de áudio presente e `restrictOwnAudio` **true**.
    Se em (c) o `restrictOwnAudio` vier `false` ou ausente, anotar — muda a
    leitura do passo 3.

    ════════════════════════════════════════════════════════════
    **PASSO 3 — O EXPERIMENTO DO ECO. 3 MÁQUINAS, 3 PESSOAS, ~15 min.**
    ════════════════════════════════════════════════════════════
    **Três, não duas.** Com duas pessoas o eco pode simplesmente não ser
    audível — foi o que aconteceu na Fase 8 e é o motivo de o defeito só ter
    aparecido com quatro pessoas numa call em 2026-08-20.

    Montagem: os três entram no mesmo canal de voz **pela web**. Um compartilha
    a **tela inteira com áudio do sistema** e põe música tocando. **Uma terceira
    pessoa fala continuamente** enquanto isso. Quem compartilha presta atenção
    em uma coisa só: **ele ouve a própria voz de volta? Os outros ouvem a si
    mesmos?**

    Registrar o resultado como UM dos três abaixo, e mais nada:

    | Resultado observado | O que significa |
    |---|---|
    | **Sem eco**, e `getSettings().restrictOwnAudio === true` | O defeito era do caminho de CONCESSÃO do Electron, não do loopback do Windows. A Fase 8.6 (excluir a árvore de processos) continua sendo a resposta certa **para o desktop**, e a web fica mais simples que o desktop. |
    | **Com eco**, mesmo com a flag aceita | O problema é do próprio loopback do Windows. A Fase 8.6 é o único caminho nos dois alvos, e a web herda a limitação: **só compartilhar aba tem áudio limpo.** A interface precisa passar a dizer isso. |
    | **A flag não aparece** em `getSettings()` | O Chrome é < 141 (voltar ao passo 1) ou o navegador não a reporta. A comparação está inválida e o teste precisa ser refeito. |

    ════════════════════════════════════════════════════════════
    **PASSO 4 — a alternativa estrutural, se der eco. 2 minutos.**
    ════════════════════════════════════════════════════════════
    Só se o passo 3 der eco: repetir compartilhando uma **aba** (com música
    tocando nela). Compartilhar aba é **estruturalmente sem eco** — o Chrome
    captura o áudio daquela aba, não do dispositivo. Se aba também der eco,
    é um achado grande e inesperado, e precisa do log inteiro.
  </how-to-verify>
  <resume-signal>
    Cole as três linhas de console do passo 2, marque qual dos três resultados
    do passo 3 aconteceu, e escreva em uma frase o que isso significa para a
    Fase 8.6. Depois digite "aprovado" ou descreva o que travou.
  </resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    A versão web completa: chat, servidores, canais, amigos, DMs, voz,
    compartilhamento de tela, avisos de paridade e o aviso de "você já está em
    voz em outro dispositivo". O desktop não teve nenhum comportamento
    removido, e o backend (Convex, LiveKit, WorkOS) é exatamente o mesmo dos
    dois lados.
  </what-built>
  <how-to-verify>
    ────────────────────────────────────────────────
    **BLOCO A — sozinho, ~20 min (Sessão W1 do roteiro)**
    ────────────────────────────────────────────────
    1. **Regressão de texto pelo navegador**: criar/entrar num servidor, criar
       canal, mandar mensagem, mandar anexo, mandar link (a prévia aparece),
       rolar o histórico, ver as não-lidas mudarem, indicador de digitando,
       lista de amigos, abrir uma DM. É o roteiro que a Fase 8.5 nunca teve
       verificado por olho humano em NENHUM alvo — e agora ele custa um
       navegador aberto.
    2. **Autoplay (o defeito que a web expôs)**: entrar num canal de voz com
       mais alguém, **apertar F5**. Ao voltar, o aviso "clique para ouvir" deve
       aparecer se o navegador bloqueou o áudio — e clicar nele deve fazer a
       voz voltar. Se não houver aviso e também não houver som, é o pior caso e
       precisa ser reportado com o console.
    3. **Largura**: estreitar a janela até ~700px. O app deve dizer para abrir
       num navegador de computador, em vez de renderizar um layout quebrado.
    4. **Paridade declarada**: encontrar, na interface, as quatro frases sobre
       o que a web não faz. **Elas estão num lugar que alguém acharia?** Se
       você precisou procurar, o lugar está errado — é isso que este item mede.
    5. **Dois clientes da mesma pessoa** (~10 min, e é o item que mais
       provavelmente acha bug): abrir o app DESKTOP instalado e entrar num
       canal de voz. Depois, na web, clicar no MESMO canal.
       - O aviso "Você já está num canal de voz em outro dispositivo" aparece?
       - Cancelar: nada acontece?
       - Confirmar: o desktop é desconectado e mostra a mensagem de identidade
         duplicada?
       - **E o item que interessa mais:** depois disso, **você continua
         aparecendo na lista de participantes para os outros?** Se sumir da
         lista enquanto continua ouvindo e falando, isto é o defeito conhecido
         do webhook de reconciliação (`reconcileParticipantLeft` apaga a linha
         de `voiceStates` do par canal/usuário). **Anotar exatamente o que
         aconteceu** — é o dado que decide se vale mudar o produto para uma
         linha de `voiceStates` por sessão numa fase futura.
       - Repetir na ordem inversa (web primeiro, desktop depois).

    ────────────────────────────────────────────────
    **BLOCO B — 2 pessoas, ~15 min (Sessão W2)**
    ────────────────────────────────────────────────
    6. Os dois entram num canal de voz **pelo navegador** e se ouvem.
    7. Mute, ensurdecer, indicador de fala, volume por participante.
    8. **Push-to-talk na web**: escolher o modo PTT, segurar CtrlRight, falar.
       Depois: segurar a tecla e **dar Alt+Tab para outra janela**. O microfone
       precisa FECHAR. (Se não fechar, é o defeito de "microfone aberto para
       sempre" — reportar imediatamente.)
    9. Escolher microfone e saída de áudio no popover. Se o seletor de saída
       não aparecer, é esperado apenas em navegador sem `setSinkId`; no Chrome
       ele tem que estar lá.
    10. Um compartilha a tela com som; o outro ouve e vê.

    ────────────────────────────────────────────────
    **BLOCO C — sozinho, 5 min (Sessão W4). NÃO PULE.**
    ────────────────────────────────────────────────
    11. Abrir o app **desktop instalado** (o `.exe`) e verificar, nesta ordem:
        login funciona; entrar num canal de voz e ouvir alguém; abrir o popover
        de configurações de voz e conferir que **os nomes dos dispositivos
        continuam aparecendo** (o Plano 10-05 mudou como a lista é carregada);
        compartilhar tela com áudio de sistema e confirmar que o caminho da
        Fase 8.6 continua funcionando como antes desta fase.
    12. Confirmar que **nada** do desktop pede configuração nova: mesma
        `.env.local`, mesmo instalador, mesmo deployment do Convex.

    **Esta fase inteira não mudou uma linha em `convex/`.** Se qualquer item do
    bloco C falhar, é regressão introduzida pela Fase 10 e precisa ser tratada
    antes de a fase fechar — o app instalado é o que o grupo usa; a web é
    adição.
  </how-to-verify>
  <resume-signal>
    Escreva o veredito de cada item (1 a 12) como "passou" ou o que aconteceu,
    sem suavizar — em especial o item 5, sobre sumir da lista de participantes.
    Depois digite "aprovado" ou descreva o que travou.
  </resume-signal>
</task>

</tasks>

<verification>
**O que este plano prova, e que nada antes dele podia provar:**
- Se existe eco no caminho da web, e o que isso diz sobre a causa do eco do
  desktop (a informação que a Fase 8.6 não consegue produzir sozinha).
- Se duas pessoas se ouvem pelo navegador.
- O que realmente acontece quando a mesma pessoa entra por dois clientes.
- Se a paridade declarada está num lugar que alguém encontra.

**O que continua fora de alcance mesmo depois deste plano:**
- **VOICE-02: dez pessoas por 30+ minutos.** Continua sendo o critério de
  sucesso do projeto e não é simulável — nem pela web, nem pelo desktop.
- Os itens de `.planning/CHECKPOINT-WINDOWS.md` que dizem respeito ao
  instalador, ao áudio por processo e ao push-to-talk global: são do desktop, e
  esta fase não os toca nem os substitui.

**Prova de que o desktop não regrediu:** o Bloco C, e ele é bloqueante. Some-se
a isso o invariante estrutural da fase, que vale a pena repetir no veredito:
`convex/` com diff vazio, `build:win` e seus quatro verificadores intocados, e
o caminho Electron da camada de plataforma sendo movimento de código, não
lógica nova.
</verification>

<success_criteria>
- Veredito escrito para os passos 1-4 do experimento do eco, com as linhas de
  console coladas e UM dos três resultados escolhido.
- Veredito escrito para os itens 1-12 do roteiro de regressão.
- Frase explícita sobre o que o resultado do eco significa para a Fase 8.6.
- WEB-01..WEB-05 marcados como verificados ou com o motivo de não estarem.
- Bloco C inteiro passando — ou, se não passar, a regressão registrada como
  bloqueador antes de a fase fechar.
</success_criteria>

<output>
Ao terminar, criar `.planning/phases/10-versao-web/10-09-SUMMARY.md` e
atualizar `.planning/CHECKPOINT-WEB.md` marcando o que foi feito. Se o
resultado do eco for "com eco mesmo com a flag aceita", abrir um todo em
`.planning/todos/pending/` para o ajuste de interface que passa a ser
necessário na web ("só compartilhar aba tem áudio limpo") — a informação não
pode morrer no SUMMARY.
</output>
