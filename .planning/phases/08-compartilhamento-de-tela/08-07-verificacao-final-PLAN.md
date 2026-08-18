---
phase: 08-compartilhamento-de-tela
plan: 07
type: execute
wave: 6
depends_on: ["08-01", "08-02", "08-03", "08-04", "08-05", "08-06"]
files_modified: []
autonomous: false

must_haves:
  truths:
    - "O roteiro completo de SHARE-01 a SHARE-08 funciona em máquina Windows nativa, com o seletor customizado, o toggle de qualidade e os indicadores de sidebar/member list já prontos"
    - "Matar o processo de quem compartilha à força faz os outros voltarem ao layout normal em segundos, sem frame congelado"
    - "Cancelar o seletor de tela repetidamente não impede uma nova tentativa de compartilhar na mesma sessão"
  artifacts: []
  key_links: []
---

<objective>
Fechar a Fase 8 com a prova que só existe fora de código: o roteiro completo
de compartilhamento de tela — seletor customizado, qualidade, áudio de
sistema sem eco, parar/cancelar, e queda do apresentador — funcionando de
ponta a ponta em máquina Windows nativa, com pessoas reais.

Purpose: os Planos 08-01 a 08-06 provam cada fatia isoladamente (testes
automatizados, tipagem, revisão de código, e o checkpoint intermediário
08-03 já confirmou o caminho crítico de áudio). Este plano prova que a UI
completa construída em cima disso (seletor, qualidade, indicadores) não
quebrou nada do que 08-03 já validou, e cobre os critérios que só fazem
sentido com a UI inteira pronta (SHARE-01 com miniaturas de verdade,
SHARE-07 com o diálogo real de cancelamento, SHARE-08).
Output: `.planning/phases/08-compartilhamento-de-tela/08-VERIFICACAO.md`,
mesmo formato de `07-VERIFICACAO.md`/`02-VERIFICACAO.md`.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/research/PITFALLS.md
@.planning/phases/08-compartilhamento-de-tela/08-03-SUMMARY.md
@.planning/phases/07-voz/07-VERIFICACAO.md
@.planning/phases/02-convex-auth-workos/02-VERIFICACAO.md

