---
phase: 03-shell-da-ui
plan: 05
type: execute
wave: 3
depends_on: ["03-02", "03-03", "03-04"]
files_modified:
  - src/main/index.ts
autonomous: false

must_haves:
  truths:
    - "Janela do Electron tem um tamanho mínimo que garante espaço físico para as 3 colunas fixas (72+240+240px) mais uma área de conversa utilizável"
    - "Usuário confirma manualmente que redimensionar a janela em toda a faixa permitida não sobrepõe nem corta nenhuma das 4 regiões do shell"
    - "Usuário confirma manualmente que navegar entre os 2 servidores e os canais fictícios muda a sidebar e a área de conversa sem erro"
  artifacts:
    - path: "src/main/index.ts"
      provides: "BrowserWindow com minWidth/minHeight coerentes com o orçamento de largura do shell"
      contains: "minWidth"
  key_links: []
---

<objective>
Fechar a Fase 3 com a única peça que vive fora do renderer — o tamanho mínimo
da janela do Electron, necessário para que o layout de colunas fixas
(72+240+240px) sempre tenha espaço físico onde caber — e uma verificação
humana única, combinada, de que o shell inteiro (Planos 01-04) se comporta
como esperado sob redimensionamento real e navegação real.

Purpose: Nenhum CSS resolve uma janela menor que a soma das colunas fixas; é
o único guard que precisa viver no processo main, não no renderer. Depois
disso, a fase só precisa de confirmação visual — automatizar essa
confirmação está fora de escopo (config do projeto tem
`visual_verification.enabled: false`, e o design §11 já registra que "o
layout estático de F3 não precisa de teste automatizado").
Output: Janela com tamanho mínimo seguro, e confirmação humana de que os
critérios de sucesso da fase (APP-01: 4 regiões; redimensionar não quebra;
navegar muda a conversa sem backend) estão satisfeitos.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/03-shell-da-ui/03-RESEARCH.md
@.planning/phases/03-shell-da-ui/03-01-SUMMARY.md
@.planning/phases/03-shell-da-ui/03-02-SUMMARY.md
@.planning/phases/03-shell-da-ui/03-03-SUMMARY.md
@.planning/phases/03-shell-da-ui/03-04-SUMMARY.md
@src/main/index.ts

# src/main/index.ts já existe do bootstrap (F0) com a criação da
# BrowserWindow. Este plano só adiciona minWidth/minHeight às opções
# existentes — não recrie o arquivo do zero, não toque em nada relacionado a
# requestSingleInstanceLock ou outras opções de F0.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Tamanho mínimo da janela</name>
  <files>src/main/index.ts</files>
  <action>
    Localizar a criação da `BrowserWindow` em `src/main/index.ts` (feita pelo
    bootstrap F0) e adicionar `minWidth: 900` e `minHeight: 600` às opções
    existentes, sem remover nenhuma opção já configurada por F0 (ex:
    `webPreferences`, ícone, `show: false`, etc — apenas inserir as duas
    chaves novas). O valor 900 vem do orçamento de largura do shell
    (72 + 240 + 240 = 552px de colunas fixas + margem para a área de
    conversa continuar minimamente utilizável, RESEARCH.md §3).

    Depois de editar, rodar o app (comando de dev do projeto) e confirmar que
    a janela abre normalmente e que tentar redimensionar abaixo de 900x600 é
    bloqueado pelo próprio SO/Electron (a janela simplesmente não encolhe
    além disso).
  </action>
  <verify>src/main/index.ts contém `minWidth: 900` e `minHeight: 600` na configuração da BrowserWindow; app abre normalmente; tentar arrastar a borda da janela abaixo de 900x600 não é possível.</verify>
  <done>Janela tem tamanho mínimo que garante espaço físico para as 4 regiões do shell coexistirem sem sobreposição.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    O shell completo do Discord (Fase 3, Planos 01-05): barra de servidores,
    sidebar de canais com badges de não lidas e participantes de voz
    aninhados, área de conversa com chat mockado/divisor de não lidas/visão
    de voz com placeholder de screenshare, lista de membros agrupada por
    status com overlay de voz, e tamanho mínimo de janela que protege o
    layout.
  </what-built>
  <how-to-verify>
    Rodar o app em modo dev e testar manualmente:

    1. Confirma que as 4 regiões aparecem lado a lado: barra de servidores
       (ícones), sidebar de canais, área de conversa, lista de membros.
    2. Redimensiona a janela em várias larguras/alturas, incluindo perto do
       mínimo (900x600) e uma bem grande (maximizar). Em nenhum tamanho as
       regiões se sobrepõem, cortam texto de forma ilegível, ou geram uma
       barra de rolagem horizontal na janela inteira.
    3. Clica em um servidor diferente na barra — confirma que a sidebar de
       canais e a lista de membros trocam para o conteúdo do novo servidor.
    4. Clica em um canal de texto diferente — confirma que a área de
       conversa troca as mensagens exibidas, e que pelo menos um canal
       mostra o divisor "novas mensagens".
    5. Clica em um canal de voz — confirma que a área de conversa muda para
       a visão de participantes + placeholder de compartilhamento de tela, e
       que o rodapé da sidebar (VoiceControlBar) passa a mostrar "conectado".
       Clica de novo no mesmo canal e confirma que volta a "não conectado".
    6. Digita uma mensagem no campo de texto e envia (clique ou Enter) —
       confirma que ela aparece imediatamente na lista.
    7. Observa a lista de membros — confirma grupos ONLINE/OFFLINE e que
       pelo menos um avatar mostra anel de falando ou ícone de mute
       consistente com a sidebar.
  </how-to-verify>
  <resume-signal>Digite "aprovado" se tudo acima funcionou, ou descreva o problema encontrado (qual passo, o que aconteceu de errado).</resume-signal>
</task>

</tasks>

<verification>
- `src/main/index.ts` define `minWidth: 900, minHeight: 600` na
  `BrowserWindow` sem quebrar nenhuma opção existente de F0.
- Checkpoint humano aprovado confirmando os 3 critérios de sucesso da fase
  (ROADMAP.md, Fase 3): 4 regiões visíveis na estrutura do Discord;
  redimensionamento não quebra o layout; navegação entre servidor/canal
  fictício muda a área de conversa sem backend.
</verification>

<success_criteria>
- Fase 3 (Shell da UI) completa: os 3 critérios de sucesso do ROADMAP.md
  para esta fase são verdadeiros, confirmados por um humano.
- Slots antecipados para F4-F8 (badges de não lidas, avatares de voz aninhados,
  overlay de fala/mute, rodapé de controles de voz, estado de conexão, área
  de screenshare) existem estruturalmente, prontos para receber dados reais
  sem retrabalho de CSS.
</success_criteria>

<output>
After completion, create `.planning/phases/03-shell-da-ui/03-05-SUMMARY.md`.
</output>
