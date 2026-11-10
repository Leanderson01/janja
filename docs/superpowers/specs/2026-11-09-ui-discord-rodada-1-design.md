# UI do Discord no janja — Rodada 1 (visual)

**Data:** 2026-11-09
**Status:** aguardando aprovação do Leo
**Revisão item a item:** https://claude.ai/artifact/DNdhgMTWcvkU6kc12w7far (coleção `decisoes`)

## 1. Por que

O janja existe para o grupo de ~10 amigos largar o Discord. Eles vêm do Discord e
qualquer coisa fora do lugar vira atrito. O pedido do Leo é literal: **trazer a UI
do Discord para o janja, com curva de aprendizado zero**. Quem abre o janja tem que
saber onde clicar sem pensar.

A referência é o Discord de computador **depois da repaginação de março de 2025**,
que é o que o grupo usa hoje (print do Leo em 2026-11-09). Cores, tamanhos e
espaçamentos deste documento foram medidos pixel a pixel nesse print.

## 2. O que já foi decidido

### Decisões grandes (do Leo, na página de revisão)

| Decisão | Escolha |
|---|---|
| Versão de referência | Discord de 2025 (a do print) |
| Cargos | Só visuais: nome e cor, mudam a cor do nome e as seções da lista de membros. Nenhuma permissão. Entram na rodada 3 |
| Fonte | Figtree (a gg sans do Discord é proprietária) |
| Cor de destaque | `#5865f2` |
| Ordem | Três rodadas: 1) visual com dados que já existem, 2) interações de mensagem e não lidas, 3) o resto |
| Fora do escopo | Nitro, loja, impulsos, figurinhas, GIFs, soundboard, atividades e jogos na call, cartões de jogo na lista de membros, placas de nome, efeitos de avatar, tags de servidor, eventos, palco, fórum, threads, explorar servidores, apps e bots |
| Telas pequenas | Computador primeiro. Celular é uma rodada própria, no futuro, copiando o app de celular do Discord |

### Os 74 itens

O Leo aceitou a sugestão em todos os 74 itens da revisão (“igual ao Discord” na
maioria). Os ajustes aceitos: rodapé de voz sem atividades e soundboard; cabeçalho
sem Threads; barra de ações da mensagem sem Encaminhar; caixa de mensagem sem GIF e
figurinhas. Ficaram de fora: pastas de servidores, seção de jogos na lista de
membros, perfil completo em janela grande, câmera.

Este documento cobre **só a rodada 1**. As rodadas 2 e 3 terão o próprio documento.

## 3. Rodada 1: objetivo, não-objetivos, anti-objetivos

**Objetivo.** Ao fim da rodada 1, quem abre o janja vê o Discord: mesma moldura,
mesmas cores, mesmos tamanhos, mesmas posições, mesmos estados visuais, com fotos
de perfil em todo lugar. Tudo com os dados que o backend já tem.

**Não-objetivos (ficam para as rodadas 2 e 3, ver §6).** Responder, reagir, editar,
excluir, menções, formatação, emoji, não lidas agregadas, notificações, categorias
reais, cargos, status além de online/offline, mini perfil, configurações em tela
cheia, atalhos de teclado, busca.

**Anti-objetivos. A rodada falha, mesmo funcionando, se:**

- A voz ou o compartilhamento de tela piorarem. Eles são o motivo do app existir
  (critérios de sucesso do design de 2026-08-18) e foram verificados com gente real.
- Sobrar tela no visual antigo ao lado de tela no visual novo. Amigos, DMs, palco
  da call e diálogos mudam junto.
- Aparecer botão que não faz nada. Botão de função que chega na rodada 2 ou 3 só
  aparece quando a função chegar.
- Aparecer o logo do Discord ou a fonte gg sans.
- Cor escrita direto em componente em vez de token.

## 4. Restrições

