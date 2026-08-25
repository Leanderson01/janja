# Roteiro consolidado — sessão de verificação em Windows

Cinco checkpoints se acumularam porque nenhum deles é verificável em WSL2 (sem
Windows, sem microfone, sem tela, sem alto-falante). Este documento junta todos
numa ordem única, agrupados por **quantas máquinas e pessoas cada bloco exige** —
o recurso escasso aqui não é tempo, é gente disponível ao mesmo tempo.

Fonte de cada bloco (a autoridade continua sendo o plano original; aqui é o
roteiro operacional):

| Bloco | Plano de origem |
|---|---|
| Preparação | `phases/07-voz/07-08-verificacao-final-PLAN.md` (tarefa 1), `phases/09-.../09-03-...PLAN.md` (tarefa 1) |
| VAD | `quick/001-corrigir-deadlock-do-vad-microfone-mudo/001-PLAN.md` (Task 3) |
| Voz | `phases/07-voz/07-08-verificacao-final-PLAN.md` |
| Tela | `phases/08-.../08-03-checkpoint-spike-audio-PLAN.md` e `08-07-verificacao-final-PLAN.md` |
| Instalador | `phases/09-.../09-03-checkpoint-instalador-e-regressao-final-PLAN.md` |

**Regra que vale para tudo aqui** (HANDOFF.md, lição nº 1): verificar no ambiente
errado não é verificar. Nada abaixo pode ser marcado como feito por raciocínio,
build verde ou teste unitário. Só observação em Windows nativo conta.

---

## Sessão 0 — Preparação (sozinho, ~30 min)

Nada aqui precisa de outras pessoas, e tudo aqui **destrava** as sessões
seguintes. Fazer antes de convocar alguém.

### 0.1 — Push do Convex (agora OBRIGATÓRIO, não mais só um risco)

Duas coisas dependem disto, e a segunda é nova: o `convex/http.ts` passou a
importar `@livekit/protocol` (Fase 8), e a **Fase 8.5 mudou o schema** — campo
`attachments` em `messages` e a tabela `linkPreviews`. Sem o push, anexos e
prévias de link não existem no deployment e toda mensagem com link vira erro de
query, não cartão vazio.

Do WSL2 é impossível empurrar: o token daquela máquina é de outra conta e não
tem acesso ao time `leandersonnunes-alu-lmb`.

Se o push falhar, **capture a mensagem inteira** — é a única informação que não
existe em nenhum outro lugar. Confira também que `convex/_generated/` foi
regerado e que a entrada `linkPreviews` (escrita à mão) ficou idêntica.

```bash
npx convex dev --once
```

- ✅ Sobe sem erro de resolução de módulo → risco encerrado.
- ❌ Falha no bundle → a saída já está desenhada: mover a comparação de
  `track.source` para dentro de `verifyLiveKitWebhook` (`convex/voiceToken.ts`) e
  devolver booleano, em vez de importar o protocolo em `http.ts`.

### 0.2 — Webhook do LiveKit implantado

1. Conferir que `infra/livekit/livekit.yaml` tem o bloco `webhook` com a URL
   `.convex.site/livekit/webhook` real, não placeholder.
2. No Coolify, na stack do LiveKit: **Redeploy**. Nunca `docker compose down` —
   apaga o certificado do TURN (`DEPLOY-RUNBOOK.md`).
3. Entrar num canal de voz e sair fechando a janela normalmente. Nos logs do
   container (Coolify → Logs), confirmar `POST /livekit/webhook` respondido
   **200**.

Sem isso, todo teste de "usuário-fantasma" e de "apresentador caiu" testa o nada.

### 0.3 — Redirect URI da WorkOS

1. Dashboard da WorkOS → Redirects → adicionar
   `https://impressive-oyster-898.convex.site/auth/complete`. Manter
   `janja://callback` cadastrado até o fluxo novo funcionar.
2. `.env.local` da máquina de build: `VITE_CONVEX_SITE_URL=https://impressive-oyster-898.convex.site`
   (sem `/auth/complete` no fim — o código concatena).
3. `npm run dev` e um login completo: a aba do navegador deve terminar na página
   "pode fechar esta aba", não na tela interna da WorkOS/Google.

**Reportar:** "preparação ok" ou o que falhou em 0.1 / 0.2 / 0.3.

---

## Sessão 1 — Duas máquinas (~45 min)

Duas máquinas Windows, ou uma máquina + um segundo usuário real. Abrir o
**DevTools do renderer (aba Console)** nas duas antes de começar.

### 1.1 — VAD: o bug que motivou tudo isto

Este é o bloco mais importante da sessão: é o defeito que você relatou (usuário
novo entra e a voz não sai). A correção está escrita, mas **não provada**.

1. **Perfil limpo, falar sem tocar em nada** — DevTools → Application → Local
   Storage → apagar a chave `janja:voice-preferences`. Fechar e **reabrir** o app
   (não recarregar). Entrar no canal e falar: sem abrir configurações, sem tocar
   em PTT, sem sair e entrar de novo.
   Esperado: o outro **ouve**; o anel de fala acende; ao parar, apaga em ~300 ms.
   No Console: `[voice] VAD ativo sobre clone de análise da track publicada`, e
   **nenhuma** linha `[voice] VAD:` de erro.
2. **Mute manual vence o VAD** — mutar pelo botão e falar: o outro não ouve, o
   anel não acende. Desmutar: volta a ser ouvido.
