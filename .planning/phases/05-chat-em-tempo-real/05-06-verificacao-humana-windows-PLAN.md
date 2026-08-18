---
phase: 05-chat-em-tempo-real
plan: 06
type: execute
wave: 5
depends_on: ["05-01", "05-02", "05-03", "05-04", "05-05"]
files_modified: []
autonomous: false

must_haves:
  truths:
    - "Mensagem enviada por uma conta aparece para a outra em menos de 500ms (CHAT-02)"
    - "Rolar para cima carrega histórico antigo sem a lista pular, mesmo com mensagem nova chegando durante a carga (CHAT-03)"
    - "Mensagem nova não rouba o scroll de quem lê histórico; aparece aviso de mensagem nova (CHAT-04)"
    - "Reabrir um canal mostra o divisor na primeira mensagem não lida, e a sidebar mostra contagem de não lidas (CHAT-05/CHAT-06)"
    - "Indicador de 'está digitando' aparece durante a digitação e some sozinho depois de alguns segundos sem eventos (CHAT-07)"
  artifacts: []
  key_links: []
---

<objective>
Verificar de ponta a ponta, com duas contas reais numa máquina Windows nativa, os 7
requisitos da Fase 5 (CHAT-01 a CHAT-07) — em especial os dois critérios que os planos
05-01 a 05-05 não conseguem provar sozinhos porque exigem duas identidades autenticadas
simultâneas trocando mensagem em tempo real e uma janela Electron renderizada, nenhuma
das duas coisas disponível no executor WSL2: a latência real de entrega (CHAT-02, com um
número, não uma suposição) e o comportamento de scroll sob concorrência de verdade
(CHAT-03/CHAT-04, que só se manifesta com uma segunda pessoa mandando mensagem enquanto
a primeira está rolando o histórico).