# Por que isto não pode ser um agente sozinho: mesmo motivo de 08-03 e
# 07-08 — WSL2 não renderiza a janela do Electron de forma confiável, não
# captura tela nem áudio real, e "matar o processo à força" e "3+ máquinas
# ouvindo eco" exigem hardware e pessoas reais. Ler 02-VERIFICACAO.md antes
# de começar: os cinco defeitos encontrados lá (CSP bloqueando WebSocket,
# .catch() faltando, inicialização no nível do módulo) só apareceram na
# execução real em Windows, nunca em build/typecheck/testes — a mesma
# classe de risco vale aqui. Prestar atenção especial a qualquer erro de
# CSP no console do DevTools ao abrir o seletor de tela ou publicar as
# tracks (a CSP atual já libera LiveKit desde a Fase 2, mas não foi
# validada especificamente com desktopCapturer/getDisplayMedia).
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Toda a fase: seletor customizado com miniaturas, toggle de qualidade,
    indicadores de compartilhamento na sidebar/member list, renderização
    real do vídeo, e a base de reconciliação (webhook + eventos do LiveKit)
    para queda do apresentador.
  </what-built>
  <how-to-verify>
    Em pelo menos **3 máquinas Windows nativas**, todas em uma call de voz
    real (retomando os mesmos participantes/canal do checkpoint 08-03 se
    possível, para comparar):

    **A — Reconfirmar ausência de eco com a UI completa (não só o spike)**
    1. Repetir o teste de eco do Plano 08-03 (item A), agora usando o
       seletor de verdade (escolher uma tela específica, não a automática)
       e com o toggle de qualidade em "Nítida" desta vez (08-03 testou só
       o default). Confirmar novamente ausência de eco em pelo menos 2
       combinações de quem compartilha/quem fala.

    **B — Seletor customizado (SHARE-01)**
    2. Abrir o seletor e confirmar que aparecem miniaturas de verdade
       (não ícones genéricos) para todas as telas conectadas e pelo menos
       2-3 janelas abertas.
    3. Escolher uma janela específica (não a tela inteira) e confirmar que
       só o conteúdo dessa janela aparece para os outros.

    **C — Cancelamento repetido (SHARE-07, agora com o diálogo real)**
    4. Abrir o seletor e cancelar (botão Cancelar) 3 vezes seguidas sem
       nunca escolher uma fonte — confirmar que o botão "Compartilhar
       tela" continua funcional a cada tentativa, sem travar.
    5. Abrir o seletor, fechar clicando fora do diálogo (ou Esc, se
       suportado) em vez do botão Cancelar — mesmo resultado esperado.
    6. Depois dos cancelamentos, compartilhar de verdade uma vez — deve
       funcionar normalmente.

    **D — Qualidade (SHARE-08)**
    7. Compartilhar em "Fluida", observar fluidez de movimento (ex.
       arrastar uma janela na tela compartilhada) nos outros clientes.
    8. Parar, trocar para "Nítida", compartilhar de novo, observar
       legibilidade de texto pequeno na tela compartilhada.
    9. Fechar e reabrir o app — confirmar que a última escolha de
       qualidade persiste.

    **E — Parar e queda do apresentador (SHARE-05, SHARE-06)**
    10. Parar o compartilhamento pelo botão — os outros voltam ao
        placeholder "Ninguém está compartilhando" imediatamente, sem frame
        congelado.
    11. Compartilhar de novo, e desta vez **matar o processo `janja.exe`/
        `electron.exe` à força** (Gerenciador de Tarefas) na máquina que
        compartilha, sem parar o compartilhamento antes. Nas outras
        máquinas, cronometrar quanto tempo até: (a) o vídeo sumir da área
        de conversa — deve ser quase imediato, via evento do LiveKit, não
        via Convex; (b) o ícone de "compartilhando" sumir da
        sidebar/member list — pode levar alguns segundos a mais,
        via reconciliação do webhook (mesmo mecanismo de VOICE-04 na Fase
        7). Nenhum dos dois deve ficar preso indefinidamente.

    **F — Indicadores para quem não está no canal**
    12. De uma máquina que NÃO está no canal de voz onde alguém
        compartilha, confirmar que a sidebar mostra o ícone de
        "compartilhando" para essa pessoa, sem precisar entrar no canal.

    **G — Limitação conhecida do SO (documentar, não corrigir)**
    13. Tentar compartilhar uma janela de gerenciador de senhas ou outro
        app com proteção de conteúdo (`WDA_EXCLUDEFROMCAPTURE`), se
        disponível em alguma das máquinas — confirmar que aparece como
        retângulo preto, e que isso é esperado (não reportar como bug).
  </how-to-verify>
  <resume-signal>
    Digite "aprovado" se A-F passaram (G é só confirmação de comportamento
    esperado do SO, não critério de reprovação), ou liste os itens que
    falharam com o que aconteceu — especialmente qualquer eco em A ou
    qualquer trava em C.
  </resume-signal>
</task>

</tasks>

<verification>
Escrever `.planning/phases/08-compartilhamento-de-tela/08-VERIFICACAO.md`
(mesmo formato de `07-VERIFICACAO.md`): tabela requisito → critério →
evidência para SHARE-01 a SHARE-08, com o resultado real de cada item A-G
acima, incluindo qualquer defeito encontrado só na execução real (mesmo
padrão de honestidade de `02-VERIFICACAO.md` — registrar o que quebrou e
como foi corrigido, não só o resultado final aprovado).
</verification>

<success_criteria>
Os 5 critérios de sucesso da Fase 8 no ROADMAP.md são verdadeiros,
confirmados por humano em máquina Windows nativa com 3+ pessoas: (1) picker
com miniaturas funcionando, (2) áudio de sistema ouvido sem eco da própria
call, (3) parar/cancelar sem travar, (4) queda do apresentador sem frame
congelado, (5) toggle de fluidez vs nitidez funcional e persistente.
</success_criteria>

<output>
After completion, create `.planning/phases/08-compartilhamento-de-tela/08-07-SUMMARY.md` e
`.planning/phases/08-compartilhamento-de-tela/08-VERIFICACAO.md`.
</output>