- **Stack de hoje:** Electron + React 19 + Tailwind v4 + shadcn/ui, Convex,
  LiveKit. Os mesmos componentes rodam no app e na web.
- **Sem mudança de schema e sem tabela nova na rodada 1.** Permitido: devolver numa
  query existente um campo que já existe (por exemplo `_creationTime`, `nickname`,
  `avatarUrl`, `deafened`, `ownerId`, `joinedAt`); criar query nova só de leitura
  sobre tabelas existentes; dar argumento opcional novo a uma mutation existente
  (por exemplo o estado inicial de mutado/ensurdecido em `joinVoiceChannel`, para a
  pessoa não aparecer desmutada por um instante ao entrar já mutada).
- **Marca:** o app se chama Hydra na tela (commit e5f0699) e o logo é a estrela de
  `HydraMark`. Onde este documento diz “logo do app”, é essa estrela.
- **Regras de composição da Fase 8.5 continuam valendo** (`PROMPT-COLABORADOR-UI.md`):
  shadcn antes de markup próprio, `AvatarFallback` em todo `Avatar`, `Tooltip` em
  ícone sem texto, `ScrollArea` em área rolável, `cn()`, `gap`, `size-*`,
  `DialogTitle`/`SheetTitle` sempre, e tokens semânticos em vez de cor direta.
- **Tema só escuro.** O app já força `class="dark"`; não existe tema claro.
- **Verificação final é no Windows**, pelo Leo, comparando com o Discord aberto ao
  lado. O WSL2 não mostra pixel, áudio nem captura real.
- `npm run typecheck`, `npm run build`, `npm run build:web` e `npx vitest run`
  passando antes de entregar.

## 5. Especificação da rodada 1

Medidas em px na escala 100% do Windows. “Hoje” resume o estado atual levantado no
código em 2026-11-09.

### 5.1 Tokens e tipografia

Os valores abaixo viram tokens no bloco escuro de `src/renderer/src/assets/main.css`
(substituindo os cinzas neutros do shadcn). Nomes de token ficam a critério de quem
construir; o mapeamento de papel é o que importa.

| Papel | Valor | Onde |
|---|---|---|
| Lateral | `#121214` | barra de título, rail, lista de canais |
| Conteúdo | `#1a1a1e` | chat, cabeçalho do chat, lista de membros |
| Painel | `#202024` (borda `#252529`) | painel do usuário/voz |
| Borda da moldura | `#222225` | contorno do conteúdo, separador do rail, fundo de ícone sem imagem, linha do cabeçalho da lista de canais |
| Divisor | `#29292d` | linha do cabeçalho do chat, borda da lista de membros |
| Selecionado | `#2c2c30` | canal aberto |
| Hover de linha | entre `#1f1f23` (lateral) e `#242428` (conteúdo) | canais, mensagens, membros |
| Cartão | `#242429` | prévias de link |
| Caixa de texto | `#222327` (borda `#27282b`) | caixa de mensagem |
| Texto | `#efeff1` | corpo das mensagens |
| Texto forte | `#fbfbfb` | nome do servidor, canal aberto, títulos, nomes |
| Texto apagado | `#81828a` | horários, categorias, canais lidos, nomes na call |
| Ícone | `#96979e` | ícones do cabeçalho |
| Dica | `#6c6d76` | texto de ajuda da caixa de mensagem |
| Destaque | `#5865f2` | botões principais, seleção de foco, ícone do app |
| Online | `#45a366` | bolinha de status, anel de fala |
| Voz | `#5eb479` | “Voz conectada”, cronômetro |
| Perigo | ~`#d83a42` | AO VIVO, NOVAS, desligar, badge de contagem |
| Link | `#4d96ee` | links |

**Fonte:** Figtree, embutida no app (pacote `@fontsource` ou arquivos locais), não
carregada do Google: o app precisa funcionar igual offline, no Electron e na web.

