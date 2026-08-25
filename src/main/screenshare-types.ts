// Contrato do seletor de tela (Plano 08-04), compartilhado pelos três lados:
// processo main (quem enumera e concede), preload (quem expõe os canais) e,
// via `src/preload/index.d.ts`, o renderer (quem desenha o diálogo).
//
// Por que este arquivo existe em vez de os canais serem duplicados como
// literal no preload (o padrão de `AUTH_CHANNELS`/`VOICE_CHANNELS`): um erro
// de digitação no nome do canal aqui não gera erro nenhum — gera exatamente o
// modo de falha do Pitfall 2. O `send` do renderer cai no vazio, a Promise que
// o processo main está aguardando nunca é resolvida por escolha nem por
// cancelamento, e o compartilhamento só destrava no timeout de 60s. Uma única
// definição torna essa classe de erro impossível.
//
// Este arquivo é deliberadamente livre de imports: é bundlado dentro do
// preload (e type-checkado junto do renderer), onde `electron` do processo
// main não pode entrar.

export const SCREENSHARE_CHANNELS = {
  /** main -> renderer: lista de fontes disponíveis, para o diálogo exibir. */
  PICK_REQUESTED: 'screenshare:pick-requested',
  /** renderer -> main, uma via: o usuário escolheu esta fonte (e se quer áudio). */
  CHOOSE_SOURCE: 'screenshare:choose-source',
  /** renderer -> main, uma via: o usuário fechou o diálogo sem escolher. */
  CANCEL_PICKER: 'screenshare:cancel-picker'
} as const

/**
 * Uma fonte de captura já pronta para atravessar o IPC.
 *
 * `DesktopCapturerSource.thumbnail`/`appIcon` são `NativeImage`, que NÃO é
 * serializável pelo algoritmo de clonagem estruturada do IPC do Electron — do
 * outro lado chegaria um objeto vazio. Por isso o processo main converte para
 * data URL (`toDataURL()`) antes de enviar, e o renderer nunca vê um
 * `NativeImage`.
 */
export interface ScreenShareSource {
  /** Id opaco do Electron (`screen:0:0`, `window:12345:0`). */
  id: string
  name: string
  /** PNG em data URL, pronto para `<img src>`. */
  thumbnailDataUrl: string
  /** Ícone do app dono da janela; ausente para telas e para janelas sem ícone. */
  appIconDataUrl?: string
  /** Derivado de `id.startsWith('screen:')` no processo main. */
  isScreen: boolean
}

/**
 * O que o processo main manda junto com a lista quando abre o seletor.
 *
 * `audioAvailable` é `request.audioRequested` do
 * `setDisplayMediaRequestHandler` — ou seja, se o renderer chegou a PEDIR
 * áudio nesta chamada de `getDisplayMedia()`. O seletor precisa saber disso
 * para não mentir: a constraint de áudio é fixada no momento da chamada, que
 * é ANTES de o diálogo abrir, então ligar o toggle com `audioAvailable:
 * false` não pode produzir áudio nesta transmissão por mais que o main
 * conceda. Ver `ScreenShareChoice` abaixo.
 */
export interface ScreenSharePickRequest {
  sources: ScreenShareSource[]
  audioAvailable: boolean
}

/**
 * A decisão do usuário, viajando do diálogo até o `callback` do
 * `setDisplayMediaRequestHandler`.
 *
 * ------------------------------------------------------------------
 * Pitfall 1 (PITFALLS.md), a correção do eco. Havia dois lados capazes de
 * decidir sobre o áudio de sistema e eles não conversavam:
 *
 *   - o renderer, ao montar as constraints de `getDisplayMedia()`
 *     (`SCREEN_SHARE_CAPTURE_OPTIONS` em `voice-context.tsx`);
 *   - o processo main, ao conceder `audio: 'loopback'` no `callback`.
 *
 * PEDIR não é o mesmo que CONCEDER, e só a concessão cria a captura WASAPI
 * que gera o eco. Enquanto o main concedia loopback incondicionalmente, o
 * renderer não tinha como desligar o áudio de sistema de verdade — no
 * máximo pedia gentilmente. Agora a regra é um E lógico explícito, e o lado
 * restritivo sempre vence:
 *
 *   loopback concedido  <=>  request.audioRequested  E  choice.systemAudio
 *
 * Compartilhar com `systemAudio: false` tem eco zero por construção: sem
 * concessão não existe track de áudio nenhuma para ecoar.
 * ------------------------------------------------------------------
 */
export interface ScreenShareChoice {
  /** Id opaco vindo de `ScreenShareSource.id`. */
  sourceId: string
  /**
   * `true` só quando o usuário deixou o toggle do diálogo ligado. Qualquer
   * outro valor é tratado como `false` no processo main — a direção segura é
   * a direção padrão, igual ao `sanitize` de `screenshare-preferences.ts`.
   */
  systemAudio: boolean
}

/** Tamanho das miniaturas pedidas ao `desktopCapturer` (16:9). */
export const THUMBNAIL_SIZE = { width: 320, height: 180 } as const

/**
 * Prazo máximo de espera pela decisão do usuário.
 *
 * Não é UX, é a rede de segurança do Pitfall 2: se o renderer travar, for
 * recarregado (F5/HMR) ou simplesmente nunca responder, o processo main
 * precisa destravar a Promise de `getDisplayMedia()` sozinho — senão a UI fica
 * carregando para sempre e TODA tentativa seguinte de compartilhar na mesma
 * sessão trava junto.
 */
export const PICKER_TIMEOUT_MS = 60_000
