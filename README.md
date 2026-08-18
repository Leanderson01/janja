# janja

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

## Desenvolvimento no WSL2 (WSLg)

O ambiente de desenvolvimento deste projeto é WSL2/Linux; o alvo de
produção é Windows exclusivamente.

`npm run dev` abre a janela do Electron através do WSLg (subsistema
gráfico integrado ao WSL2 desde o Windows 11) — não deveria exigir X
server externo nem flags adicionais na maioria das instalações atuais.

Se a janela não abrir ou o processo travar/crashar sem mensagem clara,
as causas mais comuns são:

- `chrome-sandbox` sem permissão de SUID dentro do WSL — tentar rodar
  com a flag `--no-sandbox` **só em desenvolvimento**, nunca no build de
  produção para Windows.
- Bibliotecas gráficas do sistema faltando no WSL (`libnss3`,
  `libatk1.0-0`, `libgtk-3-0`, `libgbm1`).

### O que este ambiente consegue validar

- A janela abre sem crash.
- `requestSingleInstanceLock` funciona — abrir uma segunda instância não
  cria uma segunda janela (o mecanismo do Electron é multiplataforma,
  não depende do Windows).

### O que só é validável numa máquina Windows nativa

- Foco de janela real via DWM do Windows.
- Registro do protocolo customizado `janja://` e o retorno de OAuth via
  `second-instance` com URL na `commandLine` (F2).
- Captura de áudio de sistema via WASAPI (F8).

Nenhum desses três está em escopo de F0 — são revalidados nas fases
correspondentes (F2 e F8) numa máquina Windows real.

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
