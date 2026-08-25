// Contrato do áudio de compartilhamento por PROCESSO (Fase 8.6), compartilhado
// pelos três lados: processo main (quem captura), preload (quem expõe os
// canais) e renderer (quem transforma PCM em track publicável).
//
// Por que este arquivo existe em vez de os canais serem duplicados como
// literal no preload: é o mesmo motivo de `screenshare-types.ts` — um erro de
// digitação no nome de um canal não gera erro nenhum, gera um `send` caindo no
// vazio e um silêncio que ninguém sabe explicar. Uma única definição torna
// essa classe de erro impossível.
//
// Este arquivo é deliberadamente livre de imports: é bundlado dentro do
// preload (e type-checkado junto do renderer), onde `electron` do processo
// main não pode entrar.
//
// ------------------------------------------------------------------
// PROIBIDO NESTE PROJETO: `startSystemAudio()` DO PACOTE `loopback-capture`.
//
// `startSystemAudio(cb)` NÃO é captura por processo — é LOOPBACK DE
// DISPOSITIVO, exatamente o mesmo mecanismo do `audio: 'loopback'` do
// Electron, com exatamente o mesmo eco que 4 pessoas viveram numa call em
// 2026-08-20: o app toca a voz dos outros participantes pelo dispositivo de
// saída, e o loopback de dispositivo captura essa saída de volta e a manda
// para a call.
//
// Ele parece o fallback mais natural do mundo ("se o process loopback falhar,
// usa o do sistema") e por isso é uma armadilha perfeita: funciona em QUALQUER
// Windows, entrega áudio de verdade, e devolve o defeito que originou esta
// fase inteira. Quem ler este código daqui a três meses vai achar que é o
// atalho. NÃO É.
//
// O fallback de "não deu" é SEM ÁUDIO, com motivo legível na tela
// (`ScreenShareAudioStartResult` com `ok: false`). Trocar "sem som" por "todo
// mundo se ouvindo" não é degradar, é regredir.
// ------------------------------------------------------------------

export const SCREENSHARE_AUDIO_CHANNELS = {
  /** renderer -> main, invoke: começa a captura; resolve com o resultado. */
  START: 'screenshare-audio:start',
  /** renderer -> main, uma via: para a captura. Idempotente. */
  STOP: 'screenshare-audio:stop',
  /** main -> renderer: um chunk de PCM cru. ~100/s. */
  CHUNK: 'screenshare-audio:chunk',
  /** main -> renderer: mudanças de estado (capturando, sem áudio, parou, falhou). */
  STATUS: 'screenshare-audio:status'
} as const

/**
 * Build mínimo de Windows para `PROCESS_LOOPBACK_MODE` (campo
 * `req.target-min-winverclnt` da doc oficial da Microsoft, e o mesmo número
 * declarado pela amostra `ApplicationLoopbackAudio`).
 *
 * MAS a documentação está descrevendo o SDK, não o binário: 20348 é o build do
 * Windows Server 2022, que era o Insider mais recente quando a página foi escrita
 * em jan/2021. A API existe desde o Windows 10 versão 2004 (build 19041).
 *
 * A evidência que decide não é opinião — é o fonte de produção do OBS Studio,
 * `plugins/win-wasapi/plugin-main.cpp`, inalterado desde 2021 e rodando em
 * milhões de máquinas:
 *
 *     /* MS says 20348, but process filtering seems to work earlier *\/
 *     minimum.build = 19041;
 *
 * Confirmado também pelo README do próprio pacote ("Windows 10 2004+"), pelo
 * `win-capture-audio` ("usable since Windows 10 version 2004") e por usuários do
 * OBS capturando áudio por aplicativo em Windows 10 22H2 (build 19045).
 *
 * Este portão existe só para recusar o que comprovadamente não tem a API. A
 * barreira que vale de verdade é tentar `start()` e tratar a falha: o HRESULT é
 * quem sabe a resposta desta máquina. Vale lembrar que `os.release()` devolve
 * "10.0.19045" SEM a revisão, então o número nem carrega a informação que
 * separa uma máquina atualizada de uma parada em 2020 — mais uma razão para o
 * portão não ser a decisão final.
 */
export const MIN_WINDOWS_BUILD_FOR_PROCESS_LOOPBACK = 19041

/**
 * Quanto tempo sem NENHUM chunk antes de avisar "não chegou áudio".
 *
 * Não pode ser curto, e o motivo não é UX: o addon DESCARTA buffers
 * silenciosos (`IsBufferSilent`, limiar -70 dBFS,
 * `package/src/LoopbackCapture.cpp:514`). "Nenhum chunk" durante um trecho
 * quieto é comportamento NORMAL, não falha — não existe fluxo contínuo, e
 * ninguém pode usar a chegada de chunks como relógio (Armadilha 8 da
 * pesquisa).
 *
 * O watchdog não existe para parar nada; existe para que o modo de falha
 * "iniciou sem erro e só chegam zeros" (issue #414 do
 * `microsoft/Windows-classic-samples`, com o Teams) apareça como aviso legível
 * em vez de silêncio inexplicado.
 */
export const SILENCE_WATCHDOG_MS = 15_000

/**
 * O formato entregue pelo addon. FIXADO no C++ do pacote
 * (`LoopbackCapture.cpp:171-175`), não negociado — ver
 * `ScreenShareAudioStartResult` para saber por que ele viaja no resultado.
 */
export type ScreenShareAudioFormat = {
  /** 48000, fixado no C++ do pacote. */
  sampleRate: number
  /** 2 (estéreo intercalado). */
  channels: number
  /** 16, little-endian. */
  bitsPerSample: number
}

export type ScreenShareAudioUnavailableReason =
  /** WSL2/Linux/macOS: o recurso é Win32 puro. É o único caminho que roda de verdade no ambiente de desenvolvimento. */
  | 'not-windows'
  /** Build < MIN_WINDOWS_BUILD_FOR_PROCESS_LOOPBACK. */
  | 'windows-too-old'
  /** O `require` falhou: arquitetura errada, `.node` ausente, empacotado dentro do asar. */
  | 'addon-unavailable'
  /** O addon lançou ao iniciar; `detail` carrega o HRESULT, que é quem distingue os casos. */
  | 'start-failed'

export type ScreenShareAudioCapability =
  | { supported: true }
  | { supported: false; reason: ScreenShareAudioUnavailableReason; detail?: string }

/**
 * `format` viaja no RESULTADO do start de propósito: o renderer não duplica
 * 48000/2/16 como constante própria — ele usa o formato que o main disse que
 * está entregando. Duplicar seria criar duas fontes da verdade para um número
 * que mora no C++ de um pacote de terceiro.
 */
export type ScreenShareAudioStartResult =
  | { ok: true; format: ScreenShareAudioFormat }
  | { ok: false; reason: ScreenShareAudioUnavailableReason; detail?: string }

export type ScreenShareAudioStatus =
  | { kind: 'capturing' }
  /** Watchdog: nada chegou em SILENCE_WATCHDOG_MS. A captura continua viva. */
  | { kind: 'no-audio-yet' }
  | { kind: 'stopped' }
  | { kind: 'failed'; reason: ScreenShareAudioUnavailableReason; detail?: string }
