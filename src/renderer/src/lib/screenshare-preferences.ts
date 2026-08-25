// Preferência de qualidade do compartilhamento de tela (Plano 08-05,
// SHARE-08): estado de MÁQUINA, não de conta — exatamente o mesmo raciocínio
// de `voice-preferences.ts` (07-05). O mesmo usuário tem upload doméstico
// diferente em cada computador: o desktop na fibra aguenta 1080p, o notebook
// no 4G da casa da mãe não. Guardar isso no Convex faria a escolha viajar
// junto com a conta para a máquina errada.
//
// A escolha vale para a PRÓXIMA vez que compartilhar: `startScreenShare()`
// (voice-context.tsx) relê este módulo a cada início. Trocar de qualidade
// não reinicia um compartilhamento em andamento — reiniciar a track
// derrubaria a imagem de quem está assistindo, e ninguém pede isso ao mexer
// num toggle.

export type ScreenShareQuality = 'fluida' | 'nitida'

export type ScreenSharePreferences = {
  /**
   * 'fluida' → 720p a 30fps (`ScreenSharePresets.h720fps30`, `contentHint:
   * 'motion'`): prioriza movimento contínuo, sobrevive a upload instável.
   * 'nitida' → 1080p a 15fps (`ScreenSharePresets.h1080fps15`, `contentHint:
   * 'detail'`): prioriza resolução, para texto/código legível.
   * Mapeamento em `08-RESEARCH.md §5`; a tradução para os presets do SDK
   * mora em `voice-context.tsx`, não aqui — este módulo não importa
   * `livekit-client` de propósito, para continuar sendo só persistência.
   */
  quality: ScreenShareQuality
  /**
   * Se o áudio do computador acompanha o compartilhamento.
   *
   * Mesmo nome, mesmo tipo e mesmo default de antes da Fase 8.6 — o que
   * mudou é o que ele LIGA. Era loopback de DISPOSITIVO (tudo que sai pela
   * saída de som, inclusive a voz dos outros participantes que este app está
   * tocando: o eco do Pitfall 1). Passou a ser loopback POR PROCESSO em modo
   * EXCLUIR (`src/main/screenshare-audio.ts`): o Windows captura o
   * computador inteiro MENOS a árvore de processos deste app, então a voz
   * dos outros fica de fora e o Spotify não.
   *
   * Continua sendo estado de MÁQUINA, e agora por um motivo a mais: a
   * capacidade é do computador (Windows 11+, addon carregado). Guardar isso
   * na conta faria a escolha viajar para uma máquina que não suporta.
   *
   * Lido em dois lugares, com papéis diferentes:
   *  - o caminho de captura relê esta preferência ao iniciar o áudio, DEPOIS
   *    que o seletor fecha — por isso ligar vale já para a transmissão atual;
   *  - `ScreenSharePicker.tsx` inicializa o toggle do diálogo, e o valor que
   *    o usuário deixar lá viaja com a fonte escolhida até o processo main,
   *    que é quem de fato inicia (ou não) a captura.
   */
  systemAudio: boolean
}

const STORAGE_KEY = 'janja:screenshare-preferences'

// 'fluida' é o default deliberado: o público do projeto é um grupo de amigos
// em upload doméstico brasileiro, e o modo de falha de "nítida" numa conexão
// fraca (imagem travando em slideshow) é bem pior que o de "fluida" numa
// conexão boa (texto um pouco menos nítido).
//
// `systemAudio: false` é o default pelo mesmo tipo de raciocínio — qual modo
// de falha é pior — e continua `false` depois da Fase 8.6 por uma razão que
// não é mais o eco de dispositivo: NADA desta fase foi verificado em Windows
// ainda. Ligar por engano manda para a call o áudio da máquina inteira
// (música, chamada de vídeo em outra aba, notificação) e, se a premissa mais
// frágil da fase for falsa, a voz dos outros participantes junto. Não ligar
// custa uma tela sem som. Tela muda é um aborrecimento; a call inteira
// ouvindo o que você estava ouvindo é um defeito — e um vazamento.
//
// PARA INVERTER ESTE DEFAULT (uma linha, mais o teste que a protege): o
// item nº 1 do checkpoint 08.6-06 precisa estar confirmado — 3+ pessoas numa
// call real, no Windows, compartilhando com o áudio ligado, e NINGUÉM se
// ouvindo de volta. É o item que prova a premissa de que o serviço de áudio
// do Chromium (quem toca a voz dos outros) é filho do processo-navegador e
// portanto cai dentro da árvore EXCLUÍDA da captura — a afirmação mais
// frágil da pesquisa, sem confirmação oficial explícita. Enquanto ela não
// for observada em máquina de verdade, um default ligado reintroduziria o
// defeito de 2026-08-20 para todo mundo de uma vez, por padrão.
//
// `screenshare-preferences.test.ts` tem uma asserção explícita sobre este
// valor, com nome autoexplicativo: inverter o default é sempre uma decisão
// DELIBERADA que quebra um teste, nunca um efeito colateral.
export const DEFAULT_SCREEN_SHARE_PREFERENCES: ScreenSharePreferences = {
  quality: 'fluida',
  systemAudio: false
}

function isScreenShareQuality(value: unknown): value is ScreenShareQuality {
  return value === 'fluida' || value === 'nitida'
}

function sanitize(raw: unknown): ScreenSharePreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SCREEN_SHARE_PREFERENCES

  const candidate = raw as Partial<Record<keyof ScreenSharePreferences, unknown>>

  const quality = isScreenShareQuality(candidate.quality)
    ? candidate.quality
    : DEFAULT_SCREEN_SHARE_PREFERENCES.quality

  // Qualquer coisa que não seja um booleano cai no default, e o default é
  // `false`: um JSON velho (gravado antes deste campo existir), corrompido ou
  // adulterado nunca deve LIGAR o áudio do computador por acidente. A direção
  // segura tem que ser a direção padrão — e ela ficou mais importante, não
  // menos, agora que ligado significa mandar o computador inteiro para a
  // call.
  const systemAudio =
    typeof candidate.systemAudio === 'boolean'
      ? candidate.systemAudio
      : DEFAULT_SCREEN_SHARE_PREFERENCES.systemAudio

  return { quality, systemAudio }
}

// Nunca lança — `localStorage` ausente/corrompido/indisponível (modo privado,
// quota, ambiente sem DOM) sempre cai no default. Mesmo padrão defensivo de
// `loadVoicePreferences` (07-05): esta função é chamada no caminho de iniciar
// um compartilhamento, e uma exceção aqui derrubaria o compartilhamento
// inteiro por causa de uma preferência cosmética.
export function loadScreenSharePreferences(): ScreenSharePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SCREEN_SHARE_PREFERENCES
    return sanitize(JSON.parse(raw))
  } catch {
    return DEFAULT_SCREEN_SHARE_PREFERENCES
  }
}

// Faz merge com o valor persistido atual (não com o default) — hoje só existe
// um campo, mas a assinatura é a mesma de `saveVoicePreferences` para que
// acrescentar um segundo campo depois não vire uma mudança de contrato que
// silenciosamente reseta o primeiro.
export function saveScreenSharePreferences(
  partial: Partial<ScreenSharePreferences>
): ScreenSharePreferences {
  const next = sanitize({ ...loadScreenSharePreferences(), ...partial })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota excedida ou storage indisponível: a escolha só não persiste
    // entre reinícios, não deve derrubar a UI que chamou isto.
  }
  return next
}
