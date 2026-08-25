/**
 * O VEREDITO do áudio de compartilhamento de tela no alvo WEB.
 *
 * ------------------------------------------------------------------
 * O QUE PROCURAR NO CONSOLE (DevTools do Chrome, aba Console): a palavra
 * `VEREDITO`. É UMA linha, impressa a cada compartilhamento iniciado, e ela
 * carrega os três valores que o navegador respondeu. Para o experimento do
 * eco (Plano 10-09), essa linha é o dado — o relato de quem estava na call,
 * sozinho, não distingue os três resultados possíveis.
 * ------------------------------------------------------------------
 *
 * POR QUE ISTO EXISTE, E POR QUE NÃO BASTA PEDIR A CONSTRAINT.
 *
 * `restrictOwnAudio: true` é pedida em `platform/web/screenshare.tsx`, dentro
 * de `audio: { ... }`. Pedir não é obter. A especificação diz que a remoção é
 * *best-effort*: se o processamento falhar, o agente pode excluir TODO o áudio
 * originado da aba capturadora — ou não excluir nada. Nos dois casos a Promise
 * resolve, o compartilhamento funciona e nada é dito.
 *
 * Esta é exatamente a armadilha que custou dois dias no desktop em 2026-08-20:
 * `getSupportedConstraints()` respondia `true`, a constraint era aceita sem
 * erro, e o eco acontecia mesmo assim. A lição não foi "a flag é ruim" — foi
 * **ler de volta o que a track REALMENTE tem** (`getSettings()`) em vez de
 * confiar no que foi pedido.
 *
 * ------------------------------------------------------------------
 * A MATRIZ DO CHROME NO WINDOWS — é ela que torna as regras abaixo legíveis:
 *
 * | Superfície        | Vídeo | Áudio                                                                      |
 * |-------------------|-------|----------------------------------------------------------------------------|
 * | Aba (`browser`)   | sim   | sim — só o áudio daquela aba, **sem eco por construção**                     |
 * | Janela (`window`) | sim   | **não existe** no Chrome/Windows (issue 40947205 do Chromium)                |
 * | Tela (`monitor`)  | sim   | sim, com `systemAudio: 'include'` — e é o áudio do sistema INTEIRO, que      |
 * |                   |       | inclui a voz dos outros que a NOSSA PRÓPRIA aba está tocando. É aqui que o   |
 * |                   |       | eco nasce, e é aqui que `restrictOwnAudio` tem o que fazer.                  |
 * ------------------------------------------------------------------
 *
 * Quem escolhe a superfície é a PESSOA, no diálogo nativo do Chrome. O app não
 * escolhe por ela — mas pode dizer o que aconteceu, e é isso que este módulo é.
 *
 * Sem DOM, sem LiveKit, sem navegador: recebe só o que já foi lido, para poder
 * ser provado por teste.
 */

/** Prefixo de TODA linha deste módulo. É o que se procura/grepa no console. */
export const WEB_SCREENSHARE_AUDIO_LOG_PREFIX = '[screenshare-web]'

export type WebScreenShareAudioInput = {
  /** A captura trouxe alguma faixa de áudio? */
  hasAudioTrack: boolean
  /** `getSettings().displaySurface` da faixa de VÍDEO: 'browser' | 'window' | 'monitor' | undefined */
  displaySurface?: string
  /**
   * `getSettings().restrictOwnAudio` da faixa de ÁUDIO. `undefined` = o
   * navegador nem reporta a propriedade (Chrome < 141, ou não-Chromium).
   */
  restrictOwnAudio?: boolean
}

export type WebScreenShareAudioVerdictKind =
  | 'no-audio-window'
  | 'no-audio-declined'
  | 'audio-protected'
  | 'audio-unprotected'
  | 'audio-unknown-support'

export type WebScreenShareAudioVerdict = {
  kind: WebScreenShareAudioVerdictKind
  /** Frase curta, em português, para a pessoa. `null` quando não há o que dizer. */
  message: string | null
  /** Linha longa para o console — é a que serve ao experimento do eco. */
  log: string
}

