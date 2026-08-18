---
phase: 03-shell-da-ui
plan: 03
subsystem: ui
tags: [react, typescript, tailwind, shadcn, radix-ui, lucide-react, electron, mock-data]

# Dependency graph
requires:
  - phase: 03-shell-da-ui (Plano 01)
    provides: mock-data.ts tipado, SelectionProvider/useSelection(), AppShell de 4 regiões, stub de ConversationArea a ser substituído
provides:
  - ConversationArea real: alterna entre visão de chat (canal de texto) e visão de participantes de voz (canal de voz), orientada por useSelection()
  - ChannelHeader com ícone (Hash/Volume2) e nome do canal selecionado
  - MessageList com divisor de "novas mensagens" (antecipando CHAT-05) e estado vazio
  - MessageInput com eco local (Enter para enviar, botão Send, sem persistência)
  - Slot de screenshare (placeholder MonitorUp) já estruturado para F8
affects: [03-05-verificacao-e-janela-minima, futuras fases de chat/voz real (F4+)]

# Tech tracking
tech-stack:
  added: [lucide-react (já instalado por outro plano em paralelo — não instalado por mim), shadcn textarea (criado manualmente, sem dependência nova)]
  patterns:
    - "Reset de estado local ao trocar de item via `key={id}` forçando remount, em vez de useEffect+setState (evita o lint react-hooks/set-state-in-effect)"
    - "Mensagens de eco local usam authorId sentinela 'me', tratado como caso especial de exibição ('Você') em MessageRow, sem precisar de um Member mockado dedicado"

key-files:
  created:
    - src/renderer/src/components/shell/ChannelHeader.tsx
    - src/renderer/src/components/shell/MessageList.tsx
    - src/renderer/src/components/shell/MessageInput.tsx
    - src/renderer/src/components/ui/textarea.tsx
  modified:
    - src/renderer/src/components/shell/ConversationArea.tsx

key-decisions:
  - "Reset de sentMessages ao trocar de canal: usei key={channel.id} no TextChannelView (remount) em vez de useEffect — mais idiomático em React e evita erro de lint react-hooks/set-state-in-effect"
  - "authorId 'me' para mensagens de eco local; MessageRow trata esse valor como caso especial (nome 'Você', iniciais 'EU') em vez de exigir um Member mockado fictício em mock-data.ts (arquivo fora do meu escopo de edição)"
  - "Divisor de não lidas: linha + rótulo 'NOVAS MENSAGENS' centralizado em vermelho (text-red-500/bg-red-500), usando o componente Separator já adicionado por um plano paralelo"

patterns-established:
  - "Grid de participantes de voz: Avatar size-20 com ring-4 ring-green-500 condicional para 'falando' e badge circular com ícone MicOff para 'mutado', lendo diretamente mockVoiceParticipants/mockMembers"

# Metrics
duration: ~35min
completed: 2026-08-18
---

# Phase 03 Plan 03: Área de Conversa Summary

**ConversationArea alterna entre chat de texto (mensagens mockadas + divisor de não lidas + envio local com eco) e visão de voz (grid de participantes com indicador de falando/mutado + placeholder de screenshare para F8), tudo orientado por `useSelection()`.**

## Performance

- **Duration:** ~35 min de execução ativa
- **Completed:** 2026-08-18
- **Tasks:** 3/3
- **Files modified:** 5 (4 criados: ChannelHeader.tsx, MessageList.tsx, MessageInput.tsx, ui/textarea.tsx; 1 reescrito: ConversationArea.tsx)

## Accomplishments

- `ChannelHeader.tsx`: barra fixa (`flex-none h-12`, borda inferior) com ícone `Hash`/`Volume2` (`lucide-react`) + nome do canal lido de `useSelection()`/`mockChannels`, com fallback neutro se nenhum canal for encontrado.
- `MessageList.tsx`: lista rolável (`ScrollArea`) de mensagens com avatar/nome/hora/conteúdo, divisor "NOVAS MENSAGENS" (linha + rótulo centralizado em vermelho) posicionado imediatamente antes da mensagem com `id === firstUnreadMessageId`, e estado vazio ("Nenhuma mensagem ainda").
- `MessageInput.tsx`: `Textarea` + botão `Send`, Enter sem Shift envia, Shift+Enter permite quebra de linha, limpa o campo após enviar, não valida nem persiste (eco puramente local).
- `ConversationArea.tsx` reescrito: composição condicional por `channel.type` — `TextChannelView` (chat completo, com eco local mantido em `useState` e resetado via `key={channel.id}`) ou `VoiceChannelView` (grid de avatares grandes com anel verde de "falando" e badge de mute, mais placeholder de screenshare `MonitorUp` já ocupando o espaço reservado para F8).
- `ui/textarea.tsx`: componente shadcn de textarea criado manualmente (padrão oficial), sem exigir nova dependência npm.