**Tamanhos:** mensagens, nomes e nomes de canal 16px; categorias, nomes na call e
títulos de seção da lista de membros 14px; horários e atividade 12px. Hoje é tudo
14px.

**Fotos:** a foto (`avatarUrl`) aparece em todo lugar onde há avatar: mensagens,
lista de membros, canais de voz, palco, DMs, amigos, painel do usuário. Quem não tem
foto ganha um avatar padrão: a estrela do Hydra sobre uma de 5 cores, escolhida de
forma estável pelo id do usuário. Iniciais deixam de existir.

**Nome exibido:** apelido no servidor (`nickname`) se houver, senão nome de exibição.
Hoje nada grava `nickname`, então na prática aparece o nome de exibição; a regra fica
pronta para quando o apelido existir.

### 5.2 Moldura

- **Barra de título de 32px** na cor da lateral, em cima de tudo.
  - Esquerda: setas Voltar e Avançar, que andam no histórico de canais/DMs abertos
    nesta sessão. Avançar fica apagada quando não há para onde ir.
  - Centro: ícone e nome do servidor (ou da DM / “Amigos”) atual.
  - Direita: no Electron, os botões nativos de minimizar, maximizar e fechar do
    Windows. A Caixa de entrada chega na rodada 2. Ajuda não existe no janja.
  - Arrastar a barra move a janela (Electron). Na web, a faixa existe sem botões de
    janela.
- **Área de conteúdo:** lista de canais, chat e membros ficam dentro de um bloco com
  borda de 1px `#222225` em cima e à esquerda e canto superior esquerdo arredondado
  (~10px). O rail fica fora desse bloco.

### 5.3 Rail de servidores (72px)

- Botão Início no topo: 40×40, cantos ~12px, estrela do Hydra. Separador de 32×1px logo
  abaixo, depois 12px de respiro.
- Ícones de servidor 40×40, quadrados de cantos ~12px, 8px entre eles. Sem imagem:
  sigla em branco sobre `#222225`. Hoje são redondos com anel azul no ativo; o anel
  sai.
- Pílula branca de 4px de largura na borda esquerda: **20px** no hover, **40px** no
  servidor aberto, animada. (8px para não lido chega na rodada 2.)
- Ícone verde de alto-falante no canto superior direito do servidor onde você está
  em call.
- Nome do servidor em balão escuro à direita no hover (já existe; só restilizar).
- Botão “+” no fim, mesmo formato, acende em verde no hover.
- Clique direito no ícone abre o mesmo menu do cabeçalho da lista de canais, com os
  itens que já existem (Convidar pessoas, Criar canal, Copiar nome).

### 5.4 Lista de canais

- **Largura ajustável** arrastando a borda direita, salva por pessoa no navegador/app.
  Padrão 240px, mínimo 240, máximo ~360. (Revê a decisão da Fase 3, que partia do
  Discord não permitir; ele permite desde 2025.)
- **Cabeçalho** de 48px + linha de 1px: nome do servidor 16px negrito, seta para
  baixo, botão de convidar à direita. O menu mantém os itens atuais.
- **Seções:** as duas seções fixas de hoje (TEXTO e VOZ) passam a ter a aparência de
  categoria do Discord: “Canais de texto” e “Canais de voz”, 14px cinza, sem caixa
  alta, seta depois do nome, recolhíveis. Recolhida, continua mostrando o canal
  aberto e o canal de voz com gente. Categorias criadas pelo dono chegam na rodada 3.
- **Linha de canal** ~32px, cantos 6px, ícone 20px, nome 16px:
  - lido: cinza `#81828a`;
  - não lido: nome branco semibold e pílula branca de 4×8px colada na borda esquerda
    da lista (substitui o badge numérico azul de hoje, usando a mesma informação);
  - aberto: fundo `#2c2c30` e nome branco;
  - hover: fundo levemente mais claro, nome mais claro, e o ícone de Criar convite à
    direita (no canal aberto, sempre visível). O ⋮ de hoje sai; as ações dele vão
    para o clique direito.