Purpose: fechar a Fase 5 com confiança de que o chat funciona como produto sob uso
concorrente real, não só como funções isoladas e uma UI testada sozinha.
Output: confirmação humana registrada no SUMMARY deste plano (incluindo o método e o
resultado da medição de latência), ou uma lista de gaps para fechar num plano de
correção antes de considerar a fase pronta.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/05-chat-em-tempo-real/05-RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Regressão automatizada final antes do checkpoint</name>
  <files></files>
  <action>
    Rodar a suíte completa como pré-checagem, antes de pedir o checkpoint humano — evita
    gastar o tempo de configuração de duas contas se algo básico quebrou:
    ```bash
    npx vitest run
    npm run typecheck
    npm run build
    ```
    Se qualquer um falhar, corrigir antes de prosseguir para a Task 2 — não pedir
    verificação humana sobre um build quebrado.
  </action>
  <verify>Os três comandos terminam com exit code 0.</verify>
  <done>Backend (convex/) e renderer compilam e passam em todos os testes automatizados antes do checkpoint humano.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Chat de canal de texto completo: envio/recebimento em tempo real, histórico paginado
    com scroll ancorado (não pula ao carregar mais antigo), aviso de mensagem nova para
    quem está lendo histórico, divisor de não lidas ao reabrir canal, badge de contagem
    na sidebar, e indicador de "está digitando" com expiração automática.
  </what-built>
  <how-to-verify>
    **Pré-requisito de ambiente**: isto precisa de **duas identidades autenticadas
    simultâneas**, numa máquina Windows nativa (o executor deste plano roda em WSL2 e não
    consegue renderizar a janela Electron nem fazer login duplo). Como
    `requestSingleInstanceLock` (APP-04) é por perfil de usuário do app (não por
    máquina), a forma mais simples de testar duas contas **na mesma máquina** é rodar duas
    instâncias apontando para diretórios de dados separados, cada uma logada com uma
    conta Google diferente:
    ```
    # Instância 1 (Conta A) — perfil padrão
    npm run dev

    # Instância 2 (Conta B) — perfil isolado, roda em paralelo sem colidir com o lock
    # da Instância 1 porque é um --user-data-dir diferente
    npm run dev -- --user-data-dir="C:\temp\janja-conta-b"
    ```
    Se isso não funcionar de primeira com `electron-vite dev` (o `--user-data-dir` pode
    precisar ser passado depois de `--` de outra forma, dependendo de como o script `dev`
    encaminha argumentos), alternativas equivalentes: duas contas de usuário do Windows
    na mesma máquina, ou duas máquinas na mesma rede. Nomeie as duas contas **Conta A** e
    **Conta B** no restante deste roteiro.

    Ambas as contas precisam ser membros do mesmo servidor (usar um convite gerado pela
    Conta A, se ainda não estiverem no mesmo servidor) e o roteiro usa um único canal de
    texto compartilhado, chamado **#teste-chat** abaixo (criar se não existir).

    **Roteiro (marcar cada item):**

    1. **CHAT-01/CHAT-02 — envio e latência.** Com as janelas das duas contas visíveis
       lado a lado no mesmo monitor, a Conta A envia uma mensagem em #teste-chat.
       Confirmar visualmente que ela aparece na janela da Conta B sem atraso perceptível
       (o alvo é sub-500ms — bem acima do limiar de percepção humana de "instantâneo").
       Para um número real (não só impressão visual): gravar a tela com as duas janelas
       visíveis (Win+G ou qualquer gravador, 30fps+) enquanto a Conta A envia 3-4
       mensagens de teste, e depois contar quantos quadros se passam entre o clique de
       enviar e a mensagem aparecer na janela da Conta B — a 30fps, cada quadro é
       ~33ms, então mesmo um atraso de "vários quadros" ainda fica bem dentro de 500ms.
       Repetir no sentido B→A.
    2. **CHAT-07 — digitando.** Conta A começa a digitar (sem enviar) em #teste-chat.
       Conta B deve ver "conta_a#XXXX está digitando..." aparecer em poucos segundos.
       Conta A para de digitar (sem apagar o texto, sem enviar) e espera ~6-8 segundos —
       o indicador deve sumir sozinho na tela da Conta B, sem nenhuma ação adicional da
       Conta A.
    3. **Preparar histórico para os testes de scroll**: a Conta A envia ~35 mensagens
       curtas e numeradas em #teste-chat (ex: "teste 1", "teste 2", ..., "teste 35") —
       o suficiente para passar da primeira página (30 mensagens) e existir uma segunda
       página real para carregar via scroll.
    4. **CHAT-03 — scroll não pula ao carregar histórico.** Na Conta B, abrir
       #teste-chat (a lista já deve pular direto para o fim, mostrando as últimas
       mensagens) e rolar até o topo da lista carregada. Confirmar que mais mensagens
       antigas carregam (a página cresce) **sem a posição visual pular** — a mensagem
       que estava no topo da tela antes de carregar mais deve continuar visível
       aproximadamente na mesma posição depois. Repetir 2-3 vezes.
    5. **CHAT-03 sob concorrência real.** Repetir o passo 4, mas desta vez, no instante
       em que a Conta B rola para o topo (disparando o carregamento), a Conta A envia
       uma mensagem nova em #teste-chat. Confirmar que o carregamento do histórico
       antigo (topo) e a chegada da mensagem nova (fim) não interferem um com o outro —
       nenhum pulo de posição, e a mensagem nova da Conta A não aparece no meio do
       histórico antigo sendo carregado.
    6. **CHAT-04 — mensagem nova não rouba o scroll.** Com a Conta B ainda no meio do
       histórico antigo de #teste-chat (não no fim), a Conta A envia uma mensagem nova.
       Confirmar que a tela da Conta B **não** rola automaticamente para o fim — em vez
       disso, aparece um botão/aviso "N nova(s) mensagem(ns)" no rodapé da lista.
       Clicar nesse aviso deve rolar suavemente até o fim e fazer o aviso sumir.
    7. **CHAT-05 — divisor de não lidas.** Com a Conta B fora de #teste-chat (em outro
       canal), a Conta A envia 2-3 mensagens novas. A Conta B então abre #teste-chat —
       confirmar que existe uma linha "NOVAS MENSAGENS" imediatamente antes da primeira
       das mensagens que chegaram enquanto ela estava fora. Fechar o canal (trocar para
       outro) e reabrir sem nenhuma mensagem nova no meio tempo — o divisor não deve mais
       aparecer (já foi marcado como lido).
    8. **CHAT-06 — badge de não lidas na sidebar.** Com a Conta B em outro canal (não
       #teste-chat), a Conta A envia uma mensagem em #teste-chat. Confirmar que a
       sidebar da Conta B mostra um número (badge) ao lado de #teste-chat. Clicar em
       #teste-chat na Conta B — o badge deve sumir.
  </how-to-verify>
  <resume-signal>
    Digite "aprovado" se todos os 8 passos passaram como descrito (incluir o número/faixa
    de latência observado no passo 1), ou descreva especificamente qual passo falhou e o
    que aconteceu (mensagem de erro, comportamento inesperado, posição de scroll errada,
    print/gravação se possível) para virar um plano de correção.
  </resume-signal>
</task>

</tasks>

<verification>
- Todos os 8 passos do roteiro humano confirmados como "aprovado", incluindo um
  número/faixa de latência para CHAT-02 (não só "pareceu rápido").
- Nenhum erro não tratado apareceu no console do DevTools do Electron durante o roteiro
  (checar em ambas as janelas antes de fechar o checkpoint).
</verification>

<success_criteria>
Fase 5 (Chat em tempo real) verificada de ponta a ponta com duas contas reais e
concorrência de verdade: CHAT-01 a CHAT-07 funcionam juntos como produto, incluindo os
dois comportamentos que só se manifestam sob uso real (latência medida, scroll sob
mensagem concorrente) — não só como funções isoladas testadas uma a uma. Fase pronta
para ser marcada como completa no ROADMAP/STATE pelo orquestrador.
</success_criteria>

<output>
After completion, create `.planning/phases/05-chat-em-tempo-real/05-06-SUMMARY.md`,
incluindo o resultado literal do roteiro humano (aprovado / passos que falharam) e o
número/faixa de latência medido para CHAT-02.
</output>