## Files Created/Modified

- `src/renderer/src/components/shell/ChannelHeader.tsx` - cabeçalho fixo do canal selecionado (ícone + nome)
- `src/renderer/src/components/shell/MessageList.tsx` - lista rolável de mensagens + divisor de não lidas + estado vazio
- `src/renderer/src/components/shell/MessageInput.tsx` - campo de envio com eco local via `onSend`
- `src/renderer/src/components/shell/ConversationArea.tsx` - composição chat vs. voz, substitui o stub do Plano 01
- `src/renderer/src/components/ui/textarea.tsx` - componente shadcn de textarea (novo, não existia antes)

## Decisions Made

- **Reset de estado ao trocar de canal:** o plano oferecia duas opções (key no elemento raiz OU useEffect). Escolhi `key={channel.id}` no `TextChannelView` porque `useEffect` chamando `setState` só para zerar estado no mount é sinalizado como anti-padrão pelo ESLint (`react-hooks/set-state-in-effect`) neste projeto; remontar via `key` resolve o mesmo requisito sem o warning e é o padrão React recomendado para "resetar estado quando a identidade de um item muda".
- **`authorId: 'me'` para mensagens de eco local:** como não posso editar `mock-data.ts` (fora do meu escopo), mensagens enviadas localmente usam um `authorId` sentinela que não existe em `mockMembers`. `MessageRow` trata esse caso especificamente, exibindo "Você" e iniciais "EU", em vez de cair no fallback genérico "Usuário desconhecido".
- **lucide-react:** o RESEARCH.md assumia que seria uma dependência transitiva do bootstrap shadcn, mas não estava instalado quando comecei (verifiquei `node_modules/lucide-react` ausente e `package.json` sem a entrada). Antes de decidir instalar eu mesmo (risco de corrida em `package.json`/`node_modules` com os 2 agentes paralelos), um dos planos irmãos instalou o pacote primeiro — confirmei via `git diff` do `package.json` (entrada `lucide-react: ^1.32.0` apareceu) e `ls node_modules/lucide-react`. Usei o pacote normalmente (`Hash`, `Volume2`, `Send`, `MonitorUp`, `MicOff`) sem tocar em `package.json` eu mesmo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removido useEffect que causava lint error `react-hooks/set-state-in-effect`**

- **Found during:** Task 3 (verificação com `npx eslint` após escrever `ConversationArea.tsx`)
- **Issue:** Implementação inicial usava `useEffect(() => setSentMessages([]), [channelId])` para resetar o eco local ao trocar de canal, conforme uma das duas opções sugeridas pelo plano. O ESLint (`eslint-plugin-react-hooks`, regra `set-state-in-effect`) sinalizou isso como erro: `setState` síncrono dentro de um efeito pode causar renders em cascata.
- **Fix:** Troquei para a outra opção que o próprio plano já previa como alternativa válida — `key={channel.id}` no componente `TextChannelView`, forçando remount (e portanto reset do `useState` interno) sempre que o canal muda, sem efeito colateral algum.
- **Files modified:** `src/renderer/src/components/shell/ConversationArea.tsx`
- **Verification:** `npx eslint` limpo (0 erros, 0 warnings) nos 4 arquivos que criei/editei; `npm run typecheck` e `npm run build` seguem passando.
- **Committed in:** não commitado por mim (modo NO_GIT deste plano) — o orquestrador fará o commit dos arquivos finais.

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug de padrão React/lint).
**Impact on plan:** Nenhum impacto de escopo — a correção usa exatamente a alternativa que o próprio texto do plano já autorizava ("escolha uma abordagem e documente na SUMMARY").

## Issues Encountered

