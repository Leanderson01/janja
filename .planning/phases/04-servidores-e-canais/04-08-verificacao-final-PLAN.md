---
phase: 04-servidores-e-canais
plan: 08
type: execute
wave: 5
depends_on: ["04-06", "04-07"]
files_modified: []
autonomous: false

must_haves:
  truths:
    - "Toda a suíte de testes do Convex desta fase passa junto com o resto do projeto, sem regressão"
    - "Usuário confirma manualmente, em máquina Windows, que os 5 critérios de sucesso da Fase 4 (ROADMAP.md) são verdadeiros com duas contas reais"
  artifacts: []
  key_links: []
---

<objective>
Fechar a Fase 4 com verificação automatizada completa (typecheck + build + toda a suíte de
testes do Convex, incluindo o que os planos 01-04 já garantiram individualmente, mas agora
junto do resto do projeto) e a confirmação humana única e combinada de que o fluxo real —
criar servidor, convidar, um segundo usuário entrar, revogar, criar canais, ver a lista de
membros — funciona de ponta a ponta em Windows.

Purpose: cada plano anterior verificou sua fatia isoladamente (testes de autorização no
Convex, `typecheck`/`build` no renderer); nenhum verificou o fluxo inteiro com uma segunda
pessoa real entrando por convite, e o WSL2 não renderiza o Electron para confirmar visualmente
nada disso — só uma máquina Windows real fecha esse ciclo (mesma razão documentada em
`03-VERIFICACAO.md` para a Fase 3).
Output: confirmação de que SRV-01 a SRV-07 e APP-02 estão satisfeitos de ponta a ponta, fase
pronta para ser marcada como completa no ROADMAP.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/03-shell-da-ui/03-VERIFICACAO.md
@.planning/phases/04-servidores-e-canais/04-01-schema-e-fundacao-de-servidores-PLAN.md
@.planning/phases/04-servidores-e-canais/04-02-convites-de-servidor-PLAN.md
@.planning/phases/04-servidores-e-canais/04-03-canais-de-servidor-PLAN.md
@.planning/phases/04-servidores-e-canais/04-04-membros-e-presenca-PLAN.md