3. **Regressão PTT → VAD na mesma call** — trocar para push-to-talk, segurar a
   tecla e falar (o outro ouve), soltar (para de ouvir); voltar para detecção de
   voz **sem sair da call** e falar sem tocar em mais nada: o outro **ouve**.
4. **Troca de microfone com VAD ativo** — escolher outro microfone e falar nele:
   o outro ouve. (Com um microfone só: alternar entre "Padrão" e a entrada
   nomeada do mesmo aparelho.)
5. **Medidor de nível** — em modo VAD, abrir as configurações e falar: a barra se
   mexe. Antes da correção ficava zerada, o que tornava o slider de limiar
   impossível de calibrar.
6. **Sem vazamento de microfone** — sair do canal e fechar o painel: o ícone de
   microfone em uso do Windows some (barra de tarefas, ou Configurações →
   Privacidade → Microfone → atividade recente). Repetir depois de VAD→PTT e
   depois de trocar de dispositivo.
7. **Eco** — com alto-falante ligado nas duas, conversar ~1 min: nenhum eco novo.

Se algo falhar, **copiar as linhas `[voice]` do Console** — elas dizem em que
etapa o setup do VAD parou.

**Reportar:** "aprovado" ou o passo (1-7) que falhou + o que apareceu no Console.

### 1.2 — Usuário-fantasma (VOICE-04)

1. As duas máquinas no mesmo canal, confirmando que se ouvem.
2. Numa delas, **matar o processo** pelo Gerenciador de Tarefas (`janja.exe`, ou
   `electron.exe` em dev). Não fechar pela janela — matar.
3. Na outra, cronometrar até o avatar sumir: deve ser **segundos**, não minutos,
   não "nunca".
4. Repetir desligando o Wi-Fi em vez de matar o processo. Mesmo resultado.

Depende do 0.2. Se o webhook não estiver implantado, este teste falha por
infraestrutura, não por código.

### 1.3 — Controles de voz

5. Mutar/desmutar: o outro vê o ícone aparecer e sumir.
6. Ensurdecer: o microfone é mutado junto (dois ícones simultâneos); desmutar
   enquanto ensurdecido remove o ensurdecimento também.
7. Falar e observar o anel: **não deve piscar** em pausas curtas de respiração.
8. Trocar microfone e saída pelo painel: a chamada não cai.
9. Indicador de qualidade de conexão (4 níveis) e estado ao entrar no canal.
10. VAD ↔ PTT pelo painel; em VAD, subir o limiar e confirmar que fala baixa
    deixa de ativar o microfone.
11. **PTT sem foco** — minimizar o app ou ir para outra janela e segurar a tecla
    de push-to-talk: o microfone liga. É o ponto central de VOICE-11 e o motivo
    de o 07-08 existir. Não pular.
12. Fechar e reabrir: modo e limiar persistem.
13. Sons de canal ao entrar/sair; desligar nas configurações e confirmar
    silêncio.
14. Sidebar sem estar em canal nenhum: dá para ver quem está em cada canal.

**Reportar:** "aprovado" ou os itens que falharam (1.2 A1-A4, 1.3 B5-B14).

---

## Sessão 2 — Três máquinas (~40 min)

**Três, não duas.** O eco pode não ser perceptível com só duas pessoas, e eco é o
critério de sucesso nº 2 do projeto inteiro. Confirmar antes de começar que o
Electron instalado é **>= 43.4.0** (`node_modules`, não só o pin do
`package.json`) — abaixo disso o `restrictOwnAudio` é ignorado em silêncio.

> **Mudou depois que isto foi escrito (Fase 8.6).** O áudio do compartilhamento
> não vem mais do `getDisplayMedia`, e a flag `restrictOwnAudio` não é mais usada
> por caminho nenhum — a checagem de Electron >= 43.4.0 acima perdeu o objeto. Com
> o toggle desligado (o padrão), o compartilhamento não publica faixa de áudio
> nenhuma, então **o 2.1 não tem mais como falhar**: ele virou teste de vídeo. O
> teste de eco que vale agora é o **item 1 da Parte 3**, com o toggle LIGADO. Com
> as três pessoas reunidas, faça o item 1 da Parte 3 primeiro e depois volte para
> cá.

### 2.1 — Eco (08-03 A) — o teste mais crítico da fase

1. As 3 máquinas no mesmo canal, ouvindo-se normalmente, sem compartilhar nada.
2. Uma máquina compartilha a tela.
3. Com o compartilhamento ativo, **uma das outras duas** fala continuamente por
   ~30 s.
4. A terceira (nem compartilha, nem fala) escuta: a voz deve chegar **uma única
   vez**, sem repetição, eco ou atraso vindo da track de compartilhamento.
5. Inverter os papéis e repetir — pelo menos 2 combinações de quem compartilha vs
   quem fala.

Se houver eco: anotar **exatamente** em qual combinação de máquinas, e não
suavizar no relato. A mitigação prevista está em `PITFALLS.md` Pitfall 1 (mute
local da reprodução durante a captura, ou documentar como limitação conhecida), e
a decisão de qual adotar depende do que for observado aqui.

### 2.2 — Áudio de sistema e caminho de captura (08-03 B, C, D)

6. Quem compartilha toca um áudio qualquer (YouTube, música local).
7. As outras confirmam que **ouvem esse áudio** pelo compartilhamento — não só
   vídeo mudo.
