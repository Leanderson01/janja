---
phase: 07-voz
plan: 09
type: execute
wave: 5
depends_on: [07-03, 07-05]
files_modified:
  - src/renderer/src/lib/mic-test.ts
  - src/renderer/src/components/shell/MicTestPanel.tsx
  - src/renderer/src/components/shell/VoiceSettingsPopover.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário vê o nível do próprio microfone em tempo real, sem entrar em canal nenhum"
    - "Usuário grava alguns segundos e ouve a própria voz de volta"
    - "Usuário roda um teste que passa pelo servidor LiveKit e ouve a própria voz depois da ida e volta"
    - "O teste do servidor mostra se o caminho usado foi direto ou via TURN"
    - "Nada disso exige uma segunda pessoa online"
  artifacts:
    - path: "src/renderer/src/lib/mic-test.ts"
      provides: "Medição de nível via Web Audio, gravação curta e reprodução"
    - path: "src/renderer/src/components/shell/MicTestPanel.tsx"
      provides: "Painel com barra de nível, botão de gravar/ouvir e botão de testar pelo servidor"
---

<objective>
Permitir que uma pessoa sozinha verifique se o microfone está funcionando, se o
dispositivo certo está selecionado, se o limiar do VAD está razoável, e — no modo
completo — se o áudio realmente atravessa o servidor e volta.

Purpose: hoje não há como validar voz sem duas pessoas online. Isso trava a verificação
e, depois do lançamento, transforma "não estou conseguindo falar" numa investigação de
duas pessoas em vez de um autodiagnóstico de trinta segundos.
</objective>

<context>
O Discord tem o equivalente disso em Configurações de Voz, e é a primeira coisa que se
manda alguém abrir quando reclama de microfone. A ausência não aparece como falta de
feature — aparece como suporte técnico recorrente.

O plano 07-05 constrói `VoiceSettingsPopover` e `lib/vad.ts`. Este plano acrescenta o
teste dentro daquele painel e reaproveita a medição de nível que o VAD já faz — não
duplicar a leitura de `AnalyserNode`.
</context>

<tasks>

<task type="execute">
  <objective>Medição de nível e retorno local</objective>
  <files>src/renderer/src/lib/mic-test.ts, src/renderer/src/components/shell/MicTestPanel.tsx</files>
  <what>
  Barra de nível em tempo real a partir do dispositivo de entrada selecionado, usando a
  mesma leitura de `AnalyserNode` do `lib/vad.ts`. Botão de gravar alguns segundos com
  `MediaRecorder` e reproduzir.

  A barra deve mostrar a marca do limiar do VAD junto do nível atual — é isso que
  transforma o slider de sensibilidade de tentativa e erro em ajuste informado.

  Encerrar as tracks ao fechar o painel. Microfone que continua aberto depois de fechar a
  tela é o tipo de vazamento que ninguém percebe e todo mundo sente na bateria.
  </what>
  <verify>npm run typecheck && npm run build</verify>
  <done>O painel mostra nível, marca do limiar, e grava e reproduz a própria voz.</done>
</task>

<task type="execute">
  <objective>Teste de ida e volta pelo servidor</objective>
  <files>src/renderer/src/lib/mic-test.ts, src/renderer/src/components/shell/MicTestPanel.tsx</files>
  <what>
  Um botão que prova a corrente completa sem outra pessoa: o app abre DUAS conexões com o
  LiveKit numa sala dedicada de teste — uma publica o microfone, a outra assina e
  reproduz. O usuário fala e se ouve depois de o áudio ter ido até a VPS e voltado.

  Isso exercita token, SFU, codec e caminho de rede de verdade. O retorno local do task
  anterior não exercita nada disso.

  Ao terminar, reportar qual caminho o ICE selecionou — `relay` significa que passou por
  TURN, `host`/`srflx` significa conexão direta. É o mesmo dado que provou o INFRA-02 na
  Fase 1, e aqui ele vira autodiagnóstico: quem estiver atrás de rede restritiva vai ver.

  Duas armadilhas a evitar:
  - **Eco de verdade.** Publicar e assinar o próprio áudio na mesma máquina realimenta o
    microfone. Reproduzir só durante o teste, avisar para usar fone, e encerrar as duas
    conexões ao final.
  - **Sala de teste dedicada.** Nunca rodar isso numa sala de canal real — duas conexões
    fantasma apareceriam para o resto do grupo.
  </what>
  <verify>npm run typecheck && npm run build</verify>
  <done>O botão conecta duas vezes, devolve a própria voz pelo servidor, informa se usou TURN, e encerra tudo ao final.</done>
</task>

</tasks>

<verification>
- `npm run typecheck`, `npm run build` e `npx vitest run` passam
- Nenhuma track fica aberta depois de fechar o painel
- A sala de teste é dedicada, nunca um canal real
</verification>

<success_criteria>
VOICE-21 e VOICE-22 satisfeitos: uma pessoa sozinha consegue verificar microfone,
dispositivo, limiar e o caminho completo até o servidor.
</success_criteria>
