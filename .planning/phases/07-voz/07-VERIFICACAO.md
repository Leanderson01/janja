# Fase 7 — Verificação

**Data:** 2026-08-19
**Resultado:** aprovada com uma pendência
**Verificado por:** Leo e um amigo, em máquinas Windows nativas

## Provado em execução real

| Req | Critério | Como foi provado |
|---|---|---|
| VOICE-01 | Entrar num canal e ouvir os outros | Duas pessoas trocaram áudio |
| VOICE-03 | Sair do canal | ✅ |
| VOICE-04 | **Quem cai à força some do canal** | Processo morto pelo Gerenciador de Tarefas; avatar sumiu da tela do outro em segundos |
| VOICE-05 | Sidebar mostra quem está em cada canal | ✅ |
| VOICE-06/07 | Mute e deafen | ✅ |
| VOICE-08 | Indicador de fala sem piscar | ✅ |
| VOICE-09/10/12 | VAD com limiar, preferência persistente | ✅ |
| VOICE-11 | Push-to-talk | ✅ |
| VOICE-13 | Troca de dispositivo sem reconectar | ✅ |
| VOICE-14/15 | Estado e qualidade de conexão | ✅ |
| VOICE-16 | Cancelamento de eco e supressão de ruído | ✅ |
| VOICE-17 | Sons de canal, com desligar | ✅ |
| VOICE-21/22 | Testador de microfone, incluindo volta pelo servidor | ✅ |

## Pendência

**VOICE-02 — dez pessoas por 30+ minutos com áudio estável.** É o critério de sucesso do
projeto e o único que não pode ser simulado. Precisa de dez pessoas reais.

## Defeitos que só a execução real revelou

Nenhum destes apareceria em build, typecheck ou nos 173 testes.

**1. Áudio remoto nunca tocaria.** Nenhum plano chamava `track.attach()`. Descoberto pelo
agente do plano 07-05 enquanto implementava troca de dispositivo de saída — `setSinkId` e
`setVolume` só afetam elementos já anexados, e não havia nenhum. O sintoma teria sido
"conecto mas não escuto ninguém", com token, SFU e TURN funcionando e nada apontando a
causa.

**2. Conexão duplicada ao LiveKit.** `activeChannelRef` só era atribuído no fim de um join
bem-sucedido. Quando a primeira tentativa falhava, a segunda invocação enfileirada refazia
tudo — dois tokens, duas conexões, mesma identidade, e o SFU derrubava uma. Sintoma
relatado: "do nada começou a funcionar". A divergência entre as duas máquinas foi a pista,
e só existiu porque havia duas pessoas testando.

**3. Som da própria saída era estruturalmente indetectável.** A consulta de participantes
vira `'skip'` no mesmo tick em que o usuário sai, então nunca existe snapshot mostrando
ele ausente. Nenhum ajuste de tempo resolveria — era o lugar errado de escutar. Passou a
disparar na ação de sair.

**4. Três defeitos de rede na máquina do outro testador:** barra sobrando na URL do Convex
(login travava para sempre), coleta de candidatos ICE em adaptador virtual morto, e DNS
sobre HTTPS falhando numa rede com DNS IPv6. Os três corrigidos no app, não documentados
como contorno.

**5. `livekit-server-sdk` exige o runtime Node do Convex.** O spike do plano 07-01
concluiu o contrário — passou sob o vitest, cujo edge-runtime resolve `node:crypto`, e
falhou no bundler real. Custou uma separação de runtime no meio da fase.

## Decisões tomadas durante a execução

- **Testador de microfone acrescentado** (VOICE-21/22), fora do plano original. Nasceu de
  uma necessidade concreta: ninguém online para testar. O modo que passa pelo servidor
  abre duas conexões numa sala efêmera e prova token, SFU, codec e rede sem depender de
  outra pessoa. Virou também ferramenta de autodiagnóstico permanente.
- **Gravação local do testador removida** depois da verificação: o teste pelo servidor faz
  tudo que ela fazia e prova mais.
- **Hook de teclado só inicia em modo push-to-talk.** Um hook global lê toda tecla da
  máquina; num app distribuído a dez pessoas, ele não fica ligado por conveniência.
- **Sons sintetizados com Web Audio**, sem arquivos de áudio. Som de outro produto é
  material protegido dentro de um instalador distribuído.
- **Ensurdecer não toca tom de mute**, mesmo implicando mute: quem se ensurdeceu pediu
  para não ouvir coisas.