8. Parar o compartilhamento, esperar 5 s, compartilhar de novo: abre normalmente,
   sem travar carregando.
9. Repetir mais uma vez (3 tentativas na mesma sessão do app).
10. Confirmar que as outras máquinas **veem** a tela.

### 2.3 — UI completa (08-07)

Só faz sentido depois que 2.1 e 2.2 passarem.

11. Repetir o teste de eco usando o **seletor de verdade** (escolher uma tela
    específica) e com a qualidade em **"Nítida"** — o 08-03 testou só o default.
12. Abrir o seletor: miniaturas reais (não ícones genéricos) de todas as telas e
    de 2-3 janelas abertas.
13. Escolher uma **janela** específica: só o conteúdo dela aparece para os
    outros.
14. Cancelar o seletor 3 vezes seguidas pelo botão Cancelar — o botão de
    compartilhar continua funcional a cada vez.
15. Abrir e fechar clicando fora / Esc — mesmo resultado.
16. Depois dos cancelamentos, compartilhar de verdade: funciona.
17. "Fluida": arrastar uma janela na tela compartilhada e observar a fluidez nos
    outros.
18. Parar, trocar para "Nítida", compartilhar: texto pequeno legível.
19. Fechar e reabrir o app: a escolha de qualidade persiste.
20. Parar pelo botão: os outros voltam ao "Ninguém está compartilhando"
    **imediatamente, sem frame congelado**.
21. Compartilhar de novo e **matar o processo à força**. Cronometrar nas outras:
    (a) o vídeo some quase imediato, por evento do LiveKit; (b) o ícone de
    "compartilhando" some depois, pela reconciliação do webhook. Nenhum dos dois
    pode ficar preso.
22. De uma máquina **fora do canal**, confirmar que a sidebar mostra o ícone de
    quem está compartilhando.
23. Tentar compartilhar uma janela protegida (gerenciador de senhas): aparece
    retângulo preto. É esperado — limitação do Windows, não bug.
24. Console sem `[screenshare] setSharing(false) falhou` ao sair do canal
    compartilhando, e `document.querySelectorAll('video').length` voltando a zero
    depois de vários ciclos de compartilhar/parar.

**Reportar:** "aprovado" ou o item que falhou. Se o eco aparecer (2.1), reportar
isso primeiro e separado — muda a decisão de fase, não é um bug entre outros.

---

## Sessão 3 — Instalador e grupo (agendar com as 10 pessoas)

### 3.1 — Instalador numa máquina limpa (sozinho)

1. `git clone` do zero.
2. `npm install` — sem o erro `Electron uninstall` da Fase 0. É a primeira prova
   real numa clonagem limpa.
3. Preencher `.env.local` com os três valores reais **antes** do build — o
   `electron-vite` grava esses valores dentro dos arquivos compilados.
4. `npm run build:win`.
5. Rodar o instalador numa máquina limpa: poucos cliques, sem escolher pasta,
   abre sozinho, cria atalho.
6. Login completo, terminando na página de conclusão.
7. **Testar o login pelo Brave** — problema conhecido e não resolvido desde a
   Fase 2. A mudança do 09-02 pode ter corrigido como efeito colateral. Registrar
   o resultado dos dois jeitos: se resolveu, ótimo; se não, vira limitação
   documentada ("use Chrome/Edge para o login").