- **Clique direito no canal:** menu com os itens que já existem (Marcar como lido,
  Copiar nome; nos de voz, Entrar).
- **Canal de voz com gente:** lista recuada abaixo, linhas de 30px, foto de 24px,
  nome 14px cinza. À direita, ícones de mic cortado e de fone cortado (ensurdecido
  passa a aparecer) e a etiqueta vermelha **AO VIVO** para quem compartilha tela
  (substitui o ícone verde). Anel verde de fala como hoje.
- **Cronômetro verde** ao lado do canal de voz em que você está, contando desde que
  a primeira pessoa da call atual entrou (o menor `_creationTime` entre as linhas de
  `voiceStates` do canal), em `h:mm:ss`.
- Clique num canal de voz em que você não está: entra na call e a área do meio continua
  no chat de texto em que você estava (pedido do Leo em 2026-11-09, depois do primeiro
  teste). A tela da call abre ao clicar de novo no canal em que você já está, no
  "canal / servidor" do cartão "Voz conectada" ou no **AO VIVO** de quem transmite.
- O **AO VIVO** ao lado de quem compartilha é um botão "Assistir transmissão de {nome}":
  abre a tela da call e assiste àquela transmissão; se você não está naquela call, entra
  nela primeiro, como o Discord.

### 5.5 Painel do usuário

- **Um cartão** flutuante no canto inferior esquerdo, cobrindo a largura do rail +
  lista de canais, 8px de margem, cantos 8px, fundo `#202024`, borda 1px `#252529`.
  Hoje a parte de voz fica separada na coluna de canais; ela passa para dentro do
  cartão.
- **Parte de voz** (só em call), no topo do cartão:
  - quadradinho com ícone de sinal; texto “Voz conectada” em verde (amarelo em
    Conectando/Reconectando, como hoje); a cor do sinal segue a qualidade de conexão
    que o palco já mede; no hover, o ping, se o LiveKit o expuser;
  - embaixo, “canal / servidor”, clicável para voltar à call;
  - à direita, desligar. (Supressão de ruído fica sempre ligada no janja e não tem
    botão, então não aparece);
  - linha de botões largos: só **Compartilhar tela** por enquanto (câmera ficou de
    fora).
- **Você:** foto de 32px com bolinha verde; nome em branco; embaixo “Online”, que vira
  o @usuário no hover. Clique abre o menu atual (Editar perfil, Copiar e-mail, Sair).
- **Mic e fone** funcionam também fora da call, como no Discord:
  - mutar ou ensurdecer antes de entrar faz você entrar assim, e a sua linha em
    `voiceStates` já nasce com esse estado (argumento opcional em `joinVoiceChannel`);
  - o estado persiste entre calls e entre reinícios do app (hoje volta a desmutado a
    cada entrada, em `VoiceQuickControls` e no join do contexto);
  - cada botão ganha uma setinha que abre a escolha de dispositivo, também fora da
    call. O dispositivo escolhido é salvo e aplicado ao entrar (hoje não é salvo e a
    escolha só aparece com a sala conectada);
  - mutado: ícone cortado em vermelho com fundo avermelhado. Ensurdecer também muta o
    mic, como hoje.
- **Engrenagem** continua abrindo o popover de voz de hoje até a rodada 3.

### 5.6 Cabeçalho do chat

48px + linha de 1px `#29292d`. Ícone # e nome do canal em 16px branco. À direita, só
o botão de mostrar/ocultar membros, aceso quando a lista está aberta. Tópico,
Notificações, Fixadas e Busca chegam com as funções.

### 5.7 Mensagens

- **Agrupamento:** a primeira mensagem de uma sequência mostra foto de 40px, nome e
  horário; as seguintes do mesmo autor, até 7 minutos depois da anterior e sem
  separador de data no meio, aparecem só como texto alinhado. Nessas, o horário
  `HH:mm` aparece na margem esquerda no hover. ~16px entre grupos. Linha clareia no
  hover.
