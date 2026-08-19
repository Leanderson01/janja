# Prompt para o colaborador da repaginação de UI

Copie tudo abaixo da linha e mande para a sua IA. É autocontido — ela não precisa
conhecer o projeto.

---

Você vai trabalhar no **janja**, um cliente desktop de chat e voz no modelo Discord,
para Windows. É um projeto real, em uso por um grupo de ~10 pessoas.

Repositório: `https://github.com/Leanderson01/janja`

## Contexto técnico

| Camada | Tecnologia |
|---|---|
| Shell | Electron 43.4.0 + electron-vite |
| Linguagem | TypeScript |
| UI | React 19 + Tailwind v4 + shadcn/ui |
| Backend | Convex (banco reativo) |
| Voz/mídia | LiveKit self-hosted |
| Auth | WorkOS AuthKit |

Estrutura:

```
src/main/        processo main do Electron
src/preload/     ponte IPC
src/renderer/    a aplicação React
convex/          backend
.planning/       planos e decisões do projeto
```

## Como rodar

Precisa de **Windows** — o app usa captura de áudio que não existe em outros sistemas.

```
git clone https://github.com/Leanderson01/janja.git
cd janja
npm install
npm run dev
```

Você vai precisar de um arquivo `.env.local` na raiz, com três valores que o Leo passa
(nenhum é segredo — são um identificador público e dois endereços):

```
VITE_CONVEX_URL=...
VITE_CONVEX_SITE_URL=...
MAIN_VITE_WORKOS_CLIENT_ID=...
```

Se aparecer `Error: Electron uninstall`, rode `node node_modules/electron/install.js`.

**Não rode `npx convex dev`** — isso criaria um banco separado e você ficaria num mundo
paralelo, sem erro nenhum indicando isso. Quem roda o backend é o Leo.

## Sua tarefa

Repaginar a interface. O layout funcional já existe e está verificado; o que falta é
acabamento: responsividade, acessibilidade e consistência visual.

### O que construir

**Responsividade** — hoje o app assume desktop.
- Desktop: barra de servidores, sidebar, chat e painel de membros, todos visíveis
- Tablet: painel de membros vira `Sheet`, aberto por botão
- Mobile: barra de servidores e sidebar viram `Sheet`
- O chat permanece sempre como área principal, em qualquer tamanho

**Categorias recolhíveis** de canais, com `Collapsible` ou `Accordion`.

**Menus de contexto** com `DropdownMenu`: servidor, canal e usuário.

**Feedback de ação** com `Toast`/`Sonner` — hoje erros aparecem como texto solto.

**Acessibilidade**: navegação por teclado, `aria-label` em ícone sem texto, `SheetTitle`
e `DialogTitle` sempre presentes.

**Metadata**: `lang="pt-BR"` e `theme-color`.

**Compositor de mensagem** com `InputGroup`, `InputGroupTextarea` e `InputGroupAddon`.
Enter envia, Shift+Enter quebra linha — e o tratamento de Enter precisa respeitar
composição de IME, senão quem digita em chinês, japonês ou coreano tem a mensagem
enviada no meio de uma palavra.

### Direção visual

- Interface dark. Fundo quase preto, painéis em cinza escuro, texto em cinza claro
- No máximo 3 a 5 cores principais, e **um único tom de destaque** para ação ativa e
  estado online
- Tipografia sans-serif moderna
- Flexbox como base; Grid só onde ele realmente ajuda
- Bordas discretas, espaçamento consistente, alto contraste
- Sem gradiente genérico, sem blob, sem sombra excessiva, sem enfeite que não comunica
- Não copiar logotipo de nenhum produto existente

### Regras de composição — não negociáveis

Estas valem para todo componente novo:

- Componente shadcn antes de markup próprio
- `AvatarFallback` em todo `Avatar`
- `Separator` em vez de `div` com borda
- `SheetTitle` e `DialogTitle` sempre, por acessibilidade
- `Tooltip` em ícone sem texto visível
- `ScrollArea` em área rolável
- `cn()` para classe condicional
- `gap` em vez de `space-x` / `space-y`
- `size-*` quando largura e altura forem iguais
- Tokens semânticos (`bg-background`, `text-muted-foreground`) — **nunca** cor direta
  como `bg-white`, `text-black` ou `bg-blue-500`

## Limites — leia antes de começar

**Trabalhe numa branch.** Nunca commite direto na `main`:

```
git checkout -b ui/repaginacao
```

Abra um Pull Request quando tiver algo revisável. O Leo integra.

**NÃO toque nestes diretórios e arquivos.** Estão sendo modificados em paralelo, e
alterá-los garante conflito:

- `convex/` — todo o backend
- `src/main/` e `src/preload/`
- `src/renderer/src/state/voice-context.tsx`
- `src/renderer/src/components/shell/VoiceControlBar.tsx`
- `src/renderer/src/components/shell/MicTestPanel.tsx`
- `src/renderer/src/components/shell/VoiceSettingsPopover.tsx`

**Troque a apresentação, não o comportamento.** As consultas ao Convex, a lógica de
autorização e o fluxo de voz já funcionam e foram verificados com usuários reais. Se
uma mudança visual parecer exigir alterar uma query, pare e pergunte — provavelmente há
outro caminho.

**Cargos e permissões estão FORA de escopo.** Foi decisão explícita: o grupo tem dez
pessoas que se conhecem, e cargos multiplicariam a superfície de teste de autorização em
cada mutation do backend. A interface pode **preparar o lugar** — seções na lista de
membros, nome do membro em componente próprio capaz de receber cor depois, menu de
contexto existindo — mas **não pode introduzir o conceito de cargo em schema, query,
mutation ou tipo**. O critério: se um dia virar v2, o trabalho deve ser adicionar dado e
preencher lugares, não reescrever layout nem autorização.

## Antes de abrir o PR

Rode e leia a saída dos três:

```
npm run typecheck
npm run build
npx vitest run
```

Os três precisam passar. Hoje são 173 testes.

## Onde entender as decisões

O projeto documenta o porquê de cada escolha. Vale ler antes de propor mudanças:

| Arquivo | Conteúdo |
|---|---|
| `README.md` | Visão geral e estado das fases |
| `.planning/phases/08.5-repaginacao-da-ui/08.5-BRIEF.md` | O brief completo desta tarefa |
| `.planning/PROJECT.md` | Constraints e decisões-chave, com justificativa |
| `.planning/research/FEATURES.md` | O que é table stakes e o que é anti-feature, e por quê |

Em particular, `FEATURES.md` lista o que foi deliberadamente **não** construído. Se você
sentir falta de algo óbvio, provavelmente está lá com a razão da exclusão.
