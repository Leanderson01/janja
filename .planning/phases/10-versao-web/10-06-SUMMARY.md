---
phase: 10-versao-web
plan: 06
subsystem: voz-e-compartilhamento
tags: [restrictOwnAudio, getDisplayMedia, getSettings, eco, screenshare-audio, displaySurface, chrome-141, jsdom, veredito]

requires:
  - phase: 10-versao-web/10-02
    provides: "as constraints do alvo web já corretas (`restrictOwnAudio` DENTRO de `audio`, `systemAudio: 'include'`, `selfBrowserSurface: 'exclude'`) e o `startAudio` stub com dono declarado"
  - phase: 08-compartilhamento-de-tela/08-FIX-eco-audio-sistema
    provides: "a lição que este plano aplica inteira: `getSupportedConstraints()` dizer `true` não é a constraint ter sido aplicada — só `getSettings()` da track publicada responde isso"
  - phase: 08.6-audio-por-processo
    provides: "o motivo estrutural de a mesma flag NÃO servir no Electron: lá quem concede a fonte é o processo main, e `Streams.audio` só aceita `'loopback' | 'loopbackWithMute' | WebFrameMain`"
provides:
  - "`describeWebScreenShareAudio`: cinco vereditos nomeados, função pura, 8 testes sem navegador"
  - "`startAudio` da web lendo de volta `getSettings()` das DUAS faixas (vídeo e áudio) e imprimindo UMA linha `VEREDITO` por compartilhamento"
  - "Aviso na tela nos dois casos em que a pessoa precisa agir: janela (sempre muda no Chrome/Windows) e filtro de eco recusado"
  - "A instrumentação que torna o experimento do eco do Plano 10-09 INTERPRETÁVEL — inclusive a armadilha de fazer o teste compartilhando uma ABA"
affects: [10-09 checkpoint final de eco e regressao, 08.6 audio por processo no desktop, 10-07 paridade declarada]

tech-stack:
  added: []
  patterns:
    - "PEDIR não é OBTER: toda constraint de mídia best-effort é lida de volta em `getSettings()` e o resultado vira log, não fé"
    - "Veredito como função pura + casca de I/O fina: as cinco frases que a pessoa lê são provadas em teste, sem navegador, sem DOM e sem LiveKit"
    - "Degradação que DIZ: falhar ao LER `getSettings()` avisa no console em vez de virar `{}` silencioso — senão 'não consegui ler' se disfarçaria de 'este navegador não suporta'"
    - "Tipo local nomeado em vez de `any` para propriedade nova de DOM: `any` apagaria junto o erro de digitação, que apareceria exatamente como 'navegador sem suporte'"

key-files:
  created:
    - src/renderer/src/lib/web-screenshare-audio.ts
    - src/renderer/src/lib/web-screenshare-audio.test.ts
    - src/renderer/src/platform/web/screenshare.test.tsx
  modified:
    - src/renderer/src/platform/web/screenshare.tsx

key-decisions:
  - "Os cinco `kind` do plano ficaram exatamente como especificados; a distinção 'a pessoa escolheu ABA' entrou como uma FRASE do log (a nota da superfície), não como um sexto veredito — ela é ortogonal aos cinco e vale para os três casos com áudio"
  - "A existência da PUBLICAÇÃO de `ScreenShareAudio` é o que responde `hasAudioTrack`, não o resultado de `getSettings()`: se a leitura falhar, continua sendo verdade que há áudio no ar"
  - "`toast.warning` só quando `message !== null`. No caso `audio-protected` ninguém é interrompido por uma boa notícia — a prova fica no console"
  - "8 testes na função pura em vez dos 6 que o `<verify>` pedia: os 2 extras são o caso de ABA (o que impede o experimento do 10-09 de ser lido errado) e um cruzado provando prefixo + os três valores de entrada nos cinco vereditos"

patterns-established:
  - "Uma linha por compartilhamento, com prefixo fixo e greppável (`[screenshare-web] VEREDITO`), carregando SEMPRE os três valores de entrada — para o roteiro do checkpoint poder dizer 'cole esta linha' em vez de 'descreva o que ouviu'"