- **Nome:** apelido no servidor, senão nome de exibição. Nunca `#tag`, nunca “Você”.
  Nome em `#fbfbfb` até os cargos chegarem. Clique no nome ou na foto não faz nada
  novo nesta rodada.
- **Horário:** “Hoje às 23:25”, “Ontem às 23:25” ou “07/11/2026 23:25”, 12px cinza.
  Tooltip com a data por extenso (“sábado, 7 de novembro de 2026 23:25”).
- **Separadores:** linha com a data no meio entre dias diferentes; linha vermelha com
  a etiqueta NOVAS à direita onde começam as não lidas (hoje é azul).
- **Topo do canal:** ícone grande de #, “Boas-vindas a #geral!” e “Este é o começo do
  canal #geral.” no lugar de “Nenhuma mensagem ainda”.
- **Rolagem:** o histórico antigo carrega sozinho ao chegar perto do topo (a query já
  pagina). Ao subir, aparece acima da caixa de texto a faixa “Você está vendo
  mensagens antigas” com “Ir para o presente”. Ao abrir um canal, ele abre na
  primeira não lida, se houver.
- **Anexos:** imagem inteira até ~550×350px, cantos 8px; clique abre em tela cheia
  com fundo escuro (Esc fecha). Várias imagens na mesma mensagem formam mosaico.
  Arquivo continua em cartão (ícone, nome, tamanho, baixar), no estilo novo. Vídeo e
  áudio tocam no chat.
- **Prévias de link:** cartão `#242429` com barra de 4px à esquerda na cor do site
  (azul `#1da0f2` para X/Twitter, vermelho para YouTube, destaque para os demais).
  Uma prévia por link, até 5 por mensagem. (Revê a decisão do plano 08.5-16, que
  mostrava só o primeiro link para evitar muro de cartões; o Discord mostra todos e o
  grupo é pequeno.)

### 5.8 Caixa de mensagem

- Fundo `#222327`, borda 1px `#27282b`, cantos 8px, 8px de margem nas laterais.
- “+” à esquerda abre o seletor de arquivo (o clipe sai).
- Texto de ajuda: “Conversar em #geral” (canal) ou “Conversar com @fulano” (DM).
- Sem botão Enviar. O botão de emoji chega com o seletor de emoji na rodada 2.
- Na DM não há “+” nem arrastar arquivo: `dmMessages` não guarda anexos, e botão que
  não funciona não aparece.
- Enter envia, Shift+Enter quebra linha, com a guarda de IME de hoje.
- **Arquivos:** arrastar arquivo para qualquer lugar da conversa mostra a camada
  “Enviar para #geral”; Ctrl+V cola imagem; antes de enviar, os arquivos aparecem
  como miniaturas dentro da caixa, com lixeira.
- **Digitando:** faixa logo abaixo da caixa, à esquerda: três pontinhos animados e
  “Fulano está digitando…”; dois nomes para duas pessoas; “Várias pessoas estão
  digitando…” para três ou mais. Hoje fica acima e em itálico.

### 5.9 Lista de membros

- Largura 240px, borda esquerda `#29292d`, abre e fecha pelo cabeçalho como hoje.
- Seções “Online — N” e “Offline — N”, 14px, sem caixa alta. (Seções por cargo na
  rodada 3.)
- Linha de 44px: foto de 32px com bolinha (verde ou cinza); nome 16px sem `#tag`,
  usando o apelido no servidor se houver; coroa amarela ao lado do dono do servidor;
  embaixo, em 12px, “Em voz” (ícone verde) ou “Compartilhando tela”, quando for o
  caso. Offline com 30% de opacidade (hoje 60%).
- Clique: o menu de hoje (Copiar identificador, Adicionar amigo). Clique direito: o
  mesmo menu, mais Volume do usuário e Silenciar quando a pessoa está na sua call (o
  menu de volume que hoje só existe no palco).

