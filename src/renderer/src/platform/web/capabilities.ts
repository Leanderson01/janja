import type { PlatformCapabilities } from '@/platform/contract'

/**
 * O que o alvo web sabe fazer — e, sobretudo, o que ele NÃO sabe.
 *
 * Este objeto é a fonte única dos textos de "paridade declarada" na interface:
 * a tela de configurações de voz lê `globalPushToTalk` para dizer "só com a
 * janela em foco", em vez de repetir a frase por tela.
 */
export const capabilities: PlatformCapabilities = {
  target: 'web',
  // Ver o comentário de `buildTargetSentinel` em contract.ts.
  buildTargetSentinel: 'hydra-platform:web',
  // Nenhuma API de navegador captura tecla fora de foco. A degradação é
  // `keydown`/`keyup` na window — e precisa estar DITA na UI.
  globalPushToTalk: false,
  // Quem desenha o seletor de fonte é o próprio Chrome, no diálogo nativo.
  ownScreenSourcePicker: false,
  // O áudio vem junto no `getDisplayMedia` da superfície escolhida (aba ou
  // tela inteira; janela é sempre muda no Chrome/Windows).
  screenShareAudio: 'browser-surface',
  // Sem processo main: sem bandeja, sem deep link, sem atualização automática
  // (a web já é sempre a última versão — e isso é vantagem, vale dizer na tela).
  desktopIntegration: false
}