duration: 25min
completed: 2026-08-25
---

# Fase 10 Plano 06: Áudio do compartilhamento na web — Summary

**O alvo web parou de acreditar no que pediu: toda transmissão agora lê de volta `getSettings()` das duas faixas e imprime UMA linha de VEREDITO que distingue "o Chrome aplicou o filtro de eco", "o Chrome recusou", "este Chrome nem conhece a flag", "veio sem som porque é janela" e "veio sem som porque a caixinha não foi marcada" — os cinco casos que o relato de quem estava na call não consegue separar.**

## Performance

- **Duração:** ~25 min
- **Tarefas:** 2/2
- **Commits:** 2 de tarefa + 1 de metadados

## Commits

| Hash | O quê |
|---|---|
| `0a25574` | O veredito do áudio de compartilhamento na web, como função pura |
| `eaa119e` | A leitura de volta do que o Chrome concedeu no compartilhamento web |

## Por que este plano saiu da fila

O Leo reproduziu o eco **na versão web**, com duas pessoas: uma compartilha a
tela com áudio, a outra fala e **se ouve de volta**. Só quem fala se ouve; quem
transmite, não.

Essa assimetria não é um detalhe — ela é a assinatura e ela é a dificuldade
operacional deste bug:

- **Quem fala se ouve** porque a máquina de quem TRANSMITE está tocando a voz
  dela pelos alto-falantes, capturando isso no áudio de sistema e devolvendo ao
  canal como `ScreenShareAudio`.
- **Quem transmite não ouve** porque o LiveKit não reproduz localmente as
  faixas que você mesmo publicou.

**Consequência para o teste, e ela é contraintuitiva: o log do veredito nasce
no console de quem COMPARTILHA — que é justamente a pessoa que não escuta nada
de errado.** Quem percebe o defeito não tem o dado; quem tem o dado não percebe
o defeito. Um roteiro que peça "abra o console" para a pessoa errada volta
vazio.

## A linha exata que o Plano 10-09 vai procurar

**Onde:** DevTools do Chrome (F12), aba **Console**, na máquina de **quem
compartilhou a tela**. **O que procurar:** a palavra `VEREDITO`. É **uma**
linha por compartilhamento iniciado.

As cinco, copiadas literalmente da saída real da função:

```
[screenshare-web] VEREDITO no-audio-window: a captura veio SEM faixa de áudio, e a superfície escolhida foi JANELA. Não é defeito do app nem escolha de quem compartilhou: o Chrome no Windows não captura áudio de janela (issue 40947205 do Chromium). A pergunta sobre restrictOwnAudio não se coloca — não há áudio a filtrar. Entradas: hasAudioTrack=false, displaySurface=window, restrictOwnAudio=undefined.
```

```
[screenshare-web] VEREDITO no-audio-declined: a captura veio SEM faixa de áudio numa superfície que SUPORTA áudio. A caixinha existiu no diálogo (é o que `systemAudio: 'include'` compra) e não foi marcada. restrictOwnAudio não se aplica: não há áudio capturado a filtrar. Entradas: hasAudioTrack=false, displaySurface=monitor, restrictOwnAudio=undefined.
```

```
[screenshare-web] VEREDITO audio-protected: a faixa de áudio foi publicada e o Chrome CONFIRMOU restrictOwnAudio=true em getSettings() — o pedido de excluir da captura o áudio que ESTA aba está tocando (ou seja, a voz dos outros participantes) foi aceito E aplicado. A superfície é a TELA INTEIRA: este é o caso que interessa ao experimento do eco, porque o áudio capturado é o do sistema INTEIRO — inclusive a voz dos outros participantes, que esta própria aba está tocando. Entradas: hasAudioTrack=true, displaySurface=monitor, restrictOwnAudio=true.
```

```
[screenshare-web] VEREDITO audio-unprotected: a faixa de áudio foi publicada, o pedido de restrictOwnAudio FOI FEITO e o Chrome respondeu getSettings().restrictOwnAudio=FALSE — pedido reconhecido e NÃO aplicado. A captura inclui tudo que o sistema está tocando, inclusive a voz dos outros participantes que esta aba reproduz: ECO ESPERADO. A superfície é a TELA INTEIRA: [...] Entradas: hasAudioTrack=true, displaySurface=monitor, restrictOwnAudio=false.
```

