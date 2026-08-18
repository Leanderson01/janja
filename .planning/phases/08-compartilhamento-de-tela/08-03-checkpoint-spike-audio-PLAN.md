---
phase: 08-compartilhamento-de-tela
plan: 03
type: execute
wave: 2
depends_on: ["08-02"]
files_modified: []
autonomous: false

must_haves:
  truths:
    - "Com Electron >= 43.4.0 e restrictOwnAudio: true, a própria voz da call não ecoa de volta pela track de compartilhamento, testado com 3+ máquinas reais"
    - "Áudio de sistema tocado na máquina de quem compartilha é ouvido pelos outros participantes"
    - "Compartilhar, parar, e compartilhar de novo na mesma sessão do app funciona sem travar (base mínima de SHARE-07, antes do seletor customizado existir)"
  artifacts: []
  key_links: []
---

<objective>
Responder, com pessoas e máquinas reais, a única pergunta que nenhum agente
consegue responder sozinho: o `restrictOwnAudio` do Electron 43.4.0 realmente
elimina o eco da própria call na track de compartilhamento de tela? E o
handler de captura do Plano 08-02 realmente nunca trava uma segunda
tentativa?

Purpose: gate deliberado antes do Plano 08-04 investir na UI do seletor
customizado e do Plano 08-05 no toggle de qualidade. Se o eco aparecer aqui,
é uma descoberta de 1 plano de código, não de 4 — e o plano B já está
documentado (`PITFALLS.md` Pitfall 1: mutar localmente a reprodução do
LiveKit durante a captura, ou documentar como limitação conhecida do MVP) em
vez de precisar ser inventado sob pressão depois de a UI completa já estar
pronta.
Output: confirmação (ou não) de que o caminho crítico da fase funciona;
qualquer achado inesperado registrado no SUMMARY para os planos seguintes
ajustarem o plano se necessário.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/research/PITFALLS.md
@.planning/phases/08-compartilhamento-de-tela/08-RESEARCH.md
@.planning/phases/07-voz/07-08-verificacao-final-PLAN.md

# Por que isto não pode ser um agente sozinho: WSL2 não renderiza a janela
# do Electron de forma confiável, não captura tela nem áudio real de
# sistema, e o teste central (eco) exige pelo menos uma pessoa falando
# enquanto outra compartilha — impossível de simular sem hardware de áudio
# real em três máquinas distintas (duas não bastam, ver PITFALLS.md
# "Warning signs" do Pitfall 1: com só duas pessoas o eco pode não se
# manifestar de forma perceptível).
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    O caminho mínimo de captura: botão "Compartilhar tela" que publica a
    tela inteira + áudio de sistema (via WASAPI loopback) como duas tracks
    no LiveKit, com `restrictOwnAudio: true`, dentro da sala de voz já
    conectada. Sem seletor de fonte ainda (sempre a tela inteira) — só o
    caminho crítico de mídia.
  </what-built>
  <how-to-verify>
    Em pelo menos **3 máquinas Windows nativas** (não 2 — o eco pode não
    aparecer perceptível com só duas pessoas), todas com o app rodando
    (`npm run dev` ou build) e Electron confirmadamente >= 43.4.0
    (`package.json` já tem isso pinado desde a Fase 0, mas confirmar que o
    `node_modules` instalado bate com o pin):

    **A — Eco (Pitfall 1, o teste mais crítico da fase inteira)**
    1. As 3 máquinas entram no mesmo canal de voz e confirmam que se ouvem
       normalmente (sem compartilhar nada ainda).
    2. Uma máquina clica "Compartilhar tela".
    3. Com o compartilhamento ativo, uma DAS OUTRAS duas máquinas (não quem
       compartilha) fala continuamente por ~30 segundos.
    4. A terceira máquina (não quem compartilha, não quem está falando)
       escuta com atenção: a voz de quem fala deve chegar **uma única vez**,
       sem repetição/eco/atraso perceptível vindo da track de
       compartilhamento.
    5. Inverter os papéis (quem compartilhava agora fala, outra pessoa
       compartilha) e repetir — confirmar em pelo menos 2 combinações
       diferentes de "quem compartilha" vs "quem fala".

    **B — Áudio de sistema (SHARE-03)**
    6. Na máquina que compartilha, tocar um áudio de sistema qualquer
       (vídeo do YouTube, música local) enquanto compartilha.
    7. As outras máquinas confirmam que ouvem esse áudio de sistema através
       do compartilhamento — não só o vídeo mudo.

    **C — Handler nunca trava (base mínima de SHARE-07)**
    8. Na mesma sessão do app (sem reiniciar), parar o compartilhamento,
       esperar 5 segundos, e clicar em "Compartilhar tela" de novo — deve
       abrir a captura normalmente, sem travar em estado de carregamento
       infinito.
    9. Repetir o passo 8 mais uma vez (3 tentativas de compartilhar na mesma
       sessão, no total) — todas devem funcionar.

    **D — Vídeo chega**
    10. Confirmar que as outras máquinas veem a tela compartilhada
        (mesmo sem UI polida ainda — só precisa aparecer algum vídeo; a
        renderização definitiva na área de conversa é o Plano 08-06).
        Se `ConversationArea.tsx` ainda mostra o placeholder "chega em F8"
        neste ponto da fase, é esperado — usar `chrome://webrtc-internals`
        ou o DevTools do Electron para confirmar que a track de vídeo está
        chegando, mesmo sem elemento `<video>` renderizado ainda.
  </how-to-verify>
  <resume-signal>
    Digite "aprovado" se A-D passaram sem eco perceptível, ou descreva
    exatamente o que aconteceu (em qual item, com qual combinação de
    máquinas) se algo falhou — principalmente se houve eco (item A), que é o
    critério de sucesso #2 do projeto inteiro.
  </resume-signal>
</task>

</tasks>

<verification>
Escrever no SUMMARY deste plano o resultado literal de cada item A-D, sem
suavizar: se o eco apareceu mesmo com `restrictOwnAudio: true`, registrar
exatamente em qual combinação de máquinas e propor qual mitigação de
`PITFALLS.md` (mute local da reprodução durante captura, ou documentar como
limitação conhecida) os próximos planos devem adotar.
</verification>

<success_criteria>
Os dois pitfalls que definem esta fase (`PITFALLS.md` Pitfall 1 e Pitfall 2)
têm uma resposta real, confirmada em hardware Windows com pessoas reais,
antes de qualquer plano seguinte construir UI em cima do caminho de captura.
</success_criteria>

<output>
After completion, create `.planning/phases/08-compartilhamento-de-tela/08-03-SUMMARY.md`
</output>