- `lucide-react` não estava instalado quando comecei a implementar `ChannelHeader.tsx` (research assumia que seria dependência transitiva do bootstrap shadcn, mas não era). Em vez de rodar `npm install` eu mesmo — arriscando corromper `node_modules`/`package.json` com os dois agentes irmãos (03-02, 03-04) potencialmente instalando pacotes ao mesmo tempo — aguardei e confirmei que um deles instalou o pacote primeiro (`git diff` mostrou a entrada em `package.json`, `node_modules/lucide-react` passou a existir). Usei o pacote normalmente depois disso. Nenhuma alteração minha em `package.json`/`package-lock.json`.
- Tentei verificação visual real: `npm run dev` sob Xvfb (`DISPLAY=:0`) subiu o processo Electron completo (main, gpu-process, utility, renderer) e permaneceu estável por ~15s sem nenhuma linha de erro/crash no log (diferente do relato do Plano 03-01, que via "GPU process isn't usable. Goodbye."). Isso é um sinal mais forte de que o app roda neste ambiente, mas **não constitui confirmação visual** — não há ferramenta de captura de tela disponível no ambiente (`scrot`, `import`, `maim`, `gnome-screenshot`, `ffmpeg`, `xwd` — todos ausentes), então não consegui capturar/inspecionar pixels. Processo foi encerrado limpo ao final (`kill` nos PIDs, confirmado sem processos `electron` residuais).

## Verificação real (o que rodei vs. o que só escrevi)

**Rodei e confirmei:**
- `npm run typecheck` — passa limpo (0 erros) após a implementação final.
- `npm run build` — passa limpo (`electron-vite build`, 1932 módulos do renderer transformados) tanto isoladamente quanto depois que os Planos 02/04 (irmãos) terminaram e modificaram `ChannelSidebar.tsx`/`MemberList.tsx` — build final roda com os quatro planos integrados.
- `npx eslint` nos 4 arquivos criados/editados por mim (`ChannelHeader.tsx`, `MessageList.tsx`, `MessageInput.tsx`, `ConversationArea.tsx`) — 0 erros, 0 warnings, depois de corrigir o `react-hooks/set-state-in-effect` (ver Deviations) e aplicar `eslint --fix` para formatação Prettier.
- `npm run dev` sob Xvfb — processo Electron completo sobe e permanece estável (~15s observados, sem crash/erro no log), diferente da falha de GPU relatada no Plano 03-01. Processo terminado limpo depois.
- `git status --short` — confirmado que só os arquivos esperados (meus + os dos irmãos, já finalizados) aparecem; nenhum arquivo fora do meu escopo foi tocado por mim.

**Só escrevi/inferi, não verifiquei visualmente:**
- Que o divisor "NOVAS MENSAGENS" aparece na posição visual correta (verificado por leitura de código: `message.id === firstUnreadMessageId ? <UnreadDivider /> : null` imediatamente antes do `MessageRow` correspondente, com `mockChannels` confirmando `firstUnreadMessageId: 'msg-4'` e `'msg-10'` respectivamente).
- Que trocar de canal de texto para canal de voz realmente troca a UI inteira sem lista de mensagens/campo de texto visíveis (verificado por leitura: `channel.type === 'voice'` renderiza só `VoiceChannelView`, que não importa `MessageList`/`MessageInput`).
- Que o grid de participantes de voz mostra visualmente o anel verde de "falando" e o ícone de mute na posição esperada.
- Que digitar e pressionar Enter/clicar em Send realmente adiciona a mensagem à lista visível em tempo real na tela.

Estes 4 pontos exigem uma máquina com GUI funcional (ou uma ferramenta de captura de tela disponível no ambiente) para confirmação visual — mesma limitação já registrada no Plano 03-01.

## User Setup Required

None - nenhuma configuração de serviço externo necessária (F3 é puramente estática/mockada).

## Next Phase Readiness

- Critério de sucesso #3 da Fase 3 ("navegar entre canal muda a área de conversa sem exigir backend") está implementado e passa build/typecheck; falta só a confirmação visual real (mesmo bloqueio que o Plano 03-01 já registrou para o restante do shell).
- Slots para F5 (divisor de não lidas, já funcional com dados mockados) e F8 (placeholder de screenshare com `MonitorUp` + texto explicativo, já ocupando o espaço reservado) estão prontos — fases futuras devem conseguir plugar dados/mídia reais sem redesenhar esta região.
- Recomendo que a primeira verificação visual real do shell completo (Planos 01-04 juntos) aconteça em uma máquina com GUI funcional ou com uma ferramenta de screenshot disponível — nenhum dos quatro planos desta fase conseguiu confirmar visualmente ainda.
- `authorId: 'me'` (usado no eco local desta área) é um valor sentinela específico deste plano; se uma fase futura precisar de um conceito real de "usuário atual" (ex. autenticação), esse sentinela deve ser substituído por um id de usuário real, não mantido como mágico.

---
*Phase: 03-shell-da-ui*
*Completed: 2026-08-18*