```
[screenshare-web] VEREDITO audio-unknown-support: a faixa de áudio foi publicada, mas este navegador não reporta `restrictOwnAudio` em getSettings() (veio undefined); a versão do Chrome precisa ser >= 141, em Windows ou Mac — confira em chrome://version. Não dá para saber se o filtro foi aplicado: trate como NÃO aplicado. Para o experimento do eco do Plano 10-09, este resultado INVALIDA a base de comparação e o teste precisa ser refeito num Chrome mais novo. A superfície é a TELA INTEIRA: [...] Entradas: hasAudioTrack=true, displaySurface=monitor, restrictOwnAudio=undefined.
```

O sufixo `Entradas: hasAudioTrack=… , displaySurface=… , restrictOwnAudio=…`
está nos **cinco**, sempre no fim e sempre no mesmo formato — é ele que faz a
linha valer sozinha, colada num chat, sem quem colou precisar saber o que
significa.

## A frase que impede o experimento de ser lido errado

Nos três vereditos com áudio, o log inclui uma **nota da superfície**. Ela
existe por um motivo caro:

> `ATENÇÃO PARA O EXPERIMENTO DO ECO: a superfície é uma ABA, que já é livre de eco POR CONSTRUÇÃO (o Chrome captura o áudio daquela aba, não do dispositivo de saída). Ausência de eco aqui NÃO prova nada sobre restrictOwnAudio — para testar a flag, compartilhe a TELA INTEIRA.`

Sem ela, um teste feito compartilhando **aba** voltaria como "não teve eco,
`restrictOwnAudio` funciona" — e a Fase 8.6 do desktop seria julgada por um
experimento que não testou nada. Aba não tem eco **com ou sem a flag**.

Na tela inteira a nota diz o contrário, por extenso: é este o caso que
interessa, porque o áudio capturado é o do sistema inteiro.

## Os cinco vereditos, e o que cada um decide

| `kind` | Quando | A pessoa vê | O que decide |
|---|---|---|---|
| `no-audio-window` | sem áudio + `displaySurface: 'window'` | **sim** — "vai SEM SOM, janela nunca leva áudio" | nada sobre eco: não há áudio |
| `no-audio-declined` | sem áudio, outra superfície | sim — "a caixinha não foi marcada" | nada sobre eco: não há áudio |
| `audio-protected` | áudio + `restrictOwnAudio === true` | **nada** (`message: null`) | a constraint foi **aplicada**; se AINDA houver eco em tela inteira, o filtro é insuficiente contra o loopback |
| `audio-unprotected` | áudio + `restrictOwnAudio === false` | sim — "pode ter eco; use uma ABA" | reconhecida e **negada** |
| `audio-unknown-support` | áudio + `restrictOwnAudio === undefined` | sim — "atualize o Chrome (141+) ou use ABA" | **a base de comparação está errada**: refazer num Chrome ≥ 141 |

A ordem de avaliação é a do plano, e as duas primeiras regras não podem trocar
de lugar: `no-audio-window` é um caso particular de `no-audio-declined`, e
inverter faria "compartilhei a tela inteira e esqueci a caixinha" ser explicado
como "janela é muda". Há um teste dedicado a isso (`monitor` sem áudio **não**
cai na regra 1).

## O roteiro do teste com duas pessoas

Ele decide **duas** coisas ao mesmo tempo: se a web está resolvida, e — pela
§5.4 da pesquisa — qual é a causa do eco no **desktop**, que o desktop sozinho
não consegue produzir.

### Passo 0 — 1 minuto, sozinho, sem instalar nada, ANTES de chamar alguém

```bash
cd /home/leo/workspace/janja && npm run dev:web
```

Abrir **`http://localhost:5173`** no Chrome do Windows (só `localhost` é secure
context; o IP do WSL2 não serve). Entrar num canal de voz, **compartilhar a
TELA INTEIRA marcando a caixinha de áudio**, abrir o Console (F12) e ler a
linha `VEREDITO`.

