---
phase: 09-polimento-e-empacotamento
plan: 03
type: execute
wave: 2
depends_on: ["09-01", "09-02"]
files_modified: []
autonomous: false

user_setup:
  - service: workos
    why: "Trocar o redirect URI cadastrado de janja://callback para a página de conclusão servida pelo Convex (AUTH-07) — dashboard não tem API pública para isso, e é uma decisão de configuração de produto (qual URL é a fonte da verdade), não algo que o executor deva adivinhar"
    dashboard_config:
      - task: "Atualizar (ou adicionar, mantendo o antigo até confirmar que o novo funciona) o redirect URI permitido para https://<deployment-real>.convex.site/auth/complete"
        location: "Dashboard da WorkOS > aplicação AuthKit > Redirects"
    env_vars:
      - name: VITE_CONVEX_SITE_URL
        source: "Mesmo host do deployment Convex, domínio .convex.site (visível no dashboard do Convex ou no output de `npx convex dev`), com /auth/complete removido — só a origem"

must_haves:
  truths:
    - "Uma pessoa sem conhecimento técnico, numa máquina Windows limpa, consegue instalar e abrir o app só com poucos cliques"
    - "Push-to-talk funciona no executável empacotado, com o app sem foco — não só validado em modo dev"
    - "O roteiro fixo completo (login, criar/entrar em servidor, trocar mensagens, voz com 10 pessoas, compartilhar tela com áudio) passa de ponta a ponta numa instalação limpa"
  artifacts: []
  key_links: []
---

