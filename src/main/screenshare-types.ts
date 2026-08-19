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
  /** renderer -> main, uma via: o usuário escolheu esta fonte. */
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
