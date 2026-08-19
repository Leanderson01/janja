import { useEffect, useRef } from 'react'
import { useQuery } from 'convex/react'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'

import { loadVoicePreferences } from './voice-preferences'
import { useSelection } from '../state/selection-context'
import { useVoice } from '../state/voice-context'

// VOICE-17 (Plano 07-07): sons de entrada/saída do canal de voz conectado.
//
// Deliberadamente NÃO observa o `Room` do LiveKit — só o dado reativo do
// Convex (`voiceStates`, via `voiceParticipantsByChannel` do Plano 07-04),
// restrito ao canal em `joinedVoiceChannelId`. Isso mantém este hook livre
// de qualquer lógica de conexão (fila serializada, guarda de conexão
// duplicada etc. já vivem em `voice-context.tsx` — não duplicar aqui).
//
// Assets de áudio: o plano original listava dois arquivos `.mp3` em
// `resources/sounds/`. Este projeto não pode baixar nem produzir áudio de
// qualidade de produção, e sons "estilo Discord" prontos são conteúdo de
// terceiros com direito autoral — inaceitável para distribuir num
// instalador, mesmo para 10 amigos. Os quatro tons abaixo são sintetizados
// em runtime via Web Audio API (osciladores + envelope de ganho): zero
// asset binário, zero questão de licenciamento, fácil de recalibrar depois
// só mexendo em números.
//
// Quatro tons distintos, não dois, porque o requisito (FEATURES.md, "Sons
// de entrar/sair de canal de voz") exige distinguir "eu entrei" de "alguém
// entrou" — o texto do Plano 07-07 (Task 2) descrevia originalmente o MESMO
// arquivo `voice-join.mp3` para os dois casos, o que não cumpre esse
// requisito. Resolvido tocando um "chime" de duas notas para eventos do
// PRÓPRIO usuário (mais rico, mais perceptível — é sobre você) e um
// "sweep" de nota única para eventos de OUTRO participante (mais discreto).
// Direção (sobe/desce) sempre marca entrada/saída dentro de cada família.

type ToneNote = { freq: number; start: number; duration: number }

let sharedAudioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioContextCtor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return null
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextCtor()
  }
  return sharedAudioContext
}

const TONE_PEAK_GAIN = 0.16

/** Agenda uma sequência de notas (osciladores senoidais com envelope de
 * ataque/decaimento curto, evitando "clique" de borda) sobre um
 * `AudioContext` compartilhado. Nunca lança para quem chama — falha de
 * áudio (contexto bloqueado, autoplay policy etc.) não pode derrubar o
 * app. */
function playTone(notes: ToneNote[]): void {
  try {
    const ctx = getAudioContext()
    if (!ctx) return
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    const now = ctx.currentTime
    notes.forEach(({ freq, start, duration }) => {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = freq
      const startTime = now + start
      const endTime = startTime + duration
      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(TONE_PEAK_GAIN, startTime + 0.012)
      gain.gain.linearRampToValueAtTime(0, endTime)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(startTime)
      oscillator.stop(endTime + 0.03)
    })
  } catch (err) {
    console.error('[voice] falha ao tocar som de canal', err)
  }
}

// "Eu entrei"/"eu saí": chime de duas notas, sobe para entrada, desce para
// saída — a família mais perceptível, porque é sobre o próprio usuário.
function playSelfJoinTone(): void {
  playTone([
    { freq: 523, start: 0, duration: 0.09 },
    { freq: 784, start: 0.09, duration: 0.14 }
  ])
}
function playSelfLeaveTone(): void {
  playTone([
    { freq: 659, start: 0, duration: 0.09 },
    { freq: 415, start: 0.09, duration: 0.14 }
  ])
}

// "Alguém entrou"/"alguém saiu": nota única, mais discreta — a diferença de
// timbre/duração em relação ao chime acima é o que torna os dois eventos
// distinguíveis de ouvido, sem precisar olhar a tela.
function playOtherJoinTone(): void {
  playTone([{ freq: 660, start: 0, duration: 0.11 }])
}
function playOtherLeaveTone(): void {
  playTone([{ freq: 440, start: 0, duration: 0.11 }])
}

// Janela de supressão do som de saída quando o mesmo `userId` some e volta
// a aparecer rapidamente — reconexão/flutuação de rede reconciliada pelo
// webhook do Plano 07-02, não uma saída real (mesma classe de problema do
// ghost-user). Documentado no Plano 07-07 como limitação aceita, não
// garantia formal: se o webhook demorar mais que isso para remover a linha
// depois de um crash de verdade, ainda pode soar um "saiu" isolado e tardio.
const RECONNECT_GRACE_MS = 2000