<objective>
Verificação final da Fase 9 e do projeto inteiro: gerar o instalador de verdade numa
máquina Windows, instalar numa máquina limpa, e rodar o roteiro fixo completo com o
grupo. Nada aqui é automatizável — o executor (rodando em WSL2) não tem acesso a uma
máquina Windows, não pode instalar um `.exe`, e o critério final do projeto ("dez pessoas
ficam num canal de voz e compartilham tela com áudio") só existe com pessoas de verdade
conectadas ao mesmo tempo.

Purpose: fecha APP-03, confirma que VOICE-11 sobrevive ao empacotamento (a dívida
cruzada registrada desde a Fase 7), confirma AUTH-07 na prática, e roda a regressão final
que decide se o projeto está pronto para o grupo abandonar o Discord.
Output: instalador Windows funcional, testado numa instalação limpa; roteiro completo
validado com o grupo; comportamento do Brave documentado (resolvido ou não, mas nunca
deixado sem registro).
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/09-polimento-e-empacotamento/09-RESEARCH.md
@.planning/phases/09-polimento-e-empacotamento/09-01-SUMMARY.md
@.planning/phases/09-polimento-e-empacotamento/09-02-SUMMARY.md
@.planning/phases/02-convex-auth-workos/02-VERIFICACAO.md
@.planning/phases/07-voz/07-06-push-to-talk-PLAN.md
@.planning/ROADMAP.md

# Os Planos 09-01 e 09-02 já corrigiram tudo que dava para corrigir sem uma máquina
# Windows: postinstall do Electron, asarUnpack do uiohook-napi, config do NSIS, a rota
# /auth/complete no Convex, e o redirectUri apontando pra ela. Este plano só verifica que
# tudo isso funciona de verdade, fora do ambiente de desenvolvimento.
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <what-built>
    `convex/http.ts` (Plano 09-02) já serve a página de conclusão em `/auth/complete`, e
    `src/main/auth/auth.ts` já monta o `redirectUri` a partir de `VITE_CONVEX_SITE_URL`.
    Falta a ponta que só existe fora do repositório: o dashboard da WorkOS ainda aponta
    para `janja://callback` diretamente.
  </what-built>
  <how-to-verify>
    1. No dashboard da WorkOS (aplicação AuthKit já configurada desde a Fase 2), ir em
       Redirects e adicionar `https://<deployment-real>.convex.site/auth/complete` como
       redirect URI permitido (o `<deployment-real>` é o mesmo host que já está em
       `VITE_CONVEX_SITE_URL` — ver `.env.local`, ou o dashboard do Convex). Pode manter
       `janja://callback` cadastrado também até confirmar que o fluxo novo funciona, e
       removê-lo depois.
    2. Adicionar `VITE_CONVEX_SITE_URL=https://<deployment-real>.convex.site` (sem
       `/auth/complete` no final — o código já concatena isso) ao `.env.local` da máquina
       onde o build vai rodar.
    3. Rodar `npm run dev` localmente e testar um login completo: confirmar que a aba do
       navegador, ao final, mostra a página de conclusão (texto "pode fechar esta aba"),
       não a tela interna da WorkOS/Google, e que o app recebe o login normalmente
       (mesmo comportamento de antes, só a última tela do navegador muda).
  </how-to-verify>
  <resume-signal>Digite "configurado" quando o redirect URI novo estiver cadastrado na WorkOS, `VITE_CONVEX_SITE_URL` estiver em `.env.local`, e um login de teste em modo dev mostrar a página de conclusão em vez da tela da WorkOS. Ou descreva o erro encontrado.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Toda a configuração de empacotamento (postinstall do Electron, `asarUnpack` do
    módulo nativo de push-to-talk, NSIS de um clique) já está no repositório, mas nunca
    foi exercitada gerando um instalador de verdade nem instalando numa máquina Windows
    limpa — o executor não tem como fazer isso a partir do WSL2.
  </what-built>
  <how-to-verify>
    Numa máquina Windows (de preferência a mais "limpa" possível — sem Node/git
    instalados globalmente antes, ou pelo menos sem este repo clonado antes):

    1. `git clone` do repositório do zero.
    2. `npm install` — confirmar que baixa o binário do Electron sozinho, sem o erro
       `Electron uninstall` que a Fase 0 documentou (Plano 09-01 corrigiu isso; esta é a
       primeira vez que se prova em uma clonagem de verdade, não só rodando o script de
       novo num ambiente que já tinha o binário).
    3. Preencher `.env.local` com os valores reais (`MAIN_VITE_WORKOS_CLIENT_ID`,
       `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` — os três precisam estar corretos ANTES
       do build, porque `electron-vite` grava esses valores dentro dos arquivos
       compilados; ver `09-RESEARCH.md` §4 para o porquê).
    4. `npm run build:win`. Se falhar, o erro deve ser legível — copiar a saída completa
       para o SUMMARY deste plano se algo quebrar.
    5. Rodar o instalador gerado (`dist/janja-*-setup.exe` ou nome equivalente) numa
       máquina limpa (ou usuário Windows separado, se não tiver uma segunda máquina).
       Confirmar: poucos cliques (não deve pedir para escolher pasta de instalação nem
       modo per-user/per-machine — é instalador de um clique), abre sozinho ao terminar,
       cria atalho na área de trabalho.
    6. Login completo: confirmar a página de conclusão do Plano 09-02 aparece no
       navegador ao final, e o app recebe o login.
    7. **Testar o login especificamente pelo Brave**, se alguém do grupo tiver o Brave
       instalado ou definido como navegador padrão — este era um problema conhecido e
       não resolvido desde a Fase 2 (`02-VERIFICACAO.md`), e a mudança de arquitetura do
       Plano 09-02 (redirect para uma página `https://` em vez de direto para
       `janja://`) tem uma chance real de ter corrigido isso como efeito colateral (ver
       hipótese em `09-RESEARCH.md` §7) — mas só confirma testando. Documentar o
       resultado no SUMMARY de qualquer jeito: se resolveu, registrar; se não resolveu,
       registrar como limitação conhecida para o grupo (ex: recomendar Chrome/Edge para
       o login).
    8. Push-to-talk no executável instalado: com o app aberto mas **sem foco** (outra
       janela em primeiro plano), segurar a tecla fixa de PTT (Right Control, ver
       `07-06-push-to-talk-PLAN.md`) e confirmar que o microfone liga/desliga. Este é o
       ponto da fase com maior risco técnico não verificado (`uiohook-napi` fora do
       asar) — se falhar, verificar se `app.asar.unpacked\node_modules\uiohook-napi\`
       existe na pasta de instalação antes de reportar como bug do código.
  </how-to-verify>
  <resume-signal>Digite "instalador ok" com o resultado de cada item (1-8) — inclusive o resultado do teste do Brave, positivo ou negativo — ou descreva exatamente onde travou.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    O produto inteiro, de ponta a ponta, empacotado. Esta é a verificação final do
    projeto — o critério central registrado em `PROJECT.md` e `ROADMAP.md`: dez pessoas
    conseguem ficar num canal de voz e compartilhar tela com áudio, de forma estável o
    bastante para o grupo abandonar o Discord.
  </what-built>
  <how-to-verify>
    Com o instalador validado na tarefa anterior, rodar o roteiro fixo completo com o
    grupo de verdade (agendar uma sessão — isso precisa de pessoas reais ao mesmo tempo,
    não é testável sozinho):

    1. Login com conta Google, cada participante.
    2. Um participante cria um servidor; os outros entram pelo código de convite.
    3. Trocar mensagens de texto no canal criado — confirmar que chegam rápido para
       todos.
    4. Todos os dez entram no mesmo canal de voz. Confirmar áudio estável por pelo menos
       30 minutos contínuos (não só um teste de 2 minutos) — este é o critério de
       aceite mais rígido de todo o projeto (VOICE-02).
    5. Um participante compartilha tela com áudio de sistema; os outros confirmam que
       veem a tela e ouvem o áudio, sem eco da própria call.
    6. Ao longo do teste, checar os itens que já falharam antes em ambiente real (nunca
       em WSL2): mute/deafen visível para os outros, indicador de quem fala sem piscar,
       reconexão ao perder rede/matar o processo (ninguém deve ficar como
       usuário-fantasma na lista).
  </how-to-verify>
  <resume-signal>Digite "aprovado" se o roteiro completo passou com o grupo, ou liste especificamente o que falhou (qual dos 6 passos, com quantas pessoas, e o sintoma exato).</resume-signal>
</task>

</tasks>

<verification>
Este plano não tem verificação automatizável — os três checkpoints acima SÃO a
verificação. O SUMMARY final deve registrar, para cada um dos três: o que foi testado, o
resultado exato, e qualquer desvio ou limitação documentada (Brave incluso, resolvido ou
não).
</verification>

<success_criteria>
Instalador Windows gerado e testado numa instalação limpa, com poucos cliques.
Push-to-talk confirmado funcionando no executável empacotado, app sem foco. Roteiro fixo
completo (login → servidor → chat → voz com 10 pessoas → screenshare com áudio) validado
com o grupo de verdade. Comportamento do Brave documentado independente do resultado.
</success_criteria>

<output>
After completion, create `.planning/phases/09-polimento-e-empacotamento/09-03-SUMMARY.md`,
incluindo o resultado do teste do Brave (resolvido pela mudança do Plano 09-02, ou ainda
reproduzindo — e nesse caso, a recomendação documentada para o grupo).
</output>