8. **PTT no executável instalado**, com o app sem foco. É o maior risco técnico
   não verificado da Fase 9 (`uiohook-napi` fora do asar). Se falhar, conferir se
   existe `app.asar.unpacked\node_modules\uiohook-napi\` na pasta de instalação
   antes de reportar como bug de código.

### 3.2 — Sessão real com o grupo

1. As 10 pessoas no mesmo canal.
2. Conversa normal por 30+ minutos — uso real, não silêncio artificial.
3. Áudio estável, sem quedas generalizadas. Uma pessoa específica sempre cortando
   indica rede individual, não o produto: anotar, mas não reprova a fase.
4. Cada pessoa testa mute/deafen ao menos uma vez; ao menos uma pessoa em rede
   não-doméstica (4G, trabalho) confirma que ouve e é ouvida.
5. No fim, todos saem — mistura de saída pelo botão e, para pelo menos uma
   pessoa, fechar o app direto. O canal fica vazio para quem estiver olhando.

Compartilhar tela durante essa sessão é o teste mais honesto que existe do
projeto: 10 pessoas, uma tela, áudio de sistema, e ninguém pedindo para voltar
para o Discord.

---


---

# Parte 2 — Fase 8.5 (interface)

A Fase 8.5 reescreveu a interface inteira. A maior parte é verificável **sozinho**,
o que a torna o bloco mais barato da lista — e o primeiro item é o mais barato de
todos, porque decide se vale olhar o resto.

## Sessão A — Interface, sozinho (~30 min)

### A.0 — A pergunta que abre tudo

1. O fundo do app está **quase preto**? Se estiver branco, pare: a classe de tema
   não pegou e nenhuma outra verificação visual vale. Foi exatamente esse o
   defeito que a fase corrigiu — o app rodou meses no tema claro com uma
   interface desenhada para o escuro.

### A.1 — Palco da call (o esqueleto novo)

2. Entrar num canal de voz: a área principal vira o palco, sem área de texto.
3. Clicar num canal de **texto**: o texto aparece **e a call continua** — o rodapé
   segue mostrando "Conectado a {canal}".
4. Clicar de novo no canal de voz onde você está: **volta ao palco e NÃO
   desconecta**. É a correção do que você relatou.
5. Clicar em "Conectado a {canal}" no rodapé: também volta ao palco.
6. Desconectar continua sendo o botão de telefone, e só ele.
7. Selecionar um canal de voz onde você não está: continua mostrando quem está lá.

### A.2 — Destaque, cores e foco

8. Servidor ativo no rail e canal selecionado na sidebar marcados na **mesma cor**
   (azul-violeta).
9. Pontinho verde de online; divisor "NOVAS MENSAGENS" no tom de destaque, não
   vermelho; anel verde ao falar; "Reconectando..." em amarelo.
10. **Só com Tab**, do rail até a lista de membros: o foco atravessa sem sumir e
    sem ficar preso.
11. O anel de foco é **visível** em todos eles — inclusive dentro das listas
    roláveis, que é onde ele costuma ser cortado.
12. Com foco num canal, Tab alcança o "..." e Enter abre o menu; setas navegam;
    Esc fecha e o foco **volta** para o botão. Mesma coisa na linha de membro, no
    painel do usuário e no menu de participante do palco.

### A.3 — Janela estreita

13. Encolher até o mínimo (900×600), na visão de texto **e** no palco: nada se
    sobrepõe, nada é cortado.
14. Nome de canal longo trunca com reticências em vez de empurrar os botões.
15. Botão de esconder a lista de membros, no cabeçalho e na barra do palco: a
    coluna some, a área principal ocupa o espaço, e a escolha sobrevive a fechar e
    reabrir o app.
16. Recolher a seção VOZ na sidebar, fechar e reabrir: continua recolhida.

### A.4 — Composer, anexos e prévias

17. Enter envia; Shift+Enter quebra linha.
18. Desligar o Wi-Fi e tentar enviar: aparece **toast de erro**, a mensagem não
    some em silêncio. Religar.
19. *(Opcional, 2 min)* Ativar o IME japonês do Windows, digitar uma palavra e
    apertar Enter para **confirmar a composição**: a mensagem não pode ser enviada
    nesse Enter. O segundo Enter envia.
20. Clipe → escolher imagem → ela aparece na lista antes de enviar → enviar → a
    imagem aparece embutida na conversa.
21. Tentar anexar arquivo **acima de 25 MB**: recusa antes de subir, dizendo o
    limite.
22. Anexar um PDF ou ZIP: vira cartão com nome e tamanho, e clicar abre no
    navegador.
23. Enviar anexo com o Wi-Fi caindo no meio: dá erro **e os arquivos escolhidos
    continuam lá** para tentar de novo.
24. Postar link de site conhecido: em um instante aparece cartão com título,
    descrição e imagem.
25. **O cartão aparecendo não pode fazer o histórico pular** enquanto você lê
    mensagens antigas. É o risco real da funcionalidade.
26. Postar link quebrado: nenhum cartão, nenhum erro na tela, app não trava.
27. Postar o mesmo link de novo: o cartão aparece na hora (veio do cache).
28. *(Privacidade)* DevTools → Network: **nenhuma requisição para o domínio
    linkado**, só para o Convex. É o servidor quem busca, de propósito.

**Reportar:** "sessão A ok" ou o número do item que falhou.

## Sessão B — Interface com mais gente (junto com as Sessões 1 e 2)

Estes precisam de outra pessoa e cabem nas sessões de voz e tela que você já vai
fazer.

29. **Compartilhamento no palco:** o vídeo toma a área grande e os participantes
    viram faixa embaixo. Expandir ocupa o palco inteiro; **Esc** volta.
30. "Ocultar tela" volta aos ladrilhos **sem parar o compartilhamento** do outro.
    Reexpandir traz o vídeo de volta **sem frame congelado**.
31. **O mais importante:** a outra pessoa para de compartilhar — e, numa segunda
    rodada, **fecha o app à força** — em cada um dos três layouts. O vídeo tem que
    sumir nos três, sem congelar.
32. Ir para um canal de texto durante o compartilhamento e voltar ao palco: o
    vídeo reaparece funcionando.
33. **Volume por participante:** ajustar o volume de alguém muda só a voz dele.
34. "Silenciar para mim": você para de ouvir só aquela pessoa; ela continua sendo
    ouvida pelos outros (confirmar com a terceira máquina).
35. Ensurdecer zera tudo; desativar **devolve os volumes individuais como
    estavam** — não podem ter voltado para 100%.
36. Quem entra na call depois já entra com o ajuste que você tinha feito.
37. Fechar e reabrir o app: os ajustes continuam.
38. Anexo enviado por uma conta aparece para a outra.
39. **Regressão:** enviar e receber mensagem, entrar e sair de voz, mutar,
    ensurdecer, compartilhar, abrir amigos e DM — nada quebrou. E sair da conta
    pelo menu do usuário funciona (mudou de lugar nesta fase).

**Capture 6 a 8 screenshots** — visão de texto, palco com ladrilhos, palco com
tela compartilhada, vídeo expandido, janela em 900×600, um menu aberto, um anexo,
um cartão de prévia. É a única evidência visual que vai existir no repositório.

---

---

# Parte 3 — Fase 8.6 (áudio do compartilhamento, por processo)

Roteiro de `phases/08.6-audio-por-processo/08.6-06-checkpoint-windows-PLAN.md`.

**O que mudou desde a Parte 1.** O `getDisplayMedia` desta fase é **só vídeo** —
o app não pede mais `audio: 'loopback'` em caminho nenhum, e o processo main não
concede mais em caminho nenhum. O som agora vem de uma captura WASAPI feita pelo
próprio Windows em modo EXCLUIR: *capture tudo que este computador está tocando,
MENOS o Hydra e os processos filhos dele*. Esse PCM atravessa o app até virar uma
segunda faixa publicada na call, separada do vídeo.

**A ordem aqui não é decoração.** O item 1 testa a única suposição que sustenta o
desenho inteiro. Se ele falhar, os outros 20 itens estão medindo a coisa errada.
Faça-o primeiro, mesmo que isso signifique convocar as três pessoas antes de
fazer o bloco sozinho — e, se você for fazer a Sessão 2 da Parte 1 na mesma
reunião, faça o item 1 daqui **antes** do 2.1 de lá.

Além dele, dois itens decidem se a fase entregou o que promete: o item 2 (a
promessa) e o item 3 (o preço). O item 3 é o único da lista inteira que pode
corrigir **o texto da interface** em vez do código.

**Vários defeitos desta fase falham SEM ERRO NENHUM** — mono em silêncio, worklet
recusado pela política de segurança, faixa publicada transmitindo silêncio
eterno, captura do Windows continuando ligada depois de "parar". Em cada item
está escrito onde olhar para perceber, porque nenhum deles se anuncia sozinho.

---

## Sessão C.0 — Preparação (sozinho, ~30 min)

### C.0.1 — Build e instalação (obrigatório: parte dos itens só existe no app instalado)

```bash
git pull
npm install
npm run build:win
```

O `build:win` já roda a verificação de empacotamento do áudio nativo
(`verify:native-audio`) no meio da cadeia. **Se ele falhar, pare e copie a
mensagem inteira** — ela nomeia exatamente qual das 6 asserções caiu, e nenhum
item abaixo faz sentido com um pacote quebrado.

Instale pelo `dist\hydra-1.0.0-setup.exe`. É instalação de um clique, sem
escolher pasta; ela vai para `%LOCALAPPDATA%\Programs\Hydra` (se não estiver aí,
procure por `Hydra.exe`).

**Use o app INSTALADO, não o `npm run dev`.** Em dev o renderer é servido por
`http://localhost` e o binário nativo é lido de `node_modules`; no app instalado
ele é servido de `file://` e o binário sai de dentro de `app.asar.unpacked`. Os
dois modos de falha mais silenciosos desta fase (itens 16 e 18) **só existem no
app instalado** e passariam despercebidos em dev.

