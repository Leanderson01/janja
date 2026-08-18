---
phase: 06-amigos-e-dms
plan: 08
type: execute
wave: 6
depends_on: ["06-06", "06-07"]
files_modified: []
autonomous: false

must_haves:
  truths:
    - "Usuário encontra outro pelo identificador USER#123 e envia pedido de amizade (SOCIAL-01/02)"
    - "Destinatário vê o pedido e aceita ou recusa (SOCIAL-03)"
    - "Lista de amigos mostra status online/offline de cada um (SOCIAL-04)"
    - "Usuário abre uma conversa direta com um amigo e troca mensagens com ele (SOCIAL-05)"
    - "Usuário remove uma amizade existente (SOCIAL-06)"
  artifacts: []
  key_links: []
---

<objective>
Verificar de ponta a ponta, com duas contas reais numa máquina Windows nativa,
que os 6 requisitos da Fase 6 (SOCIAL-01 a SOCIAL-06) funcionam juntos — a
única coisa que os planos 06-01 a 06-07 não conseguem provar sozinhos, porque
exigem duas identidades autenticadas simultâneas e uma janela Electron
renderizada, nenhuma das duas coisas disponível no executor WSL2.

Purpose: fechar a Fase 6 com confiança de que o fluxo social funciona como
produto, não só como funções isoladas testadas uma a uma.
Output: confirmação humana registrada no SUMMARY deste plano, ou uma lista de
gaps para fechar num plano de correção antes de considerar a fase pronta.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Regressão automatizada final antes do checkpoint</name>
  <files></files>
  <action>
    Rodar a suíte completa como pré-checagem, antes de pedir o checkpoint
    humano — evita gastar o tempo de configuração de duas contas se algo
    básico quebrou:
    ```bash
    npx vitest run
    npm run typecheck
    npm run build
    ```
    Se qualquer um falhar, corrigir antes de prosseguir para a Task 2 — não
    pedir verificação humana sobre um build quebrado.
  </action>
  <verify>Os três comandos terminam com exit code 0.</verify>
  <done>Backend (convex/) e renderer compilam e passam em todos os testes automatizados antes do checkpoint humano.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Fluxo completo de amigos e DMs (SOCIAL-01 a SOCIAL-06): busca por
    `USER#123`, envio/aceite/recusa de pedido de amizade, lista de amigos com
    presença online/offline, conversa direta com histórico paginado, e
    remoção de amizade — navegável a partir do botão "Início" na barra de
    servidores.
  </what-built>
  <how-to-verify>
    **Pré-requisito de ambiente**: isto precisa de **duas identidades
    autenticadas simultâneas**, numa máquina Windows nativa (o executor deste
    plano roda em WSL2 e não consegue renderizar a janela Electron nem fazer
    login duplo). Como `requestSingleInstanceLock` (APP-04) impede uma
    segunda janela do mesmo app na mesma sessão de Windows, use um dos dois
    caminhos:
    - Duas contas de usuário do Windows na mesma máquina (cada uma roda sua
      própria instância do app em `npm run dev`, sessões de SO isoladas o
      suficiente para o lock não colidir); ou
    - Duas máquinas Windows (ou uma máquina + uma VM Windows) na mesma rede,
      cada uma logada com uma conta Google diferente.

    Nomeie as duas contas **Conta A** e **Conta B** no restante deste roteiro
    (cada uma loga com uma conta Google diferente via AUTH-01, gerando um
    `username#tag` próprio no primeiro login).

    **Roteiro (marcar cada item):**
    1. Na Conta A, clicar no botão "Início" na barra de servidores — a visão
       muda para o painel de amigos, sem quebrar a visão de servidor de
       antes (voltar e conferir que servidores/canais continuam normais).
    2. Na aba "Adicionar" do painel de amigos, buscar o `username#tag` exato
       da Conta B (visível na própria Conta B, ex.: na tela de login ou
       onde a Fase 2 expõe a identidade do usuário). Confirmar que o usuário
       correto aparece antes de enviar.
    3. Enviar o pedido de amizade a partir da Conta A.
    4. Na Conta B, ir à aba "Pedidos" do painel de amigos — o pedido da
       Conta A aparece.
    5. Aceitar o pedido na Conta B. Confirmar que ele some da aba "Pedidos" e
       a Conta B agora vê a Conta A na aba "Amigos".
    6. Voltar à Conta A e confirmar que ela também vê a Conta B na aba
       "Amigos" (a amizade apareceu para os dois lados, não só para quem
       aceitou).
    7. Conferir o indicador online/offline: com as duas contas conectadas,
       ambas devem aparecer como "online" uma para a outra dentro de ~1-2
       minutos (tolerância do heartbeat, ver `06-RESEARCH.md`); fechar o app
       da Conta B e confirmar que, depois de alguns minutos sem heartbeat,
       a Conta A passa a ver a Conta B como "offline".
    8. Na Conta A, clicar em "Mensagem" ao lado da Conta B na lista de
       amigos — abre uma conversa direta vazia.
    9. Enviar uma mensagem de texto pela Conta A. Reabrir a Conta B (se
       tiver sido fechada no passo 7) e conferir que a mensagem aparece na
       lista de conversas diretas (sidebar Início) e, ao abrir, no
       histórico.
    10. Responder pela Conta B. Confirmar que a mensagem aparece para a
        Conta A sem precisar recarregar a janela.
    11. Testar um segundo pedido de amizade **repetindo o passo 2-3 entre as
        mesmas duas contas já amigas** — deve ser rejeitado com uma mensagem
        clara ("já são amigos"), não deve criar um pedido nem travar a UI.
    12. Na Conta A (ou B), remover a amizade pela aba "Amigos". Confirmar
        que ela some da lista de amigos dos dois lados, e que a conversa
        direta anterior **continua acessível** (histórico preservado —
        decisão registrada em `06-RESEARCH.md`, não é bug se a conversa não
        sumir).
    13. Tentar enviar um novo pedido de amizade da Conta A para a Conta B
        depois da remoção — deve funcionar normalmente de novo (não deve
        ficar bloqueado por resquício do relacionamento anterior).
  </how-to-verify>
  <resume-signal>
    Digite "aprovado" se todos os 13 passos passaram como descrito, ou
    descreva especificamente qual passo falhou e o que aconteceu (mensagem de
    erro, comportamento inesperado, tela travada) para virar um plano de
    correção.
  </resume-signal>
</task>

</tasks>

<verification>
- Todos os 13 passos do roteiro humano confirmados como "aprovado".
- Nenhum erro não tratado apareceu no console do DevTools do Electron durante o roteiro (checar antes de fechar o checkpoint).
</verification>

<success_criteria>
Fase 6 (Amigos e DMs) verificada de ponta a ponta com duas contas reais:
SOCIAL-01 a SOCIAL-06 funcionam juntos como produto, não só como funções
isoladas. Fase pronta para ser marcada como completa no ROADMAP/STATE pelo
orquestrador.
</success_criteria>

<output>
After completion, create `.planning/phases/06-amigos-e-dms/06-08-SUMMARY.md`,
incluindo o resultado literal do roteiro humano (aprovado / passos que
falharam).
</output>
