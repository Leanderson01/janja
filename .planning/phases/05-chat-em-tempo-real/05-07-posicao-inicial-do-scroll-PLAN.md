---
phase: 05-chat-em-tempo-real
plan: 07
type: execute
wave: 6
depends_on: [05-04]
files_modified:
  - src/renderer/src/components/shell/MessageList.tsx
autonomous: true

must_haves:
  truths:
    - "Abrir um canal com mensagens não lidas posiciona o scroll na primeira não lida, com o divisor visível"
    - "Abrir um canal com tudo lido posiciona o scroll no fim, na mensagem mais recente"
    - "Trocar de canal e voltar não deixa o scroll numa posição arbitrária"
---

<objective>
Corrigir a posição inicial do scroll ao abrir um canal de texto.

Defeito relatado pelo Leo na verificação da Fase 5: ao sair de um canal e voltar, a lista
aparece no topo do viewport — não na primeira mensagem do canal, e não no fim. Uma
posição sem significado nenhum.

O correto: se há mensagens não lidas, posicionar na primeira delas, com o divisor
visível. Se está tudo lido, posicionar no fim, na mensagem mais recente.
</objective>

<context>
O plano 05-04 acertou a parte difícil — âncora de scroll ao carregar histórico e não
roubar a posição quando chega mensagem nova. O que ficou faltando é o caso mais simples e
mais frequente: onde a lista começa quando você abre o canal.

Leo elogiou a virtualização e a rolagem; o problema é só a posição inicial.

`channelReadState` já existe e `openChannel` já devolve o divisor de não lidas — o dado
necessário está disponível, não é preciso criar query nova.
</context>

<tasks>

<task type="execute">
  <objective>Posicionar o scroll ao montar a lista de um canal</objective>
  <files>src/renderer/src/components/shell/MessageList.tsx</files>
  <what>
  Ao montar a lista para um canal, decidir a posição inicial:

  - Existe primeira mensagem não lida na página carregada → rolar até ela, deixando o
    divisor visível com alguma folga acima, para o usuário ver que há contexto anterior.
  - Tudo lido → rolar até o fim.
  - A primeira não lida está fora da página carregada → rolar ao fim e deixar isso
    explícito na summary como limitação conhecida, em vez de carregar páginas em cadeia
    atrás dela.

  Fazer isso sem quebrar o que o 05-04 acertou: a compensação de scroll continua valendo
  só para carga de histórico, e mensagem nova continua não roubando a posição de quem lê.

  Cuidado com o ponto em que a medição acontece. Posicionar antes de as mensagens terem
  altura calculada leva ao sintoma que o Leo viu — o scroll vai para um lugar que era
  correto quando foi medido e deixou de ser. Se aparecer vontade de resolver isso com
  `setTimeout`, é sinal de estar medindo cedo demais; a virtualização expõe um evento de
  layout pronto, use-o.
  </what>
  <verify>npm run typecheck && npm run build && npx vitest run</verify>
  <done>Abrir canal com não lidas posiciona na primeira não lida; abrir canal lido posiciona no fim.</done>
</task>

</tasks>

<verification>
Confirmação visual só é possível no Windows. Descreva na summary exatamente o que o Leo
precisa reproduzir: abrir canal com não lidas, abrir canal totalmente lido, e alternar
entre dois canais várias vezes.
</verification>

<success_criteria>
CHAT-14 satisfeito.
</success_criteria>