### C.0.2 — O portão da máquina

Rode `winver` e anote o número do build (a linha "Versão 2xHx (build do SO
XXXXX)"). **O portão é 20348** — abaixo disso o Windows não tem captura por
processo, e é o Windows 11 que o tem.

- Build **>= 20348**: siga normalmente.
- Build **< 20348**: nada da Parte 3 pode ser testado nesta máquina, exceto o
  item 21 (que é justamente o teste de como o app se comporta aí). Vá direto para
  ele, anote todo o resto como **"não testado"** — nunca como "passou" — e
  reporte. Testar o resto vai precisar de outra máquina.

### C.0.3 — Onde olhar (abra antes de começar, e deixe aberto)

- **DevTools do renderer:** `Ctrl+Shift+I` no app, aba Console.
- **Console do processo main** (é onde vive tudo que começa com
   `[screenshare-audio]`). No app instalado, abra pelo PowerShell:

   ```powershell
   & "$env:LOCALAPPDATA\Programs\Hydra\Hydra.exe" --enable-logging
   ```

   Se mesmo assim nenhuma linha `[screenshare-audio]` aparecer no terminal,
   repita **os itens que dependem do log do main** com `npm run dev`, onde esse
   console cai no terminal do dev — e **anote em qual dos dois modos cada leitura
   foi feita**. Uma diferença entre dev e instalado é informação, não ruído.

**O que é sinal de que deu certo:**

| Onde | Linha |
|---|---|
| main | `[screenshare-audio] captura iniciada em modo EXCLUIR (pid N)` |
| renderer | `[screenshare] áudio por processo publicado (ScreenShareAudio, estéreo)` |
| main, ao parar | `[screenshare-audio] captura encerrada: N chunks, M bytes` |

**O que é ruído ESPERADO e não deve virar caça-fantasma:** um aviso
`silence detected` do LiveKit logo depois de publicar. A faixa é publicada antes
do primeiro pedaço de áudio chegar; é cosmético.

**O que é sinal de defeito:** qualquer linha começando com `Refused to load the
script` / `Content Security Policy` (item 18), e o aviso
`[screenshare-audio] nenhum chunk em 15000ms` (item 20).

---

## Sessão C.1 — Três máquinas: a premissa (~20 min). **Antes de qualquer outro item.**

