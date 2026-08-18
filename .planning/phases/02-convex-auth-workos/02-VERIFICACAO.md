# Fase 2 — Verificação dos critérios de sucesso

**Data:** 2026-08-18
**Resultado:** aprovada
**Verificado por:** Leo, em máquina Windows nativa

| Req | Critério | Resultado |
|---|---|---|
| AUTH-01 | Login pelo navegador do sistema, retorno via `janja://` | ✅ Navegador abriu, app existente ganhou foco |
| AUTH-02 | Sessão persiste entre reinícios | ✅ |
| AUTH-03 | Credencial ilegível cai no login, sem crash | ✅ |
| AUTH-04 | Sessão longa não trava em não-autenticado | ✅ |
| AUTH-05 | Sair da conta pelo app | ✅ |
| AUTH-06 | Primeiro login gera `username#tag` único | ✅ Registro confirmado na tabela `users` |

## Cinco defeitos encontrados apenas na execução real

Nenhum deles apareceria em WSL2: o build passa, o typecheck passa e os 12 testes
passam com todos eles presentes. Só a janela renderizando de verdade os revela.

**1. CSP bloqueava o Convex — a causa raiz.** O template do electron-vite traz
`default-src 'self'`, que recusa toda conexão externa. O WebSocket do Convex era
bloqueado pelo próprio Chromium, `useConvexAuth` nunca saía de `isLoading`, e o app
travava em "Carregando…" sem erro de aplicação — porque a falha não era da aplicação.
Corrigido liberando Convex e, preventivamente, LiveKit: a Fase 7 bateria no mesmo
muro, e o sintoma lá seria "entrei no canal e não ouço ninguém".

**2. `useAuth` sem `.catch()`.** Qualquer rejeição da promise deixava `loading` em
`true` para sempre. Bug latente desde a criação; qualquer falha de IPC travaria o app
numa tela morta.

**3. `createWorkOS` no nível do módulo.** Sem `MAIN_VITE_WORKOS_CLIENT_ID`, o app
morria no carregamento com popup de exceção e stack trace do `node_modules`.
Inicialização adiada para o primeiro uso, com mensagem dizendo qual variável falta.

Registro honesto: a correção 3 foi feita antes da 2 e **piorou o sintoma** — trocou um
crash ruidoso por uma trava silenciosa. A ordem certa teria sido tratar a rejeição
primeiro.

**4. AUTH-05 não estava cumprido.** A fase seria entregue sem botão de sair; o resumo
do plano sugeria testar o logout pelo console do DevTools. O requisito diz "pelo app" —
console de desenvolvedor não é o app. Adicionado painel de usuário no rodapé da sidebar.

**5. `tsconfig` do Convex typechecava os testes.** Os testes usam `import.meta.glob`,
API do Vite inexistente no runtime do Convex, e o deploy falhava. Resolvido separando
os dois ambientes, em vez de desligar o typecheck inteiro como a mensagem de erro sugeria.

## Decisões de produto tomadas durante a verificação

**Logout apenas local.** Encerrar a sessão hospedada do WorkOS exigia abrir o
navegador e deixava uma aba órfã a cada saída. Consequência aceita: entrar de novo não
pede escolha de conta. Em máquina pessoal é conveniência; em máquina compartilhada
seria problema, e `getLogoutUrl` segue exportado para o caminho de volta.

**AUTH-07 criado e adiado para a Fase 9.** A aba do navegador não pode ser fechada
pelo app — foi aberta pelo SO via `shell.openExternal`, não por script, e navegadores
bloqueiam `window.close()` nesse caso. O que cabe fazer é servir uma página de
conclusão, via HTTP action do Convex, sem infraestrutura nova.

## Pendências conhecidas

- **Brave trava no seletor de contas do Google.** A configuração do WorkOS está
  comprovadamente correta (o `janja://callback` foi decodificado do `state` do OAuth).
  Não reproduzido em Chrome/Edge. Se alguém do grupo usar Brave como padrão, vai bater
  no mesmo — investigar antes do empacotamento da Fase 9.
- **`convex/_generated` foi reconstruído à mão** nesta máquina de desenvolvimento. A
  versão autoritativa é a que o `npx convex dev` gera no Windows. Conferir se divergem.
