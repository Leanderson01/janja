# Como rodar o janja — para quem vai testar

Guia para uma segunda pessoa rodar o app e testar junto. Leva uns 10 minutos.

Requer **Windows**. O app usa APIs de captura de áudio que só existem lá — no macOS e
no Linux ele nem abre direito.

---

## 1. Instalar o que falta

- [Node.js LTS](https://nodejs.org) — o instalador padrão serve
- [Git](https://git-scm.com/download/win)

Confira num terminal novo:

```
node --version
git --version
```

## 2. Baixar o projeto

```
git clone https://github.com/Leanderson01/janja.git
cd janja
npm install
```

Se aparecer `Error: Electron uninstall` ao rodar depois, o binário do Electron não foi
baixado no install. Resolve com:

```
node node_modules/electron/install.js
```

## 3. Criar o arquivo de configuração

Na raiz da pasta `janja`, crie um arquivo chamado **`.env.local`** com este conteúdo:

```
VITE_CONVEX_URL=<peça ao Leo — sem barra no final>
VITE_CONVEX_SITE_URL=<peça ao Leo>
MAIN_VITE_WORKOS_CLIENT_ID=<peça ao Leo>
```

Os três valores são iguais para todo mundo — o Leo passa uma vez. **Nenhum deles é
segredo:** o Client ID é público por design, e as URLs do Convex são endereços, não
credenciais. Não existe nenhuma chave secreta neste arquivo, e não deve existir.

> **Não rode `npx convex dev`.** Esse comando criaria um banco novo e separado, e vocês
> ficariam em servidores diferentes sem perceber. Quem roda o backend é o Leo.

## 4. Abrir

```
npm run dev
```

Deve abrir uma janela com a tela de login.

## 5. Entrar

Clique em **Entrar com Google**. O navegador do sistema vai abrir — isso é normal e
proposital, o Google recusa login dentro de janela de aplicativo.

Depois de autenticar, **a aba do navegador vai ficar aberta**. Pode fechar na mão; não é
erro. O app não tem permissão de fechar aba que não abriu.

> Se você usa **Brave** como navegador padrão, o login pode travar na tela de escolher
> conta. É problema conhecido e ainda não resolvido. Use Chrome ou Edge para o teste.

---

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Tela branca com "Carregando…" eterna | Falta algum valor no `.env.local`. Confira os três |
| Carrega para sempre depois do login do Google | URL do Convex com barra no final. O app já corrige sozinho, mas atualize com `git pull` se estiver numa versão antiga |
| `Error: Electron uninstall` | Rode `node node_modules/electron/install.js` |
| Login trava escolhendo a conta | Você está no Brave. Use Chrome ou Edge |
| Abre mas não aparece servidor nenhum | Normal na primeira vez — peça um convite ao Leo |
| Entra no canal de voz mas ninguém se ouve | O app já restringe o WebRTC à interface da rota padrão. Se persistir, mande o log — pode ser porta bloqueada na sua rede |

Se travar em outra coisa: abra o DevTools com `Ctrl+Shift+I`, aba **Console**, e mande o
texto em vermelho para o Leo.

---

## Depois de entrar

Peça ao Leo um **código de convite** e use-o para entrar no servidor. A partir daí:
canais de texto funcionam, canais de voz funcionam, e o compartilhamento de tela ainda
está sendo construído.

Para se adicionarem como amigos, troquem o identificador no formato `USUARIO#1234` —
ele aparece no topo do painel de amigos, é só clicar para copiar.
