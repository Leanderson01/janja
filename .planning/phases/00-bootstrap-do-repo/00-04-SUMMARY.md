# 00-04 — Verificação final da Fase 0

**Status:** concluído
**Data:** 2026-08-18
**Tipo:** checkpoint humano (verificação em máquina Windows nativa)

## Critérios de sucesso — todos verificados

| # | Critério | Como foi verificado | Resultado |
|---|---|---|---|
| 1 | Roda em modo dev sem passos manuais além de instalar dependências | `git clone` + `npm install` + `npm run dev` numa máquina Windows limpa | ✅ |
| 2 | App abre uma janela Electron sem crash | Janela abriu exibindo o shell do renderer | ✅ |
| 3 | Abrir o app 2× não cria segunda janela | Segundo `npm run dev` com o app aberto — nenhuma janela nova | ✅ |

`APP-04` satisfeito.

## Observação relevante

A janela reportou **Electron v43.4.0**, confirmando na prática o piso de versão
exigido pela pesquisa de armadilhas. Abaixo dessa versão o `restrictOwnAudio` é
ignorado e o compartilhamento de tela da Fase 8 produziria eco da própria call.

## Desvio encontrado durante a fase

O `npm install` não baixa o binário do Electron nesta versão — ele é buscado
preguiçosamente no primeiro `require('electron')`, que o `electron-vite dev` não
dispara sozinho. Sintoma: `Error: Electron uninstall`. Contornado com
`node node_modules/electron/install.js`.

Reproduziu tanto em WSL2 quanto em Windows nativo, ou seja, não é específico de
plataforma. **Vale automatizar no `postinstall` durante a Fase 9 (empacotamento)**,
senão toda pessoa que clonar o repo vai bater nisso.

## O que continua não verificável no ambiente de desenvolvimento

WSL2 não renderiza a janela do Electron de forma confiável (crash do GPU/network
service do Chromium sob WSLg/Xvfb). Toda verificação visual desta fase — e das
fases seguintes — depende da máquina Windows.