# APP-04 (instância única, requestSingleInstanceLock, Fase 0) significa que este app não abre
# uma segunda janela na mesma máquina — testar "dois usuários" exige OU duas máquinas Windows
# (ideal), OU a mesma máquina alternando contas (login → testar → sair → login com a segunda
# conta Google → testar o outro lado do fluxo). O passo-a-passo abaixo cobre os dois casos.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verificação automatizada completa</name>
  <files></files>
  <action>
    Rodar, na raiz do repositório, nesta ordem, parando e reportando no primeiro que falhar:
    1. `npm run typecheck` (node + web + convex).
    2. `npm run build`.
    3. `npx vitest run convex` (toda a suíte do Convex — presence.test.ts da Fase 2 +
       servers.test.ts, invites.test.ts, channels.test.ts, members.test.ts, inviteCode.test.ts
       desta fase, todos de uma vez, confirmando que nada de uma fase quebrou a outra).
    Se qualquer um falhar, este NÃO é um problema para o checkpoint humano resolver — corrija
    o código (não os testes, a menos que o teste esteja genuinamente errado) antes de avançar
    para a Task 2.
  </action>
  <verify>Os três comandos acima terminam com código de saída 0.</verify>
  <done>Toda a base de código desta fase compila, builda e passa em todos os testes automatizados, sem depender de confirmação humana para isso.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Servidores reais (criar, listar), convite por código (gerar, copiar, entrar, revogar),
    canais de texto e voz reais (criar, listar), lista de membros com presença online/offline
    real — tudo pela UI, substituindo o shell mockado da Fase 3.
  </what-built>
  <how-to-verify>
    Rodar o app em modo dev (ou o instalável mais recente) numa máquina Windows nativa.
    **Duas contas Google diferentes são necessárias** para os passos 3-4 — use duas máquinas
    Windows se disponíveis, ou a mesma máquina saindo/entrando com a segunda conta entre os
    passos 2 e 3 (o app é de instância única — não abre duas janelas simultâneas).

    1. **Criar servidor (SRV-01):** com a Conta A logada, clica no "+" da barra de servidores,
       cria um servidor com um nome qualquer. Confirma que ele aparece na barra, selecionado, e
       que você aparece como único membro na lista de membros à direita.
    2. **Gerar convite (SRV-02):** abre o diálogo de convite (botão "Convidar" no topo da
       sidebar de canais) e clica em "Gerar código de convite". Confirma que um código de 8
       caracteres aparece, e copia com o botão "Copiar" (anota o código à mão também, por
       segurança).
    3. **Entrar por convite (SRV-03):** com a Conta B logada (segunda máquina, ou mesma máquina
       depois de sair da Conta A e entrar com a Conta B), usa "Entrar com código" no diálogo de
       criar/entrar em servidor, cola o código do passo 2. Confirma que o servidor da Conta A
       aparece na barra da Conta B, e que a lista de membros agora mostra as duas contas.
    4. **Revogar convite (SRV-04):** de volta como Conta A (dona), abre o diálogo de convite de
       novo e clica em "Revogar". Confirma que o código some/fica marcado como inválido. Tenta
       entrar de novo com uma terceira conta (ou a mesma Conta B saindo e tentando reentrar
       usando o código anotado, simulando "alguém que nunca usou esse código antes") usando o
       código revogado anotado no passo 2 e confirma que a UI mostra um erro claro, **e que a
       Conta B (que já tinha entrado antes da revogação) continua aparecendo como membro**.
    5. **Criar canais (SRV-05):** como qualquer uma das duas contas (não precisa ser a dona),
       cria um canal de texto e um canal de voz pelo botão "Criar canal". Confirma que os dois
       aparecem na sidebar, agrupados em TEXTO/VOZ, e que a outra conta também os vê (sem
       precisar recarregar o app — reatividade do Convex).
    6. **Lista de membros com presença (SRV-07, APP-02):** com as duas contas logadas ao mesmo
       tempo (em duas máquinas, ou uma máquina + o app mobile/web não existe, então precisa
       mesmo de duas janelas de SO diferentes — ou aceitar verificar só o "online" da conta
       ativa e o "offline" de uma conta que você sabe que está sem sessão ativa há mais de 90s),
       confirma que a lista de membros mostra os dois grupos (ONLINE/OFFLINE) corretamente, e
       que uma conta que acabou de sair (fechar o app) vira "offline" na lista da outra em até
       ~90 segundos (não instantâneo — é o limiar de presença do plano 04-04).
    7. **Não-membro não acessa (SRV-06):** este item é verificado por teste automatizado
       (Task 1) e não tem UI para "tentar acessar servidor que não sou membro" (a própria UI
       nunca mostra um servidor do qual você não participa) — não é necessário reproduzir
       manualmente.
  </how-to-verify>
  <resume-signal>Digite "aprovado" se os passos 1-6 funcionaram, ou descreva o problema encontrado (qual passo, o que aconteceu de errado, com qual conta).</resume-signal>
</task>

</tasks>

<verification>
- Task 1 (automatizada) passa integralmente.
- Checkpoint humano aprovado confirmando os 5 critérios de sucesso da Fase 4 (ROADMAP.md):
  criar servidor e virar dono; gerar convite e outro usuário entrar; revogar convite sem
  remover quem já entrou; membro cria canal de texto/voz; lista de membros com status
  online/offline.
</verification>

<success_criteria>
Fase 4 (Servidores e canais) completa: SRV-01 a SRV-07 e APP-02 satisfeitos de ponta a ponta,
confirmados por teste automatizado (autorização, unicidade, idempotência) e por um humano
usando o app real com duas contas.
</success_criteria>

<output>
After completion, create `.planning/phases/04-servidores-e-canais/04-08-SUMMARY.md`.
</output>
