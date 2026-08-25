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
// Este arquivo é deliberadamente livre de imports de RUNTIME: é bundlado
// dentro do preload (e type-checkado junto do renderer), onde `electron` do
// processo main não pode entrar. O único import abaixo é `import type` sobre
// o outro arquivo de contrato desta feature (`screenshare-audio-types.ts`),
// que é igualmente livre de imports de runtime — some na compilação e não
// arrasta nada para o bundle.
import type { ScreenShareAudioUnavailableReason } from './screenshare-audio-types'

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
 * `audioAvailable` MUDOU DE SIGNIFICADO na Fase 8.6. Ele era
 * `request.audioRequested` do `setDisplayMediaRequestHandler` — "o renderer
 * chegou a PEDIR áudio nesta chamada?" —, e era assim porque a constraint de
 * áudio ficava fixada ANTES de o diálogo abrir: ligar o toggle lá dentro só
 * valia a partir do compartilhamento seguinte.
 *
 * Agora ele é `isProcessAudioSupported().supported`: **"esta máquina suporta
 * áudio por processo?"**. Nada de áudio é fixado antes do diálogo (o
 * `getDisplayMedia` é só vídeo, e a captura por processo começa DEPOIS que o
 * seletor fecha), então ligar o toggle dentro do diálogo passa a valer
 * imediatamente, para ESTA transmissão. O aviso de "vale a partir do próximo
 * compartilhamento" deixou de existir junto com a causa dele.
 *
 * O tipo é o mesmo (`boolean`) e o nome é o mesmo — de propósito: quem
 * consome continua respondendo à mesma pergunta de tela ("dá para oferecer o
 * toggle?"), só que agora com a resposta certa.
 */
export interface ScreenSharePickRequest {
  sources: ScreenShareSource[]
  audioAvailable: boolean
  /**
   * Presente só quando `audioAvailable` é `false`: POR QUE esta máquina não
   * consegue. É o que permite ao diálogo dizer "precisa do Windows 11" em vez
   * de apenas desabilitar um toggle sem explicação.
   */
  audioUnavailableReason?: ScreenShareAudioUnavailableReason
}

/**
 * A decisão do usuário, viajando do diálogo até o `callback` do
 * `setDisplayMediaRequestHandler`.
 *
 * ------------------------------------------------------------------
 * A história, porque ela explica por que este campo existe e por que ele NÃO
 * decide mais nada no processo main.
 *
 * Pitfall 1 (PITFALLS.md), 2026-08-20: quatro pessoas numa call, uma
 * compartilhando tela com áudio, e as outras três se ouvindo de volta. Havia
 * dois lados capazes de decidir sobre o áudio de sistema e eles não
 * conversavam: o renderer, ao montar as constraints de `getDisplayMedia()`;
 * e o processo main, ao conceder `audio: 'loopback'` no `callback`. PEDIR não
 * é o mesmo que CONCEDER, e só a concessão cria a captura WASAPI.
 *
 * O FIX daquele dia amarrou os dois lados num E lógico
 * (`request.audioRequested` E `choice.systemAudio`), com o lado restritivo
 * vencendo. Funcionou como analgésico — e cobrou o preço de o toggle só valer
 * a partir do compartilhamento SEGUINTE, porque a constraint já estava
 * fechada quando o diálogo abria.
 *
 * **Na Fase 8.6 o E lógico morreu, e não porque a solução ficou melhor: é a
 * PORTA que foi fechada.** O loopback de dispositivo captura a saída inteira
 * da placa por definição — nenhuma combinação de flags muda isso. Então o
 * main deixou de conceder áudio em qualquer caminho
 * (`callback({ video })`, incondicional), e o áudio passou a vir de uma
 * captura WASAPI POR PROCESSO em modo EXCLUIR
 * (`src/main/screenshare-audio.ts`), publicada como track separada pelo
 * renderer.
 *
 * `systemAudio` continua viajando por aqui e continua sendo a vontade do
 * usuário — mas quem age sobre ela agora é o RENDERER, depois que o seletor
 * fecha. O main só a registra no log.
 * ------------------------------------------------------------------
 */
export interface ScreenShareChoice {
  /** Id opaco vindo de `ScreenShareSource.id`. */
  sourceId: string
  /**
   * `true` só quando o usuário deixou o toggle do diálogo ligado. Qualquer
   * outro valor é tratado como `false` no processo main — a direção segura é
   * a direção padrão, igual ao `sanitize` de `screenshare-preferences.ts`.
   *
   * O processo main não decide nada com este campo (ver o bloco acima): ele
   * chega, é logado, e a ação acontece no renderer, que relê a preferência
   * persistida assim que o seletor fecha.
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
