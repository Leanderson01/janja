import type { PlatformCapabilities } from '@/platform/contract'

/**
 * O que o alvo Electron sabe fazer.
 *
 * A anotação de tipo explícita (`: PlatformCapabilities`) não é decoração: é
 * ela que faz o compilador reprovar uma implementação que divergir do
 * contrato, e ela é checada DUAS vezes — em `typecheck:web` (este arquivo como
 * `@platform`) e em `typecheck:web-target` (onde `@platform` é o outro lado).
 */
export const capabilities: PlatformCapabilities = {
  target: 'electron',
  // Ver o comentário de `buildTargetSentinel` em contract.ts: literal de
  // string porque é o que sobrevive à minificação.
  buildTargetSentinel: 'hydra-platform:electron',
  // `uiohook-napi` no processo main: a tecla é capturada com o app sem foco.
  globalPushToTalk: true,
  // `ScreenSharePicker` — o app desenha o próprio seletor de fonte.
  ownScreenSourcePicker: true,
  // WASAPI por processo, excluindo a árvore do próprio app (Fase 8.6).
  screenShareAudio: 'process-exclude',
  // Instância única, deep link `janja://`, bandeja, atualização automática.
  desktopIntegration: true
}