### 5.10 Tela da call

- Fundo preto. Cabeçalho próprio de 48px com ícone de voz, nome do canal e
  cronômetro.
- **Blocos 16:9** com cantos 8px, fundo numa versão escura da cor escolhida pelo id
  (a mesma do avatar padrão, para todos, com ou sem foto), foto de 80px no centro, nome numa etiqueta escura no canto inferior esquerdo, mic cortado
  vermelho quando mutado, **borda verde de 2px** em quem fala. Grade que se ajusta à
  quantidade de pessoas, até 10.
- **Transmissão:** o bloco de quem compartilha mostra AO VIVO e o botão “Assistir
  transmissão”. Ninguém recebe nem o vídeo nem o áudio da transmissão até clicar, como
  no Discord (hoje o vídeo abre sozinho e o áudio da transmissão toca para todos). O
  volume por pessoa continua valendo para o mic e para a transmissão. Quem transmite
  vê a prévia da própria tela no seu bloco sem precisar clicar. Esta parte mexe no
  recebimento de áudio, que foi verificado com gente real: vira um plano próprio, com
  teste de call antes de seguir. Assistindo,
  clicar no bloco foca a transmissão: ela ocupa a tela e os outros viram a faixa
  embaixo (modos que já existem). Botão de tela cheia. “Parar de assistir” volta ao
  bloco.
- **Controles** numa barra centralizada embaixo, que aparece ao mexer o mouse e some
  depois de uns segundos parado: compartilhar tela, mic (com setinha), fone e sair
  (vermelho). À direita, tela cheia. Clique direito num bloco abre volume e silenciar
  (já existe).

### 5.11 Início, amigos e DMs

Mesmo tratamento visual, com o que já existe:

- **Lateral do Início:** item Amigos; título “Mensagens diretas” 14px; cada DM com
  foto, bolinha de status e nome de exibição (sem `#tag`). Busca no topo, “+”, X para
  fechar e não lidas chegam nas rodadas seguintes.
- **Amigos:** cabeçalho com as abas no estilo do Discord (Online, Todos, Pendente) e
  o botão destacado “Adicionar amigo”; Pendente mostra pedidos recebidos e enviados
  (os enviados pedem uma query nova de leitura); contagem “Online — N” acima da lista; linhas
  com foto, status, nome e, no hover, Mensagem e “…”.
- **Conversa de DM:** cabeçalho com foto e nome; topo “Este é o começo do seu
  histórico de mensagens diretas com @fulano”; mensagens agrupadas, horário,
  separadores e prévias de link iguais aos do canal; caixa de mensagem no estilo novo.

### 5.12 Telas de apoio

Recebem os tokens, a fonte e o estilo de janela/cartão/botão do Discord, sem
comportamento novo:

- **Login:** cartão centralizado sobre o fundo da lateral, estrela e nome do Hydra,
  botão “Entrar com Google” no destaque.
- **Carregando** (`AuthGate`) e **erro da raiz:** estrela no centro e uma linha de
  texto, como a tela de abertura do Discord.
- **Seletor de tela do Electron** (`ScreenSharePicker`), **testador de microfone** e
  **popover de voz:** no formato de janela e popover do Discord (fundo do painel,
  cantos 8px, título 20px, botões no destaque).
- **Diálogos** de criar/entrar em servidor, criar canal, convidar e editar perfil:
  mesmo formato de janela.

## 6. O que fica para depois

**Rodada 2 — interações de mensagem e não lidas:** barra de ações no hover, menu da
mensagem, responder, reações, editar e excluir, fixar e painel de fixadas,
menções (pílula, destaque âmbar, contagem), formatação (negrito, código, spoiler…) e
emoji, seletor de emoji e autocompletar, barra “N novas mensagens desde…”, Caixa de
entrada, pílula de 8px e badge vermelho de menções no rail, DMs não lidas no rail,
badge de menção no canal, notificação do Windows, sons de mensagem e menção.