/**
 * Os três valores de entrada, sempre no fim da linha, sempre no mesmo formato.
 *
 * Isto NÃO é zelo: é a instrumentação do experimento do Plano 10-09. Sem os
 * três juntos, "não houve eco porque o filtro funcionou", "não houve eco por
 * acaso" e "a flag nem existe neste Chrome" são indistinguíveis pelo relato de
 * quem estava na call.
 */
function entradas(input: WebScreenShareAudioInput): string {
  return (
    `Entradas: hasAudioTrack=${String(input.hasAudioTrack)}, ` +
    `displaySurface=${input.displaySurface ?? 'undefined'}, ` +
    `restrictOwnAudio=${input.restrictOwnAudio === undefined ? 'undefined' : String(input.restrictOwnAudio)}.`
  )
}

/**
 * O que a superfície escolhida significa PARA O EXPERIMENTO DO ECO.
 *
 * Existe por um motivo específico e caro: se a pessoa compartilhou uma ABA,
 * "não houve eco" não prova nada sobre `restrictOwnAudio` — aba não tem eco por
 * construção, com ou sem a flag. Sem esta frase, um teste feito com aba seria
 * lido como prova de que a flag funciona, e a Fase 8.6 do desktop seria julgada
 * por um experimento que não testou nada.
 */
function notaDaSuperficie(displaySurface: string | undefined): string {
  if (displaySurface === 'browser') {
    return (
      'ATENÇÃO PARA O EXPERIMENTO DO ECO: a superfície é uma ABA, que já é livre de eco ' +
      'POR CONSTRUÇÃO (o Chrome captura o áudio daquela aba, não do dispositivo de saída). ' +
      'Ausência de eco aqui NÃO prova nada sobre restrictOwnAudio — para testar a flag, ' +
      'compartilhe a TELA INTEIRA.'
    )
  }
  if (displaySurface === 'monitor') {
    return (
      'A superfície é a TELA INTEIRA: este é o caso que interessa ao experimento do eco, ' +
      'porque o áudio capturado é o do sistema INTEIRO — inclusive a voz dos outros ' +
      'participantes, que esta própria aba está tocando.'
    )
  }
  return (
    'Superfície não reportada por este navegador (displaySurface ausente em getSettings()): ' +
    'para o experimento do eco, confirme na tela o que foi escolhido antes de interpretar.'
  )
}

/**
 * Traduz o que o navegador concedeu em veredito + texto para a pessoa.
 *
 * As cinco regras, NA ORDEM DE AVALIAÇÃO (a ordem importa: a regra 1 é um caso
 * particular da 2, e inverter as duas faria "compartilhei uma janela e não saiu
 * som" ser explicado como "você não marcou a caixinha" — culpando a pessoa por
 * uma limitação do Chrome).
 */