1. **A voz das outras pessoas da call não pode entrar no que você compartilha.**

   *Por que este é o primeiro:* o áudio desta fase é "capture tudo que este
   computador toca, menos o Hydra e seus filhos", e isso só mata o eco se o
   pedaço do Chromium que **toca a voz dos outros** for mesmo um processo filho
   do Hydra. Ninguém achou documentação oficial dizendo que é. Se não for, a voz
   dos outros volta para dentro do compartilhamento e a fase precisa de outro
   desenho — então não vale gastar as três pessoas em mais nada antes disto.

   1. As três máquinas no mesmo canal de voz, **sem compartilhar nada**,
      confirmando que se ouvem normalmente. De fone, para o teste medir a captura
      e não o microfone pegando o alto-falante.
   2. Na máquina **A**: botão de compartilhar → no diálogo, **ligue o toggle
      "Compartilhar áudio do sistema"** (ele vem desligado) → escolha uma janela.
   3. A máquina **B** fala continuamente por ~30 segundos.
   4. A máquina **C** (que não fala nem compartilha) escuta com atenção: a voz de
      B tem que chegar **uma única vez**.
   5. Inverta os papéis e repita em pelo menos **2 combinações diferentes** de
      quem compartilha × quem fala.

   *Como perceber que falhou:* o eco aqui raramente é um "eco de caverna". O que
   C ouve é a voz de B chegando duas vezes, a segunda com atraso curto e timbre
   mais abafado. Se ficar em dúvida, **use o discriminador**: em C, aplique
   "Silenciar para mim" em **B**, e peça para B continuar falando. Se C **ainda**
   ouvir B, o que está chegando é a voz de B viajando dentro da faixa da máquina
   A — isso é o defeito, sem margem de interpretação.

   *Se falhar:* **pare a lista aqui.** Anote a combinação exata (quem
   compartilhava, quem falava, quem ouviu, com fone ou alto-falante) e reporte só
   isso. Não é um item reprovado entre outros: é o desenho da fase caindo, e o
   encaminhamento é replanejamento (o caminho nomeado pela pesquisa é o modo
   INCLUIR por PID da janela, que é o que o Discord faz), não conserto.

---

## Sessão C.2 — Ainda com as três reunidas (~25 min)

Só entre aqui depois que o item 1 passar limpo. Os itens 2 e 3 são o par que
define o valor da fase: um é a promessa, o outro é o preço.

2. **A promessa: o áudio chega, e chega com qualidade de música.** Com o
   compartilhamento ativo (áudio ligado), toque um vídeo ou uma música na máquina
   que compartilha. As outras duas confirmam que **ouvem** — e que soa como
   música, não como rádio AM. A faixa vai a 128 kbps estéreo; se soar estreito e
   chapado, isso é o item 7 falhando, não a fase.

3. **O preço: com Spotify tocando em segundo plano, o outro lado ouve o
   Spotify.** Deixe o Spotify (ou o YouTube em outra janela) tocando **fora** da
   janela compartilhada e pergunte às outras máquinas o que elas ouvem.

   - **Se ouvirem:** é o comportamento previsto do modo EXCLUIR, e é exatamente o
     que o toggle promete na tela. Confirme que a frase do diálogo bate com o que
     aconteceu: *"Vai junto tudo que o computador estiver tocando — o que você
     compartilha, mas também música, vídeos de outras abas e sons de notificação.
     A voz das outras pessoas da call fica de fora."*
   - **Se NÃO ouvirem:** o texto da interface está **exagerando o preço** e
     precisa encolher. Anote o que de fato foi e o que não foi junto (música de
     outro app? som de notificação do Windows? outra aba do navegador?) — esse é
     o único item da lista que corrige a UI em vez do código, e sem essa anotação
     ninguém sabe qual metade da frase apagar.

4. **Tela inteira se comporta igual a janela.** Repita os itens 1 e 2
   compartilhando a **TELA INTEIRA**. Tem que haver áudio, pelo mesmo caminho,
   sem diferença perceptível, e sem eco. É a razão principal de a fase ter
   escolhido EXCLUIR em vez de INCLUIR: no caminho antigo, tela inteira e janela
   se comportavam diferente.

5. **Ligar o toggle vale para ESTA transmissão.** Comece a compartilhar com o
   toggle **desligado** (as outras confirmam: vídeo sem som). Pare, compartilhe
   de novo e ligue o toggle **dentro do diálogo**: o som tem que aparecer **nesta
   transmissão**, não na próxima. O texto do estado desligado promete isso
   ("Ligar vale já para esta transmissão") e antes desta fase era mentira.

6. **Parar leva o áudio junto.** Com o áudio no ar, pare o compartilhamento pelo
   botão. Nas outras máquinas, o vídeo **e** o som têm que sumir juntos, na hora.

   *Como perceber que falhou:* som que continua chegando depois de o vídeo sumir
   significa que a faixa de áudio não foi despublicada junto com a de vídeo —
   defeito grave, e do tipo que ninguém repara se não estiver procurando.

---

## Sessão C.3 — Duas máquinas (~35 min)

Daqui em diante basta você e mais uma pessoa.

7. **Estéreo de verdade.** O jeito de falhar aqui é publicar **mono, em silêncio,
   sem nenhum erro** — e o único lugar onde isso aparece é no SDP. **Antes** de
   começar a compartilhar, cole isto no Console do DevTools da máquina que vai
   compartilhar:

   ```js
   const _sld = RTCPeerConnection.prototype.setLocalDescription
   RTCPeerConnection.prototype.setLocalDescription = function (d) {
     const sdp = d?.sdp ?? ''
     const fmtp = sdp.match(/a=fmtp:\d+ .*opus.*|a=fmtp:\d+ .*stereo.*/gi) ?? []
     console.log(sdp.includes('stereo=1') ? '%cstereo=1 PRESENTE' : '%cSEM stereo=1',
       sdp.includes('stereo=1') ? 'color:lime' : 'color:red', fmtp)
     return _sld.apply(this, arguments)
   }
   ```

   Agora compartilhe com áudio ligado. Com a faixa de compartilhamento publicada,
   pelo menos uma linha `a=fmtp:` tem que trazer `stereo=1;sprop-stereo=1` (a do
   microfone é mono e não conta — vão aparecer duas). Se não aparecer `stereo=1`
   nenhum, **anote e reporte**: áudio de jogo e de música perde metade, e o
   defeito está antes da publicação.