**Este passo sozinho já responde a pergunta em aberto nº 1 da pesquisa** e pode
economizar a reunião inteira:

- Se sair `audio-unknown-support` → **pare**. O Chrome é < 141 (confirmar em
  `chrome://version`). O eco que o Leo reproduziu está explicado sem precisar de
  ninguém: a flag nunca existiu nessa máquina. Atualizar o Chrome e repetir.
- Se sair `audio-unprotected` → **pare**. O Chrome reconheceu e recusou. O eco
  está explicado, e a saída de hoje é compartilhar **aba**.
- Se sair `audio-protected` → o filtro foi aplicado, e aí sim é preciso a
  segunda pessoa para saber se ele **bastou**.
- Se sair `no-audio-*` → a caixinha não foi marcada (ou foi janela). Refazer o
  passo 0; não é resultado.

### Passo 1 — o experimento, duas pessoas, ~10 minutos

Papéis (e eles importam, porque não são simétricos):

- **A = quem COMPARTILHA.** É a máquina que produz o dado. Console aberto.
- **B = quem FALA.** É a única que consegue ouvir o eco.

1. A e B entram no mesmo canal de voz pela web.
2. **A** compartilha a **TELA INTEIRA** com a caixinha de áudio marcada.
3. A deixa uma música tocando (para haver áudio de sistema legítimo — sem isso o
   teste não distingue "sem eco" de "sem áudio nenhum").
4. **B fala** por ~15 segundos e responde uma pergunta só: **"você se ouviu de
   volta?"**
5. **A** copia a linha `VEREDITO` do console e manda junto com a resposta de B.
6. Repetir o passo 4 com **A** compartilhando uma **ABA** com som (ex.: uma aba
   do YouTube), como grupo de controle.

### O que cada combinação significa — inclusive para o desktop

| Linha de A | B se ouviu? | Conclusão |
|---|---|---|
| `audio-protected` (monitor) | **não** | A flag **funciona**. O eco do desktop era do caminho de concessão do Electron (`Streams.audio` só aceita `'loopback'`, sem "sistema menos meu documento"). A Fase 8.6 continua certa **para o desktop**, e a web fica mais simples que ele. |
| `audio-protected` (monitor) | **sim** | A flag é aplicada e **insuficiente**: o problema é do loopback do Windows. Excluir por árvore de processos (Fase 8.6) é o único caminho nos **dois** alvos, e a web herda "só aba tem áudio limpo". |
| `audio-unprotected` | sim (esperado) | O Chrome recusou o pedido. Não diz nada sobre o desktop; diz que a mitigação da web hoje é **aba**. |
| `audio-unknown-support` | qualquer | **Não conta.** Chrome < 141: a base de comparação está errada, o teste precisa ser refeito. |
| qualquer, com **ABA** | não | **Esperado e não prova nada** — é o grupo de controle. Aba é livre de eco por construção. |

## Desvios do plano

**Nenhum desvio de comportamento.** Duas diferenças em relação à letra do
`<verify>`, ambas para mais:

1. **8 testes na função pura, não 6.** Os dois extras são o caso `audio-protected`
   **com ABA** (o que impede o experimento de ser interpretado errado) e um teste
   cruzado que percorre os cinco vereditos afirmando prefixo, palavra `VEREDITO`
   e os três valores de entrada em cada um. O plano pedia "um caso por regra +
   o negativo do `monitor`"; esses seis estão lá.
2. **`npm run build:web` não pôde ser rodado inteiro** — não por causa deste
   plano. Ver a seção de verificação.

## Verificação — saída real

