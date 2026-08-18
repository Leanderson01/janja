---
phase: 07-voz
plan: 08
type: execute
wave: 6
depends_on: ["07-01", "07-02", "07-03", "07-04", "07-05", "07-06", "07-07"]
files_modified: []
autonomous: false

must_haves:
  truths:
    - "Matar o processo do Electron à força com um usuário em canal de voz faz esse usuário sumir da lista, para os outros, em segundos — sem nenhuma ação do cliente"
    - "Dez pessoas permanecem no mesmo canal de voz por 30+ minutos com áudio estável"
    - "Todo o roteiro de controles de voz (mute, deafen, fala, dispositivos, PTT sem foco, VAD, persistência, sons) funciona em máquina Windows nativa"
  artifacts: []
  key_links: []
---

<objective>
Fechar a Fase 7 com a prova que só existe fora de código: implantar o
webhook do LiveKit na VPS de verdade, matar o app à força e confirmar que o
usuário-fantasma nunca sobrevive, sustentar dez pessoas por 30+ minutos, e
percorrer o roteiro completo de controles — tudo em máquina Windows nativa,
nunca em WSL2.

Purpose: nenhum dos Planos 07-01 a 07-07 prova sozinho que a fase está
pronta — cada um prova sua fatia isoladamente (testes automatizados,
tipagem, revisão de código). Os critérios de sucesso do ROADMAP.md para F7
(dez pessoas, 30+ minutos, sem usuário-fantasma, controles completos) só são
verificáveis com pessoas reais, mídia real, e um processo Electron real
sendo morto de propósito.
Output: `.planning/phases/07-voz/07-VERIFICACAO.md` com o resultado de cada
critério, no mesmo formato usado em `01-02-VERIFICACAO.md` e
`03-VERIFICACAO.md`.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/research/PITFALLS.md
@.planning/phases/01-livekit-na-vps/01-02-VERIFICACAO.md
@.planning/phases/03-shell-da-ui/03-VERIFICACAO.md
@infra/livekit/DEPLOY-RUNBOOK.md
@infra/livekit/livekit.yaml