8. **Latência e sincronia labial.** Com um vídeo com fala tocando na máquina que
   compartilha, a outra confirma que o som acompanha a boca. O projeto espera
   algo entre 60 e 100 ms somados — imperceptível. Se o som chegar visivelmente
   atrasado, ou se houver "cliques" periódicos, anote qual dos dois (são defeitos
   opostos: atraso é buffer cheio demais, clique é buffer raso demais).

9. **Dez minutos seguidos, com música.** Uma transmissão contínua de **10+
   minutos** com som o tempo todo. No fim: o áudio ainda está sincronizado com o
   vídeo? Houve engasgo, clique, ou um atraso que foi **crescendo**?

   *Uma honestidade sobre a medição:* o plano original mandava anotar os
   contadores de underrun/overrun do worklet no início e no fim. Esses números
   **existem no código mas ninguém os consome hoje** — a ponte de áudio aceita um
   `onStats` opcional e nada o passa. Então **não há número para anotar**; o
   instrumento disponível é o seu ouvido, e o sintoma de deriva é atraso que
   aumenta minuto a minuto ou cliques que aparecem em intervalos regulares. Se
   isso acontecer, reporte assim mesmo — a pendência que nasce é ligar o
   `onStats` num log e repetir os 10 minutos. Não invente números.

10. **Reconexão.** No meio de um compartilhamento com áudio, desligue o Wi-Fi da
    máquina que compartilha por ~10 segundos e religue. Quando a call voltar, a
    outra máquina tem que voltar a **ouvir**, não só a ver.

    *Como perceber que falhou:* vídeo volta e som não volta — a faixa foi
    republicada mas está transmitindo silêncio permanente, sem erro nenhum na
    tela. Confirme com o log do main: se `captura iniciada em modo EXCLUIR` não
    reaparecer, o áudio morreu na reconexão.

---

## Sessão C.4 — Sozinho (~35 min)

11. **Parar de verdade para o Windows.** Compartilhe com áudio, deixe rodar ~60
    segundos, pare pelo botão. No console do main tem que aparecer
    `[screenshare-audio] captura encerrada: N chunks, M bytes`.

    *O número serve de conferência:* o formato é 192 KB por segundo de áudio
    **não silencioso**, então um minuto de música dá algo em torno de 11 MB e
    milhares de chunks. Muito menos que isso com música tocando é sinal de que
    quase nada estava sendo capturado (silêncio é descartado antes de virar
    chunk, então um número baixo com o app calado é normal).

12. **Três ciclos na mesma sessão.** Compartilhar → parar → compartilhar → parar
    → compartilhar → parar, sem fechar o app. Os três têm que funcionar, com som
    nos três. (É a não-regressão do SHARE-07.)

13. **Sair do canal sem parar antes.** Compartilhando com áudio, clique em
    desconectar direto. A captura tem que parar sozinha — linha
    `captura encerrada` no main.

14. **F5 no app.** Compartilhando com áudio, recarregue pelo DevTools
    (`Ctrl+R`). A captura tem que parar sozinha.

    *Por que este item existe:* sem isso, o WASAPI segue capturando contra uma
    janela que não existe mais, e nada na tela indica isso. O único jeito de
    perceber é a **ausência** da linha `captura encerrada` no main.

15. **Fechar o app.** Compartilhando com áudio, feche a janela. No Gerenciador de
    Tarefas, **nenhum processo `Hydra.exe` pode sobrar**. Confira também a aba
    Detalhes, não só a de Aplicativos.

16. **O binário nativo está no lugar certo, no app instalado.** Confirme que
    existe:

    ```
    %LOCALAPPDATA%\Programs\Hydra\resources\app.asar.unpacked\node_modules\loopback-capture\build\Release\loopback_capture_addon.node
    ```

    Este arquivo **precisa** estar fora do `app.asar` — o Windows não consegue
    carregar uma DLL de dentro de um arquivo empacotado. Se ele não estiver aí,
    o sintoma no app é o toast "Não foi possível iniciar o áudio do
    compartilhamento nesta máquina", com o vídeo indo normalmente.

17. **A gordura de compilação ficou de fora.** Confirme que **NÃO** existe
    `resources\app.asar.unpacked\node_modules\cmake-js` (nem `resources\cmake-js`)
    dentro da pasta de instalação. São 39 pacotes de ferramenta de build que não
    têm nada que fazer no instalador.

18. **O worklet passa pela política de segurança no app instalado.** Este é o
    item que existe por causa da lição nº 2 do HANDOFF, e o modo de falha é o
    mais traiçoeiro da lista: **nenhum erro de aplicação, só ausência de som.**

    No app **instalado** (não em dev), compartilhe com áudio ligado e olhe o
    Console do renderer. Se aparecer qualquer linha do tipo `Refused to load the
    script ... violates the following Content Security Policy directive:
    script-src 'self'`, o item reprova. Junto dela você deve ver o toast "Não foi
    possível preparar o áudio do compartilhamento. A tela vai sem som."

    **Se reprovar, NÃO afrouxe a política de segurança** — o defeito é o caminho
    do arquivo do worklet, não a política. Reporte a linha inteira.

