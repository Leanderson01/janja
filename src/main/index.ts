import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  registerProtocol,
  extractCallbackUrl,
  parseCallbackParams
} from './auth/deep-link-handler'
import { handleCallback, getUser } from './auth/auth'
import { setupAuthIpcHandlers, notifyAuthChange } from './auth/ipc-handlers'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Ensure only a single instance of the app runs at a time. This is not
// polish: on Windows, the OAuth callback for the `janja://` protocol (F2)
// arrives through the `second-instance` event of the first instance. Without
// the lock, a second process would spawn and the authorization code would be
// lost. The lock must be requested before any window is created, and the
// `second-instance` handler must be registered before `app.whenReady()`
// resolves.
// Restringe a coleta de candidatos ICE à interface da rota padrão.
//
// Sem isto, o Chromium enumera TODAS as interfaces de rede para montar candidatos —
// incluindo adaptadores virtuais de VPN, VMware, VirtualBox, Hyper-V, Docker Desktop e
// WSL, que existem em quase toda máquina de quem mexe com desenvolvimento. Um adaptador
// que não roteia envenena a coleta: o log mostra falha de resolução de nome e timeout de
// STUN a partir de um IP que não é o da rede real, e a mídia nunca conecta.
//
// Aconteceu com um testador: DNS resolvia, as portas 5349 e 7881 respondiam pela Wi-Fi
// (192.168.x), e o WebRTC insistia em tentar por uma interface 172.16.x que não levava a
// lugar nenhum. Sinalização funcionava, áudio não.
//
// `default_public_interface_only` mantém a interface da rota padrão — a Wi-Fi, no caso —
// e descarta as outras. Não é medida de privacidade aqui, é de conectividade.
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only')

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // Registers the `janja://` custom protocol with the OS. Must happen before
  // app.whenReady() resolves, and only on the primary instance (the one that
  // actually got the single-instance lock) — see 02-RESEARCH.md §6.
  registerProtocol()

  app.on('second-instance', (_event, argv) => {
    // A second instance was launched; focus/restore the existing window
    // instead of letting a new process take over.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }

    // On Windows, this `argv` is THE delivery mechanism for the `janja://`
    // OAuth callback: clicking the "continue" link in the system browser
    // launches a second instance of the app with `janja://callback?...` as
    // one of the arguments. The single-instance lock above intercepts that
    // second launch and hands us its argv here instead of letting a real
    // second process start.
    const callbackUrl = extractCallbackUrl(argv)
    if (!callbackUrl) return

    const { code, state, error } = parseCallbackParams(callbackUrl)
    if (error) {
      console.error(`[auth] OAuth callback returned an error: ${error}`)
      return
    }
    if (!code || !state) {
      console.error('[auth] OAuth callback missing code or state, ignoring')
      return
    }

    handleCallback(code, state)
      .then((user) => {
        if (mainWindow) notifyAuthChange(mainWindow, user)
      })
      .catch((err) => {
        // Invalid/expired state, or the code exchange itself failing — never
        // crash the app over a bad callback, just log and let the user retry.
        console.error('[auth] Failed to handle OAuth callback:', err)
      })
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(() => {
    // DNS previsível para o WebRTC.
    //
    // O Chromium resolve nomes com DNS sobre HTTPS em modo `automatic` por padrão, e
    // ainda dispara consultas de tipo adicional (HTTPS/tipo 65) junto das A/AAAA. Numa
    // rede onde o DoH não responde bem, a resolução falha inteira — e o resto do sistema
    // continua funcionando, porque usa o resolvedor do SO.
    //
    // Foi exatamente o que apareceu num testador: `nslookup livekit.usesenju.com`
    // resolvia e as portas 5349 e 7881 respondiam, mas o módulo P2P do WebRTC dizia
    // "Failed to resolve address ... errorcode: -105" e a mídia nunca conectava. O DNS
    // dele é servido por IPv6 (2804:1778::a), cenário em que esse caminho costuma
    // tropeçar.
    //
    // Desligar o DoH e as consultas extras faz o app resolver nomes do mesmo jeito que
    // todo o resto da máquina. Precisa ser chamado depois do ready.
    app.configureHostResolver({
      secureDnsMode: 'off',
      enableAdditionalDnsQueryTypes: false
    })

    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // IPC test
    ipcMain.on('ping', () => console.log('pong'))

    createWindow()

    if (mainWindow) {
      setupAuthIpcHandlers(mainWindow)

      // Restore an existing (persisted) session on startup, without waiting
      // for a fresh login. Sent only after the renderer has actually
      // finished loading, so window.auth.onAuthChange has a listener
      // attached by the time this fires.
      mainWindow.webContents.once('did-finish-load', () => {
        getUser()
          .then((user) => {
            if (user && mainWindow) notifyAuthChange(mainWindow, user)
          })
          .catch((err) => {
            console.error('[auth] Failed to restore session on startup:', err)
          })
      })
    }

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
