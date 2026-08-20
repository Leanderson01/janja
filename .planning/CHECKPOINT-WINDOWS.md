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
| 3.1 + 3.2 | `phases/09-.../09-03-SUMMARY.md`, fechar a Fase 9 |

Depois disso, a decisão que ficou em aberto: se a rede aguentar bem nos testes,
avaliar um terceiro preset de qualidade (1080p a 30fps, 5 Mbps). Não é mudança de
código relevante — é decisão de banda: com 10 pessoas o SFU reenvia o stream 9
vezes, ou seja ~45 Mbps de saída sustentada da VPS contra ~22 Mbps do preset
"Nítida" atual.