export function describeWebScreenShareAudio(
  input: WebScreenShareAudioInput
): WebScreenShareAudioVerdict {
  const { hasAudioTrack, displaySurface, restrictOwnAudio } = input

  // Regra 1 — janela é sempre muda no Chrome/Windows. Esta é a ÚNICA das cinco
  // que a pessoa PRECISA ler: sem ela, ela descobre que ninguém ouviu nada
  // depois de dez minutos transmitindo.
  if (!hasAudioTrack && displaySurface === 'window') {
    return {
      kind: 'no-audio-window',
      message:
        'Sua transmissão está indo SEM SOM: no Chrome, compartilhar uma JANELA nunca leva ' +
        'áudio. Para levar o som, pare e compartilhe uma aba ou a tela inteira.',
      log:
        `${WEB_SCREENSHARE_AUDIO_LOG_PREFIX} VEREDITO no-audio-window: a captura veio SEM faixa de ` +
        'áudio, e a superfície escolhida foi JANELA. Não é defeito do app nem escolha de quem ' +
        'compartilhou: o Chrome no Windows não captura áudio de janela (issue 40947205 do ' +
        'Chromium). A pergunta sobre restrictOwnAudio não se coloca — não há áudio a filtrar. ' +
        entradas(input)
    }
  }

  // Regra 2 — qualquer outra superfície sem áudio: a caixinha do diálogo não
  // foi marcada. Sem culpar ninguém: é uma caixinha fácil de não ver.
  if (!hasAudioTrack) {
    return {
      kind: 'no-audio-declined',
      message:
        'Sua transmissão está indo SEM SOM: a caixinha "Compartilhar áudio da guia/do sistema" ' +
        'não foi marcada no diálogo do Chrome. Para levar o som, pare e compartilhe de novo ' +
        'marcando a caixinha.',
      log:
        `${WEB_SCREENSHARE_AUDIO_LOG_PREFIX} VEREDITO no-audio-declined: a captura veio SEM faixa ` +
        'de áudio numa superfície que SUPORTA áudio. A caixinha existiu no diálogo (é o que ' +
        "`systemAudio: 'include'` compra) e não foi marcada. restrictOwnAudio não se aplica: não " +
        'há áudio capturado a filtrar. ' +
        entradas(input)
    }
  }

  // Regra 3 — o pedido foi ACEITO e APLICADO. Não há nada a dizer à pessoa
  // quando dá certo; a linha de log existe para o experimento.
  if (restrictOwnAudio === true) {
    return {
      kind: 'audio-protected',
      message: null,
      log:
        `${WEB_SCREENSHARE_AUDIO_LOG_PREFIX} VEREDITO audio-protected: a faixa de áudio foi ` +
        'publicada e o Chrome CONFIRMOU restrictOwnAudio=true em getSettings() — o pedido de ' +
        'excluir da captura o áudio que ESTA aba está tocando (ou seja, a voz dos outros ' +
        'participantes) foi aceito E aplicado. ' +
        notaDaSuperficie(displaySurface) +
        ' ' +
        entradas(input)
    }
  }

  // Regra 4 — o pedido foi feito e NEGADO. É o caso em que o eco é esperado, e
  // a pessoa precisa saber antes de alguém reclamar na call.
  if (restrictOwnAudio === false) {
    return {
      kind: 'audio-unprotected',
      message:
        'Sua transmissão está indo COM SOM, mas o Chrome recusou o filtro de eco: quem estiver ' +
        'falando pode se ouvir de volta. Se acontecer, pare e compartilhe uma ABA em vez da ' +
        'tela inteira.',
      log:
        `${WEB_SCREENSHARE_AUDIO_LOG_PREFIX} VEREDITO audio-unprotected: a faixa de áudio foi ` +
        'publicada, o pedido de restrictOwnAudio FOI FEITO e o Chrome respondeu ' +
        'getSettings().restrictOwnAudio=FALSE — pedido reconhecido e NÃO aplicado. A captura ' +
        'inclui tudo que o sistema está tocando, inclusive a voz dos outros participantes que ' +
        'esta aba reproduz: ECO ESPERADO. ' +
        notaDaSuperficie(displaySurface) +
        ' ' +
        entradas(input)
    }
  }

  // Regra 5 — o navegador nem reporta a propriedade. Para o experimento do eco
  // este resultado INVALIDA a base de comparação: é o terceiro caso da §5.4 da
  // pesquisa da Fase 10, e o teste precisa ser refeito num Chrome >= 141.
  return {
    kind: 'audio-unknown-support',
    message:
      'Sua transmissão está indo COM SOM, mas este navegador não confirma o filtro de eco: quem ' +
      'estiver falando pode se ouvir de volta. Atualize o Chrome (141 ou mais novo) ou ' +
      'compartilhe uma ABA em vez da tela inteira.',
    log:
      `${WEB_SCREENSHARE_AUDIO_LOG_PREFIX} VEREDITO audio-unknown-support: a faixa de áudio foi ` +
      'publicada, mas este navegador não reporta `restrictOwnAudio` em getSettings() (veio ' +
      'undefined); a versão do Chrome precisa ser >= 141, em Windows ou Mac — confira em ' +
      'chrome://version. Não dá para saber se o filtro foi aplicado: trate como NÃO aplicado. ' +
      'Para o experimento do eco do Plano 10-09, este resultado INVALIDA a base de comparação e ' +
      'o teste precisa ser refeito num Chrome mais novo. ' +
      notaDaSuperficie(displaySurface) +
      ' ' +
      entradas(input)
  }
}
