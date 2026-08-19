// Canais de IPC do hook global de push-to-talk (Plano 07-06), seguindo o
// mesmo padrão de src/main/auth/types.ts. O processo main nunca decide se o
// modo ativo é PTT ou VAD — só encaminha keydown/keyup da tecla fixa; quem
// decide agir sobre isso é o VoiceProvider no renderer (07-RESEARCH.md §7).
export const VOICE_CHANNELS = {
  PTT_KEY_DOWN: 'voice:ptt-key-down',
  PTT_KEY_UP: 'voice:ptt-key-up',
  // Renderer -> main, one-way (`ipcRenderer.send`/`ipcMain.on`, sem retorno):
  // informa se o modo de voz salvo agora é 'ptt', para o processo main
  // ligar/desligar a captura nativa do hook global de teclado de acordo —
  // nunca capturando teclado quando push-to-talk não é o modo ativo.
  SET_PTT_MODE_ACTIVE: 'voice:set-ptt-mode-active'
} as const
