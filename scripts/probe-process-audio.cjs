#!/usr/bin/env node
// Sonda de 30 segundos: esta máquina consegue capturar áudio POR PROCESSO?
//
// Rode DIRETO NO WINDOWS, sem abrir o Hydra:
//
//     node scripts/probe-process-audio.cjs
//
// Por que existe: o áudio do compartilhamento de tela depende da API de process
// loopback do Windows, e o app precisa decidir se ela existe ANTES de tentar. A
// documentação da Microsoft diz que o requisito é o build 20348 — que é maior que
// qualquer Windows 10 de consumidor. Na prática a API existe desde o build 19041
// (Windows 10 versão 2004): é o que o OBS Studio usa em produção desde 2021, com
// este comentário no código deles:
//
//     /* MS says 20348, but process filtering seems to work earlier */
//     minimum.build = 19041;
//
// O app hoje aceita 19041 por causa disso. Esta sonda é como se confirma numa
// máquina específica — sem Electron, sem call, sem depender de mais ninguém.
//
// O que ela NÃO responde: se a voz dos outros participantes fica de fora da
// captura. Isso é a premissa central da Fase 8.6, exige 3+ pessoas numa call e é
// o item nº 1 do roteiro em `.planning/CHECKPOINT-WINDOWS.md`, Parte 3.
const os = require('node:os')

// Troque para `true` e rode de novo se o EXCLUIR falhar: distingue "esta máquina
// não faz process loopback" de "não faz o modo EXCLUIR". A diferença importa —
// se só o EXCLUIR falha, o problema atinge o Windows 11 também, e não é questão
// de versão do sistema.
const INCLUIR = false

const DURACAO_MS = 10_000
// 48000 amostras/s × 2 canais × 2 bytes = 192000 bytes por segundo de áudio.
const BYTES_POR_SEGUNDO = 192_000

let LoopbackCapture
try {
  ;({ LoopbackCapture } = require('loopback-capture'))
} catch (err) {
  console.error('Não foi possível carregar o módulo nativo:')
  console.error(String(err))
  console.error('')
  console.error('Se aparecer "invalid ELF header", você está rodando no Linux/WSL —')
  console.error('o binário é do Windows. Rode esta sonda no Windows de verdade.')
  process.exit(1)
}

console.log('node        ', process.version)
console.log('os.release()', os.release(), '(compare com o `winver`)')
console.log('pid         ', process.pid, '| modo:', INCLUIR ? 'INCLUIR' : 'EXCLUIR')

const cap = new LoopbackCapture()
let chunks = 0
let bytes = 0

try {
  cap.start(process.pid, INCLUIR, (b) => {
    chunks++
    bytes += b.length
  })
} catch (err) {
  console.error('')
  console.error('>>> A ATIVAÇÃO FALHOU. Esta linha inteira é a resposta:')
  console.error(String(err && err.message ? err.message : err))
  console.error('')
  console.error('Anote o HRESULT e rode de novo com INCLUIR = true (linha 24).')
  process.exit(1)
}

console.log('')
console.log('start() não lançou. Ponha música ou vídeo para tocar AGORA (10 s)...')

setTimeout(() => {
  try {
    cap.stop()
  } catch {
    // parar já falhando não muda o veredito da sonda
  }

  const segundos = (bytes / BYTES_POR_SEGUNDO).toFixed(1)
  console.log('')
  console.log(`chunks=${chunks}  bytes=${bytes}  (~${segundos}s de áudio)`)

  if (chunks > 0) {
    console.log('>>> FUNCIONA nesta máquina.')
    process.exit(0)
  }

  console.log('>>> ATIVOU MAS NÃO CHEGOU NADA.')
  console.log('    Ou não havia som saindo pelo dispositivo padrão, ou é o modo de')
  console.log('    falha silenciosa que o `win-capture-audio` descreve em Windows 10')
  console.log('    desatualizado. Confirme o som, rode o Windows Update até o fim,')
  console.log('    reinicie e repita.')
  process.exit(1)
}, DURACAO_MS)