19. **O relatório do console.** Junte, literalmente (copiar e colar, não resumir):

    - o `require('loopback-capture')` carregou? (se não, a mensagem do erro);
    - o `start()` da captura lançou? Se lançou, **o HRESULT** — é o número que
      distingue "Windows velho demais" de qualquer outra coisa, e ele só existe
      no log do main, em nenhum outro lugar do mundo;
    - a linha `captura iniciada em modo EXCLUIR (pid N)`;
    - a linha `captura encerrada: N chunks, M bytes` de um compartilhamento de
      duração conhecida;
    - o número do build do `winver` (do C.0.2).

20. **Um app que não entrega áudio.** Compartilhe com o **Microsoft Teams**
    tocando som (é o caso conhecido: nem todo app aparece na captura por
    processo). Se nenhum áudio chegar, o app **precisa avisar** em vez de ficar
    mudo: depois de 15 segundos sem nenhum pedaço de áudio, tem que aparecer o
    toast "Nenhum áudio chegou do compartilhamento. Alguns aplicativos não
    permitem captura de áudio.", e no main a linha
    `[screenshare-audio] nenhum chunk em 15000ms`.

    Se o áudio do Teams chegar normalmente, ótimo — anote isso, é informação nova.

21. **Degradação honesta numa máquina sem suporte.** Se houver acesso a uma
    máquina com **Windows 10 (build < 20348)**: no diálogo de compartilhamento, o
    toggle tem que aparecer **"Indisponível", desabilitado**, com o motivo escrito
    ("Seu Windows não tem suporte a áudio por aplicativo. Ele existe a partir do
    Windows 11.") — e o compartilhamento de **vídeo** tem que continuar
    funcionando normalmente. Se não houver essa máquina, anote **"não testado"**.
    Nunca "passou".

---

## Sessão C.5 — A decisão que fecha a fase: o default do toggle

Hoje o "Compartilhar áudio do sistema" nasce **desligado**
(`DEFAULT_SCREEN_SHARE_PREFERENCES` em
`src/renderer/src/lib/screenshare-preferences.ts`), e o motivo disso era o eco. Se
o item 1 passou, esse motivo deixou de existir — mas o item 3 pode ter criado um
motivo novo: ligado por padrão significa mandar para a call tudo que a máquina
estiver tocando, sem ninguém ter pedido.

Só escolha depois de rodar os itens 1, 2 e 3. Inverter é uma linha, e hoje ela
quebra um teste de propósito — é decisão deliberada, nunca efeito colateral.

| Opção | O que significa | O custo |
|---|---|---|
| **manter** | Continua desligado; quem quer som liga uma vez e a preferência fica salva naquela máquina. | Muita gente vai compartilhar sem som sem descobrir que a opção existia. |
| **inverter** | Nasce ligado em todo mundo. | Todo compartilhamento passa a mandar música e notificações junto. Numa máquina abaixo do build 20348, o toggle nasceria ligado **e** desabilitado — confuso. |
| **inverter-com-limite** | Nasce ligado só onde a máquina suporta áudio por processo. | O default deixa de ser constante e passa a depender de uma consulta ao processo main — mais uma peça móvel num módulo hoje puro e síncrono. |

**Reportar:** o veredito de cada item de 1 a 21 (inclusive os "não testado"), e a
escolha: `manter`, `inverter` ou `inverter-com-limite`.

---

## Depois da sessão

Cada bloco aprovado destrava uma escrita no repositório — não deixar isso para
depois, é o que impede um checkpoint de ser refeito por esquecimento:

| Bloco aprovado | O que fechar |
|---|---|
| 1.1 VAD | mover `todos/pending/2026-08-19-voz-nao-sai-em-modo-vad-no-primeiro-uso.md` para `todos/done/` e escrever o resultado em `quick/001-.../001-SUMMARY.md` |
| 1.2 + 1.3 | `phases/07-voz/07-08-SUMMARY.md`, fechar a Fase 7 |
| 2.1 + 2.2 | `phases/08-.../08-03-SUMMARY.md` com o resultado literal de A-D |
| 2.3 | `phases/08-.../08-07-SUMMARY.md`, fechar a Fase 8 |
| Sessão A + B | `phases/08.5-.../08.5-17-SUMMARY.md`, fechar a Fase 8.5 |
| Parte 3, itens 1 e 2 | marcar **SHARE-03** e **SHARE-04** em `REQUIREMENTS.md` (só se os dois passarem) |
| Parte 3 inteira + a decisão do default | `phases/08.6-audio-por-processo/08.6-06-SUMMARY.md` com o veredito literal dos 21 itens, fechar a Fase 8.6 |
| 3.1 + 3.2 | `phases/09-.../09-03-SUMMARY.md`, fechar a Fase 9 |

Depois disso, a decisão que ficou em aberto: se a rede aguentar bem nos testes,
avaliar um terceiro preset de qualidade (1080p a 30fps, 5 Mbps). Não é mudança de
código relevante — é decisão de banda: com 10 pessoas o SFU reenvia o stream 9
vezes, ou seja ~45 Mbps de saída sustentada da VPS contra ~22 Mbps do preset
"Nítida" atual.