export function useVoiceJoinLeaveSounds(): void {
  const { joinedVoiceChannelId } = useSelection()
  const { room } = useVoice()

  const participants = useQuery(
    api.voice.voiceParticipantsByChannel,
    joinedVoiceChannelId ? { channelId: joinedVoiceChannelId } : 'skip'
  )

  // `null` = ainda sem baseline para o canal atual (próxima leitura de
  // dado é só o ponto de partida, não dispara som nenhum — senão entrar
  // num canal com 3 pessoas já dentro tocaria 3 sons de entrada de uma
  // vez). Resetado sempre que `joinedVoiceChannelId` muda.
  const baselineIdsRef = useRef<Set<Id<'users'>> | null>(null)
  const lastChannelRef = useRef<Id<'channels'> | null>(null)

  // `userId` -> timeout pendente de tocar o som de saída, aguardando a
  // janela de graça de reconexão (`RECONNECT_GRACE_MS`) antes de confirmar
  // que a saída é real.
  const pendingLeaveTimeoutsRef = useRef<Map<Id<'users'>, ReturnType<typeof setTimeout>>>(new Map())

  // Sempre a leitura mais recente de `participants`, independente de o
  // efeito abaixo ter detectado diff ou retornado cedo — usado dentro dos
  // `setTimeout` de saída agendada para checar `deafened` no MOMENTO em que
  // o som de fato dispara (2s depois), não no momento em que a saída foi
  // detectada.
  const latestParticipantsRef = useRef(participants)

  function clearAllPendingLeaves(): void {
    pendingLeaveTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
    pendingLeaveTimeoutsRef.current.clear()
  }

  // Troca de canal (incluindo virar `null`, ou seja, o usuário saiu por
  // vontade própria): reseta o baseline e cancela qualquer som de saída
  // pendente da sessão anterior — nunca deixa um timeout de uma call
  // antiga disparar som sobre o canal novo (ou sobre nenhum canal).
  useEffect(() => {
    if (lastChannelRef.current === joinedVoiceChannelId) return
    lastChannelRef.current = joinedVoiceChannelId
    baselineIdsRef.current = null
    clearAllPendingLeaves()
  }, [joinedVoiceChannelId])

  // Higiene ao desmontar (troca de servidor não desmonta este hook — ele
  // vive dentro de `VoiceControlBar`, que é parte fixa do shell — mas cobre
  // hot-reload/fechamento do app de forma defensiva).
  useEffect(() => {
    return () => {
      clearAllPendingLeaves()
    }
  }, [])

  useEffect(() => {
    latestParticipantsRef.current = participants

    if (!joinedVoiceChannelId) return
    if (participants === undefined) return // ainda carregando

    const currentIds = new Set(participants.map((p) => p.userId))

    if (baselineIdsRef.current === null) {
      // Primeira leitura de dado para este canal: só estabelece o ponto de
      // partida, nenhum som toca para quem já está presente.
      baselineIdsRef.current = currentIds
      return
    }

    const previousIds = baselineIdsRef.current
    baselineIdsRef.current = currentIds

    const joinedIds: Id<'users'>[] = []
    currentIds.forEach((id) => {
      if (!previousIds.has(id)) joinedIds.push(id)
    })
    const leftIds: Id<'users'>[] = []
    previousIds.forEach((id) => {
      if (!currentIds.has(id)) leftIds.push(id)
    })

    if (joinedIds.length === 0 && leftIds.length === 0) return

    // Nada toca se a preferência estiver desligada, ou se o próprio usuário
    // estiver ensurdecido agora — quem ensurdeceu a si mesmo não deve ouvir
    // som de notificação nenhum. `deafened` vem do próprio dado que já
    // buscamos (a linha do usuário autenticado é uma das linhas de
    // `participants`), sem precisar de outra fonte.
    const prefs = loadVoicePreferences()
    if (!prefs.soundsEnabled) return

    const selfId = room.localParticipant.identity as Id<'users'> | ''
    const selfRow = selfId ? participants.find((p) => p.userId === selfId) : undefined
    if (selfRow?.deafened) return

    // Reconciliação contra flutuação de rede: um ID que voltou a aparecer
    // cancela o som de saída pendente daquele mesmo ID e NÃO conta como uma
    // entrada nova (a pessoa nunca "saiu" do ponto de vista de quem ouve).
    const reallyJoinedIds = joinedIds.filter((id) => {
      const pendingLeave = pendingLeaveTimeoutsRef.current.get(id)
      if (pendingLeave) {
        clearTimeout(pendingLeave)
        pendingLeaveTimeoutsRef.current.delete(id)
        return false
      }
      return true
    })

    // No máximo um toque de som de ENTRADA por tick de diff, mesmo que
    // várias pessoas entrem "ao mesmo tempo" (mesmo batch reativo do
    // Convex) — o próprio usuário tem prioridade sobre "alguém entrou" se,
    // por coincidência de timing, os dois acontecerem no mesmo tick.
    if (reallyJoinedIds.length > 0) {
      if (selfId && reallyJoinedIds.includes(selfId)) {
        playSelfJoinTone()
      } else {
        playOtherJoinTone()
      }
    }

    // Saída: nunca toca na hora — agenda depois da janela de graça, para
    // dar chance de uma reconexão rápida cancelar o som (ver acima). No
    // máximo um som de saída agendado por tick, mesma regra de não
    // duplicar toques simultâneos.
    if (leftIds.length > 0) {
      const isSelfLeaving = selfId !== '' && leftIds.includes(selfId)
      const representativeId = leftIds[0]
      if (
        representativeId !== undefined &&
        !pendingLeaveTimeoutsRef.current.has(representativeId)
      ) {
        const timeout = setTimeout(() => {
          pendingLeaveTimeoutsRef.current.delete(representativeId)
          // Relê a preferência/deafen no momento em que o som realmente
          // dispara — o usuário pode ter desligado o toggle ou ensurdecido
          // durante a janela de graça.
          const latestPrefs = loadVoicePreferences()
          if (!latestPrefs.soundsEnabled) return
          const latestSelfId = room.localParticipant.identity as Id<'users'> | ''
          const latestSelfRow = latestSelfId
            ? latestParticipantsRef.current?.find((p) => p.userId === latestSelfId)
            : undefined
          if (latestSelfRow?.deafened) return
          if (isSelfLeaving) {
            playSelfLeaveTone()
          } else {
            playOtherLeaveTone()
          }
        }, RECONNECT_GRACE_MS)
        pendingLeaveTimeoutsRef.current.set(representativeId, timeout)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants, joinedVoiceChannelId])
}