# Por que isto não pode ser um agente sozinho: o WSL2 não renderiza a janela
# do Electron de forma confiável (Chromium derruba o processo de GPU sob
# WSLg/Xvfb — mesmo motivo já documentado em 03-VERIFICACAO.md) e não tem
# como capturar/reproduzir áudio real de microfone/saída. Push-to-talk "sem
# foco" e o teste de "matar o processo" também exigem um SO real com foco de
# janela de verdade, não um ambiente headless. E o teste de 10 pessoas por
# 30+ minutos precisa, literalmente, de 10 pessoas reais — nenhum agente
# consegue simular isso.
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <what-built>
    Nada de código novo — este é o passo de infraestrutura que faltava para
    os testes seguintes serem reais: implantar o `livekit.yaml` que o Plano
    07-02 já editou (bloco `webhook` preenchido).
  </what-built>
  <how-to-verify>
    1. Confirmar que `infra/livekit/livekit.yaml` tem o bloco `webhook`
       preenchido com a URL `.convex.site/livekit/webhook` real (não
       placeholder) — feito no Plano 07-02.
    2. No Coolify, na stack do LiveKit (mesma de `01-02`), clicar em
       **Redeploy** (nunca `docker compose down` — apaga o certificado do
       TURN, ver `DEPLOY-RUNBOOK.md`).
    3. Depois do redeploy, entrar num canal de voz com o app em modo dev e
       fechar a janela normalmente (saída limpa) — checar nos logs do
       container do LiveKit (Coolify → Logs) que uma requisição POST para
       `/livekit/webhook` foi enviada e respondida com 200. Isso já prova
       que o webhook está saindo do servidor e chegando no Convex antes de
       ir para o teste de força-bruta abaixo.
  </how-to-verify>
  <resume-signal>Digite "webhook implantado e confirmado nos logs" para seguir ao teste de usuário-fantasma.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Toda a fatia de voz que dá para testar com 1-2 pessoas: conexão real,
    controles, reconciliação de usuário-fantasma, dispositivos, PTT/VAD.
  </what-built>
  <how-to-verify>
    Em máquina(s) Windows nativa(s), com o app rodando (dev ou build):

    **A — Usuário-fantasma (VOICE-04, o critério mais crítico da fase)**
    1. Duas máquinas (ou duas contas), ambas entram no mesmo canal de voz e
       confirmam que se ouvem.
    2. Numa das máquinas, abrir o Gerenciador de Tarefas do Windows e matar
       o processo `janja.exe` (ou `electron.exe` em dev) à força — não
       fechar pela janela, matar o processo.
    3. Na outra máquina, cronometrar quanto tempo até o avatar da máquina
       morta sumir da sidebar/lista de participantes. Deve sumir em
       segundos (não minutos, não "nunca") — sem que a máquina morta tenha
       feito nada.
    4. Repetir simulando perda de rede em vez de matar o processo (desligar
       o Wi-Fi da máquina em vez de matar o processo) — mesmo resultado
       esperado.

    **B — Controles de voz**
    5. Mutar e desmutar o microfone — o outro participante vê o ícone
       aparecer/sumir.
    6. Ensurdecer — o próprio microfone também é mutado automaticamente
       (ver os dois ícones simultâneos no próprio controle); desmutar
       enquanto ensurdecido remove o ensurdecimento também.
    7. Falar e observar o anel de "falando" no próprio avatar e no avatar
       remoto — não deve piscar em pausas curtas de respiração no meio de
       uma frase.
    8. Trocar o microfone e o dispositivo de saída pelo painel de
       configurações — a chamada não cai, o áudio continua fluindo.
    9. Observar o indicador de qualidade de conexão do outro participante
       (4 níveis) e o próprio estado de conexão (conectando/conectado) ao
       entrar num canal.
    10. Trocar entre modo de detecção de voz e push-to-talk no painel de
        configurações. Em VAD, ajustar o slider de limiar e confirmar que
        fala mais baixa deixa de ativar o microfone com limiar alto.
    11. Em PTT, **minimizar o app ou trocar de janela** (tirar o foco) e
        confirmar que segurar a tecla fixa de push-to-talk ainda liga o
        microfone — este é o ponto central de VOICE-11, não pular.
    12. Fechar e reabrir o app — confirmar que o modo (VAD/PTT) e o limiar
        escolhidos continuam os mesmos (VOICE-12).
    13. Entrar/sair do canal com os sons de canal ligados — ouvir os dois
        sons distintos. Desligar nas configurações e confirmar silêncio.
    14. Abrir a sidebar sem entrar em nenhum canal de voz — confirmar que
        dá para ver quem está em cada canal (avatares aninhados) mesmo sem
        estar conectado.
  </how-to-verify>
  <resume-signal>Digite "aprovado" se tudo acima passou, ou liste os itens (A1-A4, B5-B14) que falharam e o que aconteceu.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    O critério de sucesso central do projeto inteiro para voz: dez pessoas
    reais, no mesmo canal, por tempo real de uso.
  </what-built>
  <how-to-verify>
    Agendar uma sessão real com o grupo (10 pessoas, as mesmas que hoje usam
    Discord):
    1. Todas as 10 entram no mesmo canal de voz.
    2. Conversar normalmente por 30+ minutos (uso real, não silêncio
       propositalmente artificial).
    3. Confirmar que o áudio permanece estável — sem quedas generalizadas,
       sem alguém specificamente sempre cortando (o que indicaria problema
       de rede individual, não do produto — anotar se acontecer, mas não é
       reprovação automática da fase se for claramente um caso isolado de
       rede ruim de uma pessoa).
    4. Ao longo da sessão, cada pessoa testa mute/deafen ao menos uma vez, e
       ao menos uma pessoa em rede não-doméstica (4G, trabalho) confirma que
       consegue ouvir e ser ouvida (reforça o teste de TURN já feito em F1,
       agora com tráfego de voz real, não só o teste sintético de
       conectividade).
    5. Ao final, todos saem do canal (mistura de saída pelo botão e, para
       pelo menos uma pessoa, fechar o app direto) — confirmar que o canal
       fica vazio pra quem ficar olhando a sidebar.
  </how-to-verify>
  <resume-signal>Digite "aprovado, 10 pessoas por Xmin sem instabilidade generalizada" ou descreva o que quebrou.</resume-signal>
</task>

</tasks>

<verification>
Escrever `.planning/phases/07-voz/07-VERIFICACAO.md` (mesmo formato de
`01-02-VERIFICACAO.md`/`03-VERIFICACAO.md`): tabela requisito → critério →
evidência, para os 17 requisitos VOICE-01..17, com o resultado real de cada
checkpoint acima (aprovado ou não, com o que precisou de retrabalho).
</verification>

<success_criteria>
Os 3 critérios de sucesso da Fase 7 no ROADMAP.md são verdadeiros,
confirmados por humano em máquina Windows nativa: (1) call estável de dez
pessoas por 30+ minutos, (2) usuário-fantasma nunca sobrevive a um crash —
reconciliado pelo webhook, não pelo cliente, (3) sidebar/mute/deafen/fala
visíveis a todos, e o roteiro completo de controles (VAD/PTT, dispositivos,
estados de conexão, qualidade, sons) funciona de ponta a ponta.
</success_criteria>

<output>
After completion, create `.planning/phases/07-voz/07-08-SUMMARY.md` e
`.planning/phases/07-voz/07-VERIFICACAO.md`.
</output>