**Rodada 3 — o resto:** categorias criadas pelo dono, cargos só visuais, status
(Ausente, Não perturbe, Invisível, personalizado), mini perfil, editar perfil com
foto e banner, configurações do usuário e do servidor em tela cheia, itens novos de
menu (editar/excluir canal, sair do servidor, silenciar), tópico e status de canal,
busca, preferências de notificação, Ctrl+K e atalhos, chat dentro da call, Bloqueados
e Ativo agora, chamada pela DM.

## 7. Decisões minhas (para o Leo conferir)

1. Câmera ficou de fora, então o rodapé de voz tem só o botão de compartilhar tela.
2. Ajuda não aparece na barra de título: o janja não tem central de ajuda.
3. Barra de título no Electron com os botões nativos do Windows sobrepostos
   (`titleBarStyle: 'hidden'` + `titleBarOverlay`), em vez de botões desenhados à mão.
4. Prévias de link: uma por link, até 5, revendo a decisão do plano 08.5-16.
5. O cronômetro mede a call (desde a primeira pessoa entrar), não o seu tempo nela.
6. “Abrir transmissão em janela separada” fica para depois; tela cheia entra.
7. Clique em membro mantém o menu de hoje até o mini perfil chegar (rodada 3).
8. As seções fixas TEXTO e VOZ ganham cara de categoria até as categorias reais.
9. Avatar padrão: estrela do Hydra sobre 5 cores, escolhida pelo id.
10. Figtree embutida, não carregada da internet.
11. A transmissão passa a ser opcional para quem assiste. Além de igual ao Discord,
    economiza banda de quem não está olhando.
12. Mic e fone funcionam fora da call, e o estado e o dispositivo escolhido ficam
    salvos entre calls e reinícios. Isso mexe no estado de voz (`voice-context.tsx`),
    não só em tela.
13. “Assistir transmissão” controla vídeo e áudio da transmissão, como no Discord.
14. A regra de backend da rodada 1 permite query nova de leitura e argumento opcional
    em mutation existente (para entrar mutado sem piscar e para os pedidos enviados),
    sem mudar schema.
15. Fundo dos blocos da call pela cor do id, não pela cor dominante da foto (fotos
    vêm de domínios externos e ler os pixels pode ser bloqueado).
16. Login, carregamento, erro, seletor de tela, testador de microfone e popover de
    voz ganham o estilo do Discord na rodada 1 (§5.12), sem comportamento novo.
17. A marca na tela continua Hydra com a estrela; “janja” segue como nome do repo.

## 8. Deixado para quem construir

Nomes de token e de componente; como dividir em planos e em que ordem; a curva da
animação da pílula; a regra exata da grade da call para 1 a 10 pessoas; onde guardar
a largura da lista de canais; como detectar a cor do site na prévia de link; o tempo
até os controles da call sumirem; a estratégia de testes de componente para os
estados novos (o projeto já usa Testing Library com jsdom).

## 9. Como saber que ficou pronto

1. Os quatro comandos da §4 passam.
2. Nenhuma tela no visual antigo (rodar o app e abrir: login, carregamento,
   servidor, canal, call com transmissão, seletor de tela, testador de microfone,
   popover de voz, Amigos, DM, diálogos de criar/convidar/perfil).
3. Checkpoint no Windows com o Leo: janja e Discord lado a lado na mesma resolução;
   cada região da §5 confere em posição, tamanho, cor e estado (hover, aberto, não
   lido, falando, mutado, ao vivo).
4. Uma call real com 3+ pessoas compartilhando tela, para confirmar que voz e
   transmissão não regrediram, que quem não clicou em “Assistir transmissão” não
   recebe vídeo nem som da transmissão, e que entrar já mutado não pisca desmutado
   para os outros.