| Comando | Resultado |
|---|---|
| `npx vitest run src/renderer/src/lib/web-screenshare-audio.test.ts` | **8 testes passando** |
| `npx vitest run src/renderer/src/platform/web/screenshare.test.tsx` | **5 testes passando** |
| `npx vitest run` (suíte inteira) | **46 arquivos, 711 testes passando** |
| `npx eslint` nos 4 arquivos | **exit 0** |
| `npx prettier --check` nos 4 arquivos | `All matched files use Prettier code style!` |
| `npx vite build --config vite.config.web.ts` | **✓ built in 3.73s** |
| `npm run verify:web-bundle -- --strict-bridges` | **exit 0** — as 4 afirmações, em modo estrito |
| `git diff --stat src/renderer/src/platform/electron/screenshare.tsx` | **vazio** |
| `git diff --stat src/renderer/src/state/voice-context.tsx` | **vazio** |

**A contagem de testes, separando o que é meu:** a linha de base da fase era
41 arquivos / 664 testes. A suíte terminou em **46 / 711**. Deste plano vêm
**+2 arquivos e +13 testes** (`lib/web-screenshare-audio.test.ts` com 8,
`platform/web/screenshare.test.tsx` com 5). Os outros **+3 arquivos e +34
testes** são de dois executores que rodaram em paralelo nesta mesma árvore
(`lib/vad.test.ts`, `features/auth/AuthGate.test.tsx`,
`components/boundary/RootErrorBoundary.test.tsx`). A conta fecha:
41+2+3 = 46 e 664+13+34 = 711.

**O typecheck completo terminou vermelho — e nenhum dos erros é deste plano.**
No fim da execução, `npm run typecheck` e `npm run typecheck:web-target`
apontavam 5 erros, todos em arquivos que os executores paralelos estavam
escrevendo naquele instante (`lib/vad.ts`, `lib/vad.test.ts`,
`components/boundary/RootErrorBoundary.test.tsx` — criados/alterados segundos
antes, ainda não commitados por eles).

A atribuição não é opinião, é uma execução: `tsconfig.web-target.json` com
**apenas esses quatro arquivos alheios excluídos** compila **exit 0** —
incluindo os quatro arquivos deste plano, no `include` inteiro do projeto, com
`@platform` resolvendo para a web.

```
$ npx tsc --noEmit -p tsconfig.10-06-attrib.json --composite false
ATTRIB-EXIT=0
```

(O `tsconfig` temporário foi removido no mesmo comando.) É pela mesma razão que
`npm run build:web` não pôde rodar inteiro: seus dois primeiros passos são
justamente esses typechecks. O terceiro passo — o que constrói o artefato — foi
rodado direto e passou, e o `verify:web-bundle --strict-bridges` sobre o
artefato resultante passou também.

**No artefato compilado (`dist-web/assets/index-qJKMJsFN.js`):** as **5**
ocorrências de `VEREDITO` estão lá, minificação incluída. Literal de string
sobrevive ao minificador; nome de função, não.

## A prova de que o desktop não foi tocado

Este plano não alterou nenhum arquivo do caminho Electron. Os dois `git diff
--stat` exigidos pelo `<verify>` — `platform/electron/screenshare.tsx` e
`state/voice-context.tsx` — voltaram **vazios**. `voice-context.tsx` continua
chamando `screenShare.startAudio(room)` no mesmo lugar de sempre; o que mudou
foi só o corpo do lado web.

A NOTA HISTÓRICA do `restrictOwnAudio` no arquivo do Electron continua intacta,
e continua correta: lá a flag não tem onde agir, porque a fonte já foi fixada
pela concessão do processo main antes de qualquer constraint ser avaliada.

## Estado para o próximo plano

- **O Plano 10-09 tem a instrumentação de que precisa.** O roteiro acima pode
  ser colado nele, incluindo o passo 0 solitário de 1 minuto, que a pesquisa
  recomendou como PRIMEIRO passo do checkpoint.
- **O que continua não sendo verificável em WSL2:** se há eco. Nenhuma leitura
  de código substitui duas pessoas numa call — e a máquina de quem compartilha
  é a única que produz o log.
- **O que este plano deliberadamente NÃO fez:** retry, republicar áudio, mexer
  nas constraints (ficaram certas no 10-02) e escolher a superfície pela pessoa
  (o Chrome não permite, e não deveria).
- **`platform/web/screenshare.tsx` não tem mais pendência com dono.** O stub que
  o 10-02 deixou com o nome deste plano escrito nele foi substituído.
