# UI do Discord no janja — Rodada 1: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o janja com a cara e o comportamento visual do Discord de 2025 em todas as telas, usando os dados que o backend já tem.

**Architecture:** As cores medidas no print viram tokens semânticos em `main.css`, e o resto do app herda deles. Cada região ganha peças puras e testáveis: libs em `src/renderer/src/lib` e componentes de apresentação sem contexto. Os contêineres que leem Convex e contexto só ligam essas peças. Duas tarefas mexem no caminho de voz verificado (Tarefas 6 e 13) e terminam com teste em call real.

**Tech Stack:** Electron 43 + electron-vite, React 19, Tailwind v4, shadcn/ui (Radix), Convex, livekit-client 2.22, Vitest 1.6 com Testing Library (sem jest-dom).

**Spec:** `docs/superpowers/specs/2026-11-09-ui-discord-rodada-1-design.md` (leia antes de qualquer tarefa; as seções citadas como §N são dele).

## Global Constraints

- Trabalhar na branch `ui/discord-rodada-1`, nunca na `main`.
- Sem mudança de schema e sem tabela nova. Permitido: devolver campo existente numa query, query nova só de leitura, argumento opcional novo em mutation/action existente.
- Tema só escuro. Toda cor de componente vem de token semântico de `src/renderer/src/assets/main.css`. Nada de `#hex` arbitrário nem paleta crua do Tailwind (`bg-blue-500`, `bg-black/60`) em `.tsx`; a guarda da Tarefa 1 falha o teste.
- Fonte Figtree embutida (`@fontsource-variable/figtree`), nunca carregada da internet.
- Marca na tela: “Hydra” com a estrela de `HydraMark`. Nada de logo ou fonte do Discord.
- Botão de função que chega nas rodadas 2 ou 3 não aparece.
- Regras de composição da Fase 8.5: shadcn antes de markup próprio, `AvatarFallback` em todo `Avatar`, `Tooltip` em ícone sem texto, `ScrollArea` em área rolável, `cn()`, `gap`, `size-*`, `DialogTitle`/`SheetTitle` sempre.
- Código de janela do Electron fica em `src/main/` ou `platform/electron/`. `scripts/verify-web-bundle.mjs` reprova o build web se `window.electron|auth|voice|screenshare` vazar.
- Testes de componente começam com `// @vitest-environment jsdom` e `import '@/test/jsdom-setup'`, chamam `afterEach(() => { cleanup(); vi.clearAllMocks() })` e usam asserções de DOM puro (sem jest-dom). Testes de lib rodam no ambiente padrão (edge-runtime). Nomes de teste em português, como no projeto.
- Rodar um arquivo de teste: `npx vitest run <caminho>`. Suíte toda: `npx vitest run`.
- Antes de cada commit, `npm run typecheck` precisa passar.
- Comentários que justificam as larguras antigas (344, 272, 240 fixos) são atualizados quando a tarefa muda a largura.

## Review Focus

1. **Dispositivo salvo que foi desconectado** (fone USB tirado entre uma call e outra). Esperado: entra com o dispositivo padrão, sem erro. Teste: `resolveSavedDevice` na Tarefa 6.
2. **Nomes longos** de pessoa, canal ou servidor (“Gordão Guerreiro do Norte da Silva”). Esperado: corte com reticências e nome inteiro no `title`, sem quebrar a linha nem empurrar ícones. Testes na Tarefa 5 (`VoiceParticipantRow`) e na Tarefa 11 (`MemberRow`).
3. **Janela no tamanho mínimo** (900×600) com a lista de canais alargada e os membros abertos. Esperado: o chat nunca fica com menos de 400px; a largura da lista é limitada para garantir isso. Teste: `clampChannelListWidth` na Tarefa 5.
4. **Foto de perfil que não carrega** (URL do Google expirada ou bloqueada). Esperado: aparece a estrela sobre a cor do id, nunca imagem quebrada. Teste: `UserAvatar` na Tarefa 2.
5. **Virada de dia e de ano, e relógio adiantado.** Esperado: “Ontem às 23:59” para 31/12 visto em 01/01; separador de data entre os dois; cronômetro nunca negativo. Testes: `formatMessageTimestamp` e `buildTimeline` na Tarefa 8, `formatCallDuration` na Tarefa 5.

---

### Task 1: Tokens do Discord, fonte Figtree e guarda de cor

**Files:**
- Modify: `src/renderer/src/assets/main.css` (bloco `:root`, bloco `.dark` L70–118, `@theme inline` L120–164)
- Modify: `src/renderer/src/main.tsx` (import da fonte)
- Modify: `src/renderer/index.html` (`theme-color`)
- Modify: `src/main/index.ts` (`backgroundColor` do `BrowserWindow`)
- Delete: `src/renderer/src/assets/base.css` (ninguém importa)
- Create: `src/renderer/src/assets/tokens.test.ts`
- Create: `src/renderer/src/test/no-raw-colors.test.ts`

**Interfaces:**
- Produces: as classes Tailwind abaixo, usadas por todas as tarefas seguintes.

| Token (`.dark`) | Valor | Classe |
|---|---|---|
| `--background` | `#1a1a1e` | `bg-background` (conteúdo: chat, membros) |
| `--foreground` | `#efeff1` | `text-foreground` |
| `--card` / `--card-foreground` | `#242429` / `#efeff1` | `bg-card` (prévias, cartões) |
| `--popover` / `--popover-foreground` | `#202024` / `#efeff1` | menus e popovers |
| `--primary` / `--primary-foreground` | `#5865f2` / `#ffffff` | botão principal |
| `--secondary` / `--secondary-foreground` | `#2c2c30` / `#fbfbfb` | canal aberto, aba ativa |
| `--muted` / `--muted-foreground` | `#242428` / `#81828a` | texto apagado |
| `--accent` / `--accent-foreground` | `#242428` / `#fbfbfb` | hover de linha no conteúdo |
| `--destructive` | `#d83a42` | AO VIVO, NOVAS, desligar |
| `--border` | `#29292d` | divisor do conteúdo |
| `--input` | `#27282b` | borda da caixa de texto |
| `--ring` | `var(--highlight)` | foco |
| `--highlight` | `#5865f2` | destaque |
| `--sidebar` / `--sidebar-foreground` | `#121214` / `#efeff1` | barra de título, rail, lista de canais |
| `--sidebar-accent` / `--sidebar-accent-foreground` | `#1f1f23` / `#dbdee1` | hover na lateral |
| `--sidebar-border` | `#222225` | moldura, separador do rail, ícone sem imagem |
| `--sidebar-primary` | `#5865f2` | — |
| `--success` | `#45a366` | online, fala |
| `--warning` | `#f0b232` | conectando |
| `--stage` | `#000000` | fundo da call |
| **novo** `--panel` / `--panel-border` | `#202024` / `#252529` | `bg-panel`, `border-panel-border` |
| **novo** `--composer` | `#222327` | `bg-composer` |
| **novo** `--strong` | `#fbfbfb` | `text-strong` |
| **novo** `--hint` | `#6c6d76` | `text-hint`, `placeholder:text-hint` |
| **novo** `--icon` | `#96979e` | `text-icon` |
| **novo** `--link` | `#4d96ee` | `text-link` |
| **novo** `--voice` | `#5eb479` | `text-voice` |
| **novo** `--avatar-1..5` | `#5865f2`, `#3ba55d`, `#faa61a`, `#ed4245`, `#eb459e` | `bg-avatar-1` … `bg-avatar-5` |
| **novo** `--embed-x` / `--embed-youtube` | `#1da0f2` / `#ff0033` | `border-embed-x`, `border-embed-youtube` |

  Os tokens novos ganham o mesmo valor no `:root` (o app não tem tema claro, mas a convenção do arquivo exige os dois blocos) e um `--color-<nome>: var(--<nome>)` no `@theme inline`. O `@theme inline` ganha `--font-sans: 'Figtree Variable', ui-sans-serif, system-ui, sans-serif`.

- [ ] **Step 1: Criar a branch**

```bash
git checkout -b ui/discord-rodada-1
```

- [ ] **Step 2: Escrever o teste de tokens**

`src/renderer/src/assets/tokens.test.ts`, com `// @vitest-environment node` no topo. Lê `main.css` com `fs.readFileSync(new URL('./main.css', import.meta.url))`, recorta o bloco `.dark { … }` e o `@theme inline { … }` e verifica:

```ts
it('o bloco .dark tem as cores medidas no print', () => {
  expect(dark).toMatch(/--background:\s*#1a1a1e/)
  expect(dark).toMatch(/--sidebar:\s*#121214/)
  expect(dark).toMatch(/--secondary:\s*#2c2c30/)
  expect(dark).toMatch(/--primary:\s*#5865f2/)
  expect(dark).toMatch(/--panel:\s*#202024/)
  expect(dark).toMatch(/--composer:\s*#222327/)
  expect(dark).toMatch(/--muted-foreground:\s*#81828a/)
})
it('todo token novo tem mapeamento no @theme inline', () => {
  for (const t of ['panel','panel-border','composer','strong','hint','icon','link','voice',
    'avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','embed-x','embed-youtube'])
    expect(theme).toContain(`--color-${t}: var(--${t})`)
})
it('a fonte padrão é a Figtree', () => {
  expect(theme).toMatch(/--font-sans:\s*'Figtree Variable'/)
})
```

- [ ] **Step 3: Escrever a guarda de cor crua**

`src/renderer/src/test/no-raw-colors.test.ts` (`// @vitest-environment node`). Percorre recursivamente `src/renderer/src/components` e `src/renderer/src/features` com `fs.readdirSync`, lê todo `.tsx` que não termina em `.test.tsx` e falha listando arquivo:linha para cada ocorrência de:

```ts
const ARBITRARY_HEX = /-\[#[0-9a-fA-F]{3,8}\]/
const RAW_PALETTE = /\b(?:bg|text|border|ring|fill|stroke|outline|from|via|to)-(?:white|black|(?:red|blue|green|yellow|gray|zinc|neutral|slate|stone|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/
it('nenhum componente usa cor fora dos tokens', () => { expect(violations).toEqual([]) })
```

- [ ] **Step 4: Rodar os dois testes e ver falhar**

Run: `npx vitest run src/renderer/src/assets/tokens.test.ts src/renderer/src/test/no-raw-colors.test.ts`
Expected: tokens FAIL (valores ainda são oklch neutros). A guarda pode já passar ou listar violações existentes.

- [ ] **Step 5: Instalar a fonte**

```bash
npm install @fontsource-variable/figtree@5
```

Em `main.tsx`, antes de `./assets/main.css`: `import '@fontsource-variable/figtree'`.

- [ ] **Step 6: Reescrever os tokens**

Aplicar a tabela acima em `main.css`. Trocar as violações que a guarda listar pelos tokens equivalentes. `index.html`: `theme-color` = `#121214`. `src/main/index.ts`: `backgroundColor: '#121214'` no `BrowserWindow`. Apagar `base.css`.

- [ ] **Step 7: Rodar os testes e ver passar**

Run: `npx vitest run src/renderer/src/assets/tokens.test.ts src/renderer/src/test/no-raw-colors.test.ts`
Expected: PASS

- [ ] **Step 8: Conferir que a fonte não virou `data:` (a CSP bloqueia)**

Run: `npm run build:web && grep -l "data:font" dist-web/assets/*.css; echo "exit=$?"`
Expected: nenhum arquivo listado (`exit=1`). Se listar, colocar `build.assetsInlineLimit: 0` em `vite.config.web.ts` e no bloco `renderer` de `electron.vite.config.ts`, e rodar de novo.

- [ ] **Step 9: Suíte e commit**

Run: `npm run typecheck && npx vitest run` (Expected: tudo PASS)

```bash
git add -A && git commit -m "feat(ui): tokens do Discord, Figtree embutida e guarda de cor crua"
```

---

### Task 2: Primitivos no estilo Discord, `UserAvatar` e nome exibido

**Files:**
- Modify: `src/renderer/src/components/ui/dropdown-menu.tsx`, `dialog.tsx`, `popover.tsx`, `tooltip.tsx`
- Create: `src/renderer/src/lib/avatar-color.ts`, `src/renderer/src/lib/avatar-color.test.ts`
- Create: `src/renderer/src/lib/display-name.ts`, `src/renderer/src/lib/display-name.test.ts`
- Create: `src/renderer/src/components/shell/UserAvatar.tsx`, `src/renderer/src/components/shell/UserAvatar.test.tsx`

**Interfaces:**
- Produces:
  - `avatarColorIndex(userId: string): 1 | 2 | 3 | 4 | 5`
  - `AVATAR_BG: Record<1|2|3|4|5, string>` (literais `'bg-avatar-1'` … `'bg-avatar-5'`)
  - `AVATAR_TILE_BG: Record<1|2|3|4|5, string>` (literais `'bg-avatar-1/25'` … `'bg-avatar-5/25'`, para a call)
  - `displayNameOf(p: { nickname?: string | null; displayName?: string | null; username: string }): string`
  - `UserAvatar(props: { userId: string; avatarUrl?: string | null; name: string; size: 16 | 24 | 32 | 40 | 80; status?: 'online' | 'offline'; className?: string })`. A bolinha usa a cor `--avatar-ring`, que a região pai define (`[--avatar-ring:var(--sidebar)]`, `[--avatar-ring:var(--background)]`, `[--avatar-ring:var(--panel)]`).

- [ ] **Step 1: Testes das libs**

```ts
// avatar-color.test.ts
it('é estável para o mesmo id', () => expect(avatarColorIndex('k57abc')).toBe(avatarColorIndex('k57abc')))
it('fica entre 1 e 5', () => { for (const id of ['a','bb','k57x9','zzzzzz','123']) expect([1,2,3,4,5]).toContain(avatarColorIndex(id)) })
it('ids diferentes se espalham pelas 5 cores', () => {
  const seen = new Set(Array.from({ length: 50 }, (_, i) => avatarColorIndex(`user${i}`)))
  expect(seen.size).toBe(5)
})
// display-name.test.ts
it('usa o apelido quando existe', () => expect(displayNameOf({ nickname: 'Rei', displayName: 'VM', username: 'vm' })).toBe('Rei'))
it('cai para o nome de exibição', () => expect(displayNameOf({ nickname: null, displayName: 'VM', username: 'vm' })).toBe('VM'))
it('cai para o usuário quando o nome de exibição está vazio', () => expect(displayNameOf({ displayName: '', username: 'vm' })).toBe('vm'))
it('nunca devolve #tag', () => expect(displayNameOf({ displayName: 'Leo', username: 'leo' })).not.toContain('#'))
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/avatar-color.test.ts src/renderer/src/lib/display-name.test.ts`
Expected: FAIL (módulos não existem)

- [ ] **Step 3: Implementar as duas libs**

`avatarColorIndex`: soma de `charCodeAt` com multiplicador (FNV-1a de 32 bits), `% 5 + 1`.

- [ ] **Step 4: Teste do `UserAvatar`**

```tsx
it('mostra a estrela sobre a cor do id quando não há foto', () => {
  render(<UserAvatar userId="u1" name="Leo" size={32} />)
  const fb = screen.getByRole('img', { name: 'Hydra' }).closest('[data-slot="avatar-fallback"]')!
  expect(fb.className).toContain(AVATAR_BG[avatarColorIndex('u1')])
})
it('mantém o fallback montado enquanto a foto não carrega', () => {
  render(<UserAvatar userId="u1" name="Leo" avatarUrl="https://lh3.googleusercontent.com/x" size={40} />)
  expect(screen.getByRole('img', { name: 'Hydra' })).toBeTruthy()
})
it('nunca mostra iniciais', () => {
  const { container } = render(<UserAvatar userId="u1" name="Leo Santos" size={32} />)
  expect(container.textContent).not.toContain('LS')
})
it('mostra a bolinha de status com rótulo', () => {
  render(<UserAvatar userId="u1" name="Leo" size={32} status="online" />)
  expect(screen.getByLabelText('Online')).toBeTruthy()
})
it('aplica o tamanho pedido', () => {
  const { container } = render(<UserAvatar userId="u1" name="Leo" size={80} />)
  expect(container.firstElementChild!.className).toContain('size-20')
})
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/components/shell/UserAvatar.test.tsx`
Expected: FAIL

- [ ] **Step 6: Implementar `UserAvatar`**

Usa `Avatar`, `AvatarImage`, `AvatarFallback` e `AvatarBadge` de `@/components/ui/avatar`. Tamanhos: 16→`size-4`, 24→`size-6`, 32→`size-8`, 40→`size-10`, 80→`size-20`. Fallback: `HydraMark` branca a ~55% do tamanho sobre `AVATAR_BG[n]`. Status: `AvatarBadge` com `aria-label` “Online”/“Offline”, `bg-success` ou `bg-muted-foreground`, borda de 3px (`size-20`: 5px) em `var(--avatar-ring)`.

- [ ] **Step 7: Primitivos**

- `dropdown-menu.tsx`: conteúdo `bg-popover border border-border rounded-lg p-1.5 shadow-lg`; item `rounded-sm px-2 py-1.5 text-sm`; o item em foco ganha `bg-primary text-primary-foreground` (o hover do Discord é azul); `variant="destructive"` em foco ganha `bg-destructive text-white`.
- `dialog.tsx`: conteúdo `bg-popover rounded-lg border-border`; título `text-xl font-bold text-strong`.
- `popover.tsx`: `bg-popover rounded-lg border-border`.
- `tooltip.tsx`: `bg-sidebar text-strong text-sm font-semibold rounded-md border border-sidebar-border`.

- [ ] **Step 8: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run` (Expected: PASS. Se um teste de componente existente quebrar por classe de menu, ajuste a asserção, não o comportamento.)

```bash
git add -A && git commit -m "feat(ui): UserAvatar com estrela do Hydra, nome exibido e primitivos no estilo Discord"
```

---

### Task 3: Moldura — barra de título, histórico de navegação e área com canto

**Files:**
- Create: `src/renderer/src/lib/nav-history.ts`, `src/renderer/src/lib/nav-history.test.ts`
- Modify: `src/renderer/src/state/selection-context.tsx`
- Modify: `src/renderer/src/platform/contract.ts`, `platform/electron/capabilities.ts`, `platform/web/capabilities.ts`
- Modify: `src/main/index.ts` (L15–49)
- Create: `src/renderer/src/components/shell/TitleBar.tsx`, `src/renderer/src/components/shell/TitleBar.test.tsx`
- Modify: `src/renderer/src/components/shell/AppShell.tsx` (`ShellBody` L37–153)

**Interfaces:**
- Produces:
  - `type NavEntry = { view: 'server' | 'home'; serverId: string | null; channelId: string | null; dmChannelId: string | null }`
  - `type NavHistory = { entries: NavEntry[]; index: number }`
  - `EMPTY_HISTORY: NavHistory` (`{ entries: [], index: -1 }`)
  - `navPush(h: NavHistory, e: NavEntry): NavHistory`
  - `navBack(h: NavHistory): { history: NavHistory; entry: NavEntry } | null`
  - `navForward(h: NavHistory): { history: NavHistory; entry: NavEntry } | null`
  - `MAX_HISTORY = 50`
  - `SelectionContextValue` ganha `canGoBack: boolean`, `canGoForward: boolean`, `goBack(): void`, `goForward(): void`
  - `PlatformCapabilities` ganha `nativeWindowControls: boolean` (electron `true`, web `false`)
  - `TitleBarView(props: { title: string; iconUrl?: string | null; canGoBack: boolean; canGoForward: boolean; onBack(): void; onForward(): void; reserveWindowControls: boolean })` e `TitleBar()` (contêiner)
  - Em `AppShell`, a região de conteúdo é `<div data-content-frame>`. Ela fica à direita do rail, com `border-t border-l border-sidebar-border rounded-tl-[10px] overflow-hidden` e contém a lista de canais, o chat e os membros.

- [ ] **Step 1: Testes do histórico**

```ts
const a = { view: 'server', serverId: 's1', channelId: 'c1', dmChannelId: null } as const
const b = { ...a, channelId: 'c2' }
const c = { view: 'home', serverId: null, channelId: null, dmChannelId: 'd1' } as const
it('empilha e volta', () => {
  const h = navPush(navPush(EMPTY_HISTORY, a), b)
  expect(navBack(h)!.entry).toEqual(a)
})
it('voltar no começo devolve null', () => expect(navBack(navPush(EMPTY_HISTORY, a))).toBeNull())
it('avançar depois de voltar', () => {
  const back = navBack(navPush(navPush(EMPTY_HISTORY, a), b))!
  expect(navForward(back.history)!.entry).toEqual(b)
})
it('navegar depois de voltar descarta o futuro', () => {
  const back = navBack(navPush(navPush(EMPTY_HISTORY, a), b))!
  expect(navForward(navPush(back.history, c))).toBeNull()
})
it('não duplica a mesma entrada seguida', () => expect(navPush(navPush(EMPTY_HISTORY, a), a).entries).toHaveLength(1))
it('guarda no máximo 50', () => {
  let h = EMPTY_HISTORY
  for (let i = 0; i < 60; i++) h = navPush(h, { ...a, channelId: `c${i}` })
  expect(h.entries).toHaveLength(MAX_HISTORY)
  expect(h.entries[0].channelId).toBe('c10')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/nav-history.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar `nav-history.ts`**

- [ ] **Step 4: Ligar o histórico na seleção**

Em `selection-context.tsx`, guarde `NavHistory` num estado. Os setters chamados por gesto do usuário (`setSelectedServerId`, `setSelectedChannelId`, `goHome`, `setSelectedDmChannelId`) passam a fazer `navPush` com a entrada resultante. `goBack` e `goForward` aplicam a entrada sem empilhar, usando setters internos. Se o servidor ou canal da entrada não existe mais (não está em `servers` / `listChannels`), ignore a entrada e siga para a próxima na mesma direção.

- [ ] **Step 5: Testes do `TitleBarView`**

```tsx
it('mostra o título no centro', () => { renderBar({ title: 'janja da galera' }); expect(screen.getByText('janja da galera')).toBeTruthy() })
it('Voltar fica desabilitado sem histórico', () => {
  renderBar({ canGoBack: false })
  expect((screen.getByRole('button', { name: 'Voltar' }) as HTMLButtonElement).disabled).toBe(true)
})
it('Avançar chama o handler', async () => {
  const onForward = vi.fn(); renderBar({ canGoForward: true, onForward })
  await userEvent.click(screen.getByRole('button', { name: 'Avançar' })); expect(onForward).toHaveBeenCalledOnce()
})
it('reserva espaço para os botões da janela', () => {
  const { container } = renderBar({ reserveWindowControls: true })
  expect(container.querySelector('[data-window-controls-reserve]')).toBeTruthy()
})
```

(`renderBar` monta `TitleBarView` com valores padrão e `TooltipProvider` em volta.)

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/components/shell/TitleBar.test.tsx`
Expected: FAIL

- [ ] **Step 7: Implementar a barra de título**

- `TitleBarView`: altura 32px (`h-8`), `bg-sidebar`, `[app-region:drag]`. Botões com `[app-region:no-drag]`, `ArrowLeft`/`ArrowRight` de 18px em `text-icon`, com `Tooltip`. Título no centro absoluto: ícone de 16px (imagem do servidor, ou `HydraMark`) e nome em `text-[13px] font-semibold text-strong`. À direita, `<div data-window-controls-reserve className="w-[138px]" />` quando `reserveWindowControls`.
- `TitleBar`: o título é o nome do servidor (view `server`); “Amigos” (home sem DM); ou `displayNameOf(otherUser)` (home com DM, via `api.dms.listMyDmChannels`).
- `capabilities`: adicionar `nativeWindowControls` nos dois lados, senão `platform/capabilities.test.ts` falha.
- `src/main/index.ts`: fora do macOS, `titleBarStyle: 'hidden'` e `titleBarOverlay: { color: '#121214', symbolColor: '#dbdee1', height: 32 }`.

- [ ] **Step 8: Reestruturar o `AppShell`**

Raiz `flex flex-col h-screen bg-sidebar`: em cima `<TitleBar/>`, embaixo uma linha com o rail (`w-[72px]`, sem `border-r`) e `<div data-content-frame>`. A lista de canais fica dentro da moldura, com fundo `bg-sidebar`. O chat (`bg-background`) e os membros (`w-60 bg-background border-l border-border`) também. O painel do usuário fica onde está até a Tarefa 7. Atualize os comentários de largura.

- [ ] **Step 9: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run && npm run build:web && node scripts/verify-web-bundle.mjs`
Expected: PASS em tudo

```bash
git add -A && git commit -m "feat(ui): barra de título com voltar/avançar e moldura com canto arredondado"
```

---

### Task 4: Rail de servidores

**Files:**
- Modify: `src/renderer/src/components/shell/ServerRail.tsx`
- Modify: `src/renderer/src/components/shell/ChannelSidebar.tsx` (`ServerMenu` L251 aceita gatilho próprio)
- Create: `src/renderer/src/components/shell/ServerRail.test.tsx`

**Interfaces:**
- Consumes: tokens (Tarefa 1); `HydraMark`.
- Produces:
  - `ServerMenu({ serverName, onInvite, onCreateChannel, children? }: { …; children?: ReactNode })`. Com `children`, eles viram o gatilho (sem o cabeçalho padrão), e o clique direito continua abrindo o menu.
  - `ServerRailIcon(props: { name: string; iconUrl?: string | null; isActive: boolean; hasUnread?: boolean; inVoice: boolean; onSelect(): void })`. O `hasUnread` fica sem uso até a rodada 2.

- [ ] **Step 1: Testes**

```tsx
it('servidor aberto tem a pílula de 40px', () => {
  renderIcon({ isActive: true })
  expect(screen.getByTestId('rail-pill').getAttribute('data-state')).toBe('active')
})
it('sem servidor aberto a pílula fica escondida', () => {
  renderIcon({ isActive: false })
  expect(screen.getByTestId('rail-pill').getAttribute('data-state')).toBe('idle')
})
it('mostra o alto-falante quando você está em call nele', () => {
  renderIcon({ inVoice: true })
  expect(screen.getByLabelText('Você está em call neste servidor')).toBeTruthy()
})
it('ícone é quadrado de cantos arredondados, sem anel', () => {
  const { container } = renderIcon({ isActive: true })
  const av = container.querySelector('[data-slot="avatar"]')!
  expect(av.className).toContain('rounded-xl'); expect(av.className).not.toContain('ring-')
})
it('clique direito no ícone abre o menu do servidor', () => {
  renderIconWithMenu()
  fireEvent.contextMenu(screen.getByRole('button', { name: 'janja da galera' }))
  expect(screen.getByRole('menuitem', { name: 'Convidar pessoas' })).toBeTruthy()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/components/shell/ServerRail.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

- Ícone 40×40 `rounded-xl`, 8px entre ícones, sigla (`initialsFor`) em `text-strong` sobre `bg-sidebar-border`.
- Pílula `w-1 bg-strong rounded-r`:
  - `data-state`: `idle` (h-0), `unread` (h-2), `active` (h-10);
  - no hover vira h-5;
  - `transition-[height] duration-150`.
- Botão Início: `HydraMark` sobre `bg-sidebar-border`; `bg-primary` quando `view==='home'`.
- Separador 32×1 `bg-sidebar-border`.
- “+”: mesmo formato, `text-success`; no hover, `bg-success text-white`.
- Selo de voz: `Volume2` de 11px em círculo `bg-success` de 18px no canto superior direito, com anel `bg-sidebar`. Para saber o servidor da call, use `useQuery(api.channels.getChannel, joinedVoiceChannelId ? { channelId: joinedVoiceChannelId } : 'skip')?.serverId`, igual ao `VoiceControlBar` L56.
- Clique direito usa `ServerMenu` com o ícone como `children`. O rail monta as próprias instâncias de `InviteDialog` e `CreateChannelDialog` para o servidor clicado, com as mesmas props de `ChannelSidebar.tsx` L211–216.

- [ ] **Step 4: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): rail com ícones quadrados, pílula do Discord e selo de call"
```

---

### Task 5: Lista de canais, cronômetro da call e largura ajustável

**Files:**
- Create: `src/renderer/src/lib/layout-preferences.ts`, `src/renderer/src/lib/layout-preferences.test.ts`
- Modify: `src/renderer/src/state/layout-context.tsx` (passa a usar a lib)
- Create: `src/renderer/src/lib/call-timer.ts`, `src/renderer/src/lib/call-timer.test.ts`
- Create: `src/renderer/src/components/shell/CallTimer.tsx`
- Create: `src/renderer/src/components/shell/ChannelListResizeHandle.tsx`, `src/renderer/src/components/shell/ChannelListResizeHandle.test.tsx`
- Modify: `src/renderer/src/components/shell/ChannelSidebar.tsx`, `src/renderer/src/components/shell/ChannelSidebar.test.tsx`
- Modify: `convex/voice.ts` (`enrichVoiceStates` ~L277), `convex/voice.test.ts`

**Interfaces:**
- Consumes: `UserAvatar`, `displayNameOf` (Tarefa 2); `ServerMenu` (Tarefa 4).
- Produces:
  - Lib de layout:
    - `type LayoutPreferences = { membersVisible: boolean; channelListWidth: number }`
    - `CHANNEL_LIST_MIN = 240`, `CHANNEL_LIST_MAX = 360`, `CHAT_MIN = 400`
    - `clampChannelListWidth(px: number, viewportWidth: number, membersVisible: boolean): number`
    - `loadLayoutPreferences(): LayoutPreferences`
    - `saveLayoutPreferences(p: LayoutPreferences): void`
    - a chave continua `'janja:layout-preferences'`
  - `LayoutContextValue` ganha `channelListWidth: number` e `setChannelListWidth(px: number): void` (o setter aplica `clampChannelListWidth` com `window.innerWidth`).
  - Cronômetro:
    - `callStartedAt(rows: { joinedAt: number }[]): number | null`
    - `formatCallDuration(ms: number): string` (`h:mm:ss`, mínimo `0:00:00`)
    - `CallTimer({ since }: { since: number })` (tique de 1s, `text-voice font-mono text-xs tabular-nums`)
  - `ChannelListResizeHandle({ width, onResize }: { width: number; onResize(px: number): void })`
  - `voiceParticipantsByChannel` e `voiceParticipantsByServer` devolvem também `joinedAt: number` (o `_creationTime` da linha).
  - `TextChannelRow({ channel, isSelected, unreadCount, onClick, markAsRead, onInvite })`. O `⋮` sai; o clique direito abre o menu.
  - `VoiceParticipantRow({ participant, speaking }: { participant: { userId: string; displayName: string; username: string; avatarUrl?: string | null; muted: boolean; deafened: boolean; sharing: boolean }; speaking: boolean })`
  - `ChannelSection({ label, open, onOpenChange, pinned, children })`. `pinned` são as linhas que continuam visíveis com a seção recolhida.

- [ ] **Step 1: Testes das libs**

```ts
// layout-preferences.test.ts
it('largura padrão é 240', () => expect(loadLayoutPreferences().channelListWidth).toBe(240))
it('limita ao máximo de 360 numa janela larga', () => expect(clampChannelListWidth(500, 1920, true)).toBe(360))
it('limita ao mínimo de 240', () => expect(clampChannelListWidth(100, 1920, true)).toBe(240))
it('na janela mínima garante 400px de chat', () => {
  // 900 - 72 (rail) - 240 (membros) - 400 (chat) = 188 → fica no mínimo 240
  expect(clampChannelListWidth(360, 900, true)).toBe(240)
})
it('sem membros sobra mais espaço', () => expect(clampChannelListWidth(360, 900, false)).toBe(360))
it('valor salvo inválido volta ao padrão', () => {
  localStorage.setItem('janja:layout-preferences', JSON.stringify({ membersVisible: true, channelListWidth: 'x' }))
  expect(loadLayoutPreferences().channelListWidth).toBe(240)
})
// call-timer.test.ts
it('começa na primeira pessoa', () => expect(callStartedAt([{ joinedAt: 5000 }, { joinedAt: 1000 }])).toBe(1000))
it('call vazia não tem início', () => expect(callStartedAt([])).toBeNull())
it('formata h:mm:ss', () => expect(formatCallDuration((1 * 3600 + 30 * 60 + 44) * 1000)).toBe('1:30:44'))
it('abaixo de uma hora', () => expect(formatCallDuration(65_000)).toBe('0:01:05'))
it('relógio adiantado nunca fica negativo', () => expect(formatCallDuration(-5000)).toBe('0:00:00'))
```

Os testes de `layout-preferences` instalam um `localStorage` falso, como `participant-volumes.test.ts` faz com `installFakeStorage`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/layout-preferences.test.ts src/renderer/src/lib/call-timer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar as libs e ligar o `layout-context`**

- [ ] **Step 4: Teste de backend do `joinedAt`**

Em `convex/voice.test.ts`, no padrão do arquivo (`convexTest`, `withIdentity`): depois de criar a linha de voz, `voiceParticipantsByChannel` devolve `joinedAt` igual ao `_creationTime` da linha (leia a linha com `t.run(ctx => ctx.db.query('voiceStates').first())`).

Run: `npx vitest run convex/voice.test.ts` → FAIL; adicione `joinedAt: row._creationTime` em `enrichVoiceStates` → PASS.

- [ ] **Step 5: Testes dos componentes**

```tsx
// ChannelListResizeHandle.test.tsx
it('seta para a direita alarga 8px', async () => {
  const onResize = vi.fn(); render(<ChannelListResizeHandle width={240} onResize={onResize} />)
  screen.getByRole('separator').focus(); await userEvent.keyboard('{ArrowRight}')
  expect(onResize).toHaveBeenCalledWith(248)
})
it('expõe a largura para leitor de tela', () => {
  render(<ChannelListResizeHandle width={300} onResize={vi.fn()} />)
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('300')
})
// ChannelSidebar.test.tsx: substituir os testes do ⋮ (L84–184) por:
it('canal não lido fica branco com a pílula e sem número', () => {
  renderRow({ unreadCount: 3 })
  const row = screen.getByRole('button', { name: /geral/ })
  expect(row.getAttribute('data-unread')).toBe('true'); expect(row.textContent).not.toContain('3')
})
it('clique direito abre Marcar como lido e Copiar nome', () => {
  renderRow({}); fireEvent.contextMenu(screen.getByRole('button', { name: /geral/ }))
  expect(screen.getByRole('menuitem', { name: 'Marcar como lido' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: 'Copiar nome' })).toBeTruthy()
})
it('canal aberto mostra o botão de criar convite', () => {
  renderRow({ isSelected: true }); expect(screen.getByRole('button', { name: 'Criar convite' })).toBeTruthy()
})
it('não existe mais o botão de opções', () => {
  renderRow({}); expect(screen.queryByRole('button', { name: /Opções do canal/ })).toBeNull()
})
it('ensurdecido mostra o fone cortado e AO VIVO aparece para quem transmite', () => {
  renderVoiceRow({ deafened: true, muted: true, sharing: true })
  expect(screen.getByLabelText('Ensurdecido')).toBeTruthy(); expect(screen.getByText('AO VIVO')).toBeTruthy()
})
it('nome longo corta com reticências e mantém o nome inteiro no title', () => {
  renderVoiceRow({ displayName: 'Gordão Guerreiro do Norte da Silva' })
  const name = screen.getByText('Gordão Guerreiro do Norte da Silva')
  expect(name.className).toContain('truncate'); expect(name.getAttribute('title')).toBe('Gordão Guerreiro do Norte da Silva')
})
it('seção recolhida continua mostrando o canal aberto', () => {
  renderSection({ open: false, pinnedName: 'geral', hiddenName: 'memes' })
  expect(screen.getByText('geral')).toBeTruthy(); expect(screen.queryByText('memes')).toBeNull()
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/components/shell/ChannelListResizeHandle.test.tsx src/renderer/src/components/shell/ChannelSidebar.test.tsx`
Expected: FAIL

- [ ] **Step 7: Implementar a lista de canais**

- **Alça:** `role="separator"`, `aria-orientation="vertical"`, `aria-valuemin` 240 e `aria-valuemax` 360. Arrastar com pointer capture; setas ±8px. Fica colada na borda direita da lista de canais. No `AppShell`, a lista usa `style={{ width: channelListWidth }}`.
- **Cabeçalho:**
  - `h-12 border-b border-sidebar-border`;
  - nome em `text-base font-bold text-strong`, `ChevronDown` de 16px;
  - `UserPlus` à direita, com tooltip “Convidar pessoas”, abre o `InviteDialog`.
- **Seções:**
  - rótulos “Canais de texto” e “Canais de voz”, em `text-sm font-medium text-muted-foreground`, sem `uppercase`;
  - `ChevronDown` de 12px depois do rótulo, com `-rotate-90` quando recolhida;
  - `pinned` recebe o canal aberto e os canais de voz com gente.
- **`TextChannelRow`:**
  - linha `h-8 rounded-md px-2 gap-1.5`; `Hash` de 20px; nome `text-base font-medium` com `truncate` e `title`;
  - lido: `text-muted-foreground`;
  - `data-unread`: `text-strong font-semibold` e um `span` absoluto `-left-2 w-1 h-2 bg-strong rounded-r`;
  - selecionado: `bg-secondary text-strong`;
  - hover: `bg-sidebar-accent text-sidebar-accent-foreground`;
  - botão `UserPlus` 16px “Criar convite” visível no hover e quando selecionado (chama `onInvite`).
- **Clique direito:** `DropdownMenu` controlado por `onContextMenu`, o mesmo padrão do `ServerMenu`. O menu de voz mantém o item “Entrar”.
- **`VoiceParticipantRow`:**
  - `h-[30px] pl-7 gap-2`; `UserAvatar` de 24, com o anel `ring-2 ring-success ring-offset-2 ring-offset-sidebar` quando fala;
  - nome com `displayNameOf`, `text-sm font-medium text-muted-foreground truncate`, `title`;
  - ícones à direita: `MicOff` (“Mutado”) quando `muted && !deafened`, `HeadphoneOff` (“Ensurdecido”) quando `deafened`, e `span` “AO VIVO” `bg-destructive text-white text-[10px] font-bold rounded px-1.5` quando `sharing`.
- **Canal de voz em que você está:** `<CallTimer since={callStartedAt(participants)!}/>` à direita do nome, quando há participantes.

- [ ] **Step 8: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): lista de canais do Discord, cronômetro da call e largura ajustável"
```

---

### Task 6: Mic e fone fora da call, com estado salvo (caminho de voz)

**Files:**
- Create: `src/renderer/src/lib/voice-self-state.ts`, `src/renderer/src/lib/voice-self-state.test.ts`
- Modify: `src/renderer/src/state/voice-context.tsx`. Pontos citados:
  - `VoiceContextValue` L113–250
  - refs L333/344/351
  - clone do VAD L487
  - ramo de PTT L574
  - join L1309–1382: reset em L1346 e L1354; L1337 e L1342
- Modify: `src/renderer/src/components/shell/VoiceControlBar.tsx` (`VoiceQuickControls` L204–332 passa a só chamar o contexto)
- Modify: `src/renderer/src/components/shell/VoiceSettingsPopover.tsx` (L73–121, L219–237, L337–424)
- Modify: `convex/voiceToken.ts` (L56–93), `convex/voice.ts` (`upsertVoiceState` L67–85), `convex/voice.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces:
  - Lib:
    - `type VoiceSelfState = { muted: boolean; deafened: boolean; mutedBeforeDeafen: boolean; inputDeviceId: string | null; outputDeviceId: string | null }`
    - `DEFAULT_VOICE_SELF_STATE` (tudo `false`/`null`)
    - `loadVoiceSelfState(): VoiceSelfState` (chave `'janja:voice-self-state'`, nunca lança)
    - `saveVoiceSelfState(s: VoiceSelfState): void`
    - `toggleMute(s: VoiceSelfState): VoiceSelfState`
    - `toggleDeafen(s: VoiceSelfState): VoiceSelfState`
    - `resolveSavedDevice(savedId: string | null, available: { deviceId: string }[]): string | null`
  - `VoiceContextValue` ganha `muted: boolean`, `toggleMuted(): Promise<void>`, `toggleDeafened(): Promise<void>`, `inputDeviceId: string | null`, `outputDeviceId: string | null`, `selectDevice(kind: 'audioinput' | 'audiooutput', deviceId: string): Promise<void>`.
  - `api.voiceToken.joinVoiceChannel` aceita `{ channelId, muted?: boolean, deafened?: boolean }`.

- [ ] **Step 1: Testes da lib**

```ts
const base = DEFAULT_VOICE_SELF_STATE
it('mutar e desmutar', () => expect(toggleMute(toggleMute(base)).muted).toBe(false))
it('ensurdecer também muta e lembra o estado anterior', () =>
  expect(toggleDeafen(base)).toMatchObject({ deafened: true, muted: true, mutedBeforeDeafen: false }))
it('desensurdecer volta o mic como estava (aberto)', () => expect(toggleDeafen(toggleDeafen(base)).muted).toBe(false))
it('desensurdecer volta o mic como estava (mutado)', () => {
  const s = toggleDeafen(toggleMute(base)); expect(toggleDeafen(s)).toMatchObject({ deafened: false, muted: true })
})
it('clicar no mic ensurdecido desensurdece e desmuta', () =>
  expect(toggleMute(toggleDeafen(base))).toMatchObject({ deafened: false, muted: false }))
it('persiste entre recarregamentos', () => {
  saveVoiceSelfState({ ...base, muted: true, inputDeviceId: 'mic-usb' })
  expect(loadVoiceSelfState()).toMatchObject({ muted: true, inputDeviceId: 'mic-usb' })
})
it('dado salvo corrompido volta ao padrão', () => {
  localStorage.setItem('janja:voice-self-state', '{"muted":"sim"}'); expect(loadVoiceSelfState()).toEqual(base)
})
it('dispositivo salvo que sumiu cai para o padrão', () =>
  expect(resolveSavedDevice('mic-usb', [{ deviceId: 'default' }])).toBeNull())
it('dispositivo salvo presente é mantido', () =>
  expect(resolveSavedDevice('mic-usb', [{ deviceId: 'mic-usb' }])).toBe('mic-usb'))
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/voice-self-state.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar a lib**

- [ ] **Step 4: Teste de backend de entrar mutado**

Em `convex/voice.test.ts`:
- entrar com `{ deafened: true }` cria a linha com `muted: true, deafened: true`;
- entrar com `{ muted: true }` cria `muted: true, deafened: false`;
- entrar sem os argumentos numa linha já existente não muda nada (o teste atual em ~L259 continua passando).

Run: `npx vitest run convex/voice.test.ts` → FAIL.

- [ ] **Step 5: Implementar no backend**

- `joinVoiceChannel`: args `muted: v.optional(v.boolean())`, `deafened: v.optional(v.boolean())`, repassados ao `upsertVoiceState`.
- `upsertVoiceState`:
  - ao inserir, usa `muted: (muted ?? false) || (deafened ?? false)` e `deafened: deafened ?? false`;
  - numa linha que já existe, só faz `patch` quando algum dos dois veio.

Run: `npx vitest run convex/voice.test.ts` → PASS.

- [ ] **Step 6: Ligar no `voice-context`**

- **Estado inicial:** `useState(loadVoiceSelfState)`. Toda mudança salva com `saveVoiceSelfState`. `manualMuteRef` e `deafenedRef` partem do estado salvo.
- **`toggleMuted` / `toggleDeafened`:**
  - calculam com `toggleMute` / `toggleDeafen` e tocam `playMuteStateChangeTone`;
  - **fora de call** (sem `activeChannelRef.current`), param aí;
  - **em call**, sincronizam com o servidor: `setDeafened(next.deafened)` se `deafened` mudou; depois, `setMuted(next.muted)` se `next.muted` difere do que o servidor guarda após essa chamada (no servidor, ensurdecer implica mutado);
  - **e aplicam no mic** a mesma lógica de trilha que hoje está em `VoiceQuickControls` L233–289. Diferença: desmutar não força o mic ligado em VAD ou PTT, só libera o controle para o VAD/PTT (`setManualMute(false)` + `applyVoicePreferences()`).
- **Join:**
  - L1337: `joinVoiceChannel({ channelId: target, muted: self.muted || self.deafened, deafened: self.deafened })`;
  - L1342: se `self.muted || self.deafened`, crie a trilha com `createLocalAudioTrack(AUDIO_CAPTURE_OPTIONS)`, chame `await track.mute()` e publique com `room.localParticipant.publishTrack(track, { source: Track.Source.Microphone })`, para não vazar nenhum áudio; senão, mantenha o `setMicrophoneEnabled(true, …)`;
  - L1346/L1354: troque o reset para `false` pelos valores salvos.
- **VAD (L487):** depois do `clone()`, `analysisTrack.enabled = true` (o clone herda `enabled=false` da trilha mutada).
- **PTT (L574):** antes do `return`, desligue o mic se a tecla não estiver pressionada. Isso corrige o mic aberto até o primeiro soltar de tecla.
- **Dispositivos:**
  - na montagem do provider, para cada tipo salvo, `navigator.mediaDevices.enumerateDevices()` → `resolveSavedDevice` → `room.switchActiveDevice(kind, id, false)` dentro de `try/catch`;
  - `selectDevice` faz `switchActiveDevice(kind, id, false)` e salva;
  - o handler de `ActiveDeviceChanged` continua como está.
- **`VoiceQuickControls`:** apague o `useState` local L211 e o reset L225–231; os botões chamam `toggleMuted`/`toggleDeafened` e perdem `disabled={!isReady}` (L299, L315).
- **`VoiceSettingsPopover`:** listas de dispositivo sem a trava `hasVoiceIntention` (L73–121, L337); a troca usa `selectDevice`.

- [ ] **Step 7: Rodar tudo**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(voz): mic e fone fora da call, estado e dispositivo salvos, entrar mutado sem vazar áudio"
```

- [ ] **Step 9: Checkpoint em call real (Windows, Leo + 2 pessoas)**

Roteiro, marcando cada um:
1. mutar antes de entrar → entra mutado; os outros nunca te veem desmutado e não ouvem nada;
2. ensurdecer antes de entrar → entra ensurdecido;
3. fechar e abrir o app → continua mutado;
4. trocar o mic fora da call → a call usa o mic escolhido;
5. tirar o fone USB e entrar → entra com o padrão, sem erro;
6. modo PTT: ao entrar, ninguém te ouve até apertar a tecla;
7. modo VAD desmutado: voz normal, como antes.

Se algum item falhar, pare e conserte antes da Tarefa 7.

---

### Task 7: Cartão do usuário e “Voz conectada”

**Files:**
- Create: `src/renderer/src/components/shell/UserArea.tsx`
- Create: `src/renderer/src/components/shell/DeviceMenu.tsx`
- Modify: `src/renderer/src/components/shell/VoiceControlBar.tsx`:
  - `VoiceControlBar` vira `VoiceConnectedSection`;
  - `VoiceQuickControls` vira `SelfVoiceButtons`, com a parte pura `VoiceButtonsView`.
- Modify: `src/renderer/src/features/auth/UserPanel.tsx` (parte pura `SelfIdentityView`)
- Modify: `src/renderer/src/components/shell/AppShell.tsx` (L93 e L110–113 saem; entra `<UserArea/>`)
- Create: `src/renderer/src/components/shell/UserArea.test.tsx`

**Interfaces:**
- Consumes:
  - `muted`, `deafened`, `toggleMuted`, `toggleDeafened`, `inputDeviceId`, `outputDeviceId`, `selectDevice`, `connectionQualities` (Tarefa 6);
  - `UserAvatar` (Tarefa 2);
  - `channelListWidth` (Tarefa 5).
- Produces:
  - `VoiceButtonsView(props: { muted: boolean; deafened: boolean; onToggleMute(): void; onToggleDeafen(): void; inputMenu: ReactNode; outputMenu: ReactNode })`
  - `SelfIdentityView(props: { userId: string; displayName: string; username: string; avatarUrl?: string | null })`
  - `DeviceMenu({ kind, children }: { kind: 'audioinput' | 'audiooutput'; children: ReactNode })`
  - `UserArea()`

- [ ] **Step 1: Testes**

```tsx
it('mic mutado mostra o ícone cortado e o rótulo de reativar', () => {
  renderButtons({ muted: true })
  const b = screen.getByRole('button', { name: 'Ativar microfone' })
  expect(b.getAttribute('aria-pressed')).toBe('true')
})
it('os botões nunca ficam desabilitados', () => {
  renderButtons({})
  for (const name of ['Desativar microfone', 'Ensurdecer']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false)
})
it('ensurdecido mostra o fone cortado', () => {
  renderButtons({ deafened: true, muted: true }); expect(screen.getByRole('button', { name: 'Desensurdecer' })).toBeTruthy()
})
it('mostra Online e troca para o @usuário no hover', () => {
  render(<SelfIdentityView userId="u1" displayName="Leo" username="leo" />)
  expect(screen.getByText('Online')).toBeTruthy(); expect(screen.getByText('@leo').className).toContain('group-hover:inline')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/components/shell/UserArea.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

- **`UserArea`:** `absolute left-2 bottom-2 z-10 rounded-lg bg-panel border border-panel-border [--avatar-ring:var(--panel)]`, com largura `72 + channelListWidth - 16` px. Um `ResizeObserver` escreve a altura do cartão em `--user-area-height` no `data-content-frame` e no rail. A lista de canais e o rail ganham `pb-[calc(var(--user-area-height)+16px)]` na área rolável.
- **`VoiceConnectedSection`** (só com intenção de call), `p-2.5 border-b border-border`:
  - quadradinho 32px `rounded-md bg-voice/15` com `Signal` em `text-voice`. A cor segue a qualidade própria: excelente ou boa → `text-voice`; ruim → `text-warning`; perdida → `text-destructive`;
  - “Voz conectada” em `text-voice text-sm font-semibold` (“Conectando…”/“Reconectando…” em `text-warning`);
  - linha “canal / servidor” em `text-xs text-muted-foreground`, botão que chama `showStage()`;
  - à direita, desligar (`PhoneOff`, “Desconectar”);
  - linha de baixo: um botão largo `h-8 rounded-lg bg-secondary`, “Compartilhar tela” / “Parar de compartilhar”, com o mesmo `disabled` de hoje (L178).
  - Sem ping: o RTT do LiveKit é interno.
- **Linha de baixo:** `SelfIdentityView` (o clique abre o menu atual de Editar perfil / Copiar e-mail / Sair) e `SelfVoiceButtons`.
  - Avatar: `me.avatarUrl ?? user.profilePictureUrl`.
  - Segunda linha: `<span class="group-hover:hidden">Online</span><span class="hidden group-hover:inline">@leo</span>`.
- **`VoiceButtonsView`:** cada botão `h-8 rounded-md` com `ChevronDown` de 12px ao lado, que é o gatilho do `DeviceMenu`. Mutado: `MicOff` em `text-destructive` com `bg-destructive/15`. Mais a engrenagem com o `VoiceSettingsPopover` de hoje.
- **`DeviceMenu`:**
  - `DropdownMenu` com `DropdownMenuRadioGroup` dos dispositivos de `enumerateDevices()` do tipo pedido;
  - rótulo vazio vira `Dispositivo ${i + 1}`;
  - marca o atual (`inputDeviceId`/`outputDeviceId`, ou `default`);
  - selecionar chama `selectDevice`; se falhar, `toast.error('Não deu para trocar o dispositivo')`.

- [ ] **Step 4: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): cartão do usuário com voz conectada, setinhas de dispositivo e status"
```

---

### Task 8: Linha do tempo de mensagens

**Files:**
- Create: `src/renderer/src/lib/message-time.ts`, `src/renderer/src/lib/message-time.test.ts`
- Create: `src/renderer/src/lib/message-grouping.ts`, `src/renderer/src/lib/message-grouping.test.ts`
- Create: `src/renderer/src/hooks/useChatScroll.ts`, `src/renderer/src/hooks/useChatScroll.test.tsx`
- Create: `src/renderer/src/components/shell/MessageRowView.tsx`, `src/renderer/src/components/shell/MessageRowView.test.tsx`
- Create: `src/renderer/src/components/shell/ChatChrome.tsx` (`DaySeparator`, `UnreadDivider`, `ChannelWelcome`, `JumpToPresentBar`), `src/renderer/src/components/shell/ChatChrome.test.tsx`
- Modify: `src/renderer/src/components/shell/MessageList.tsx`, `src/renderer/src/components/shell/ConversationArea.tsx`

**Interfaces:**
- Consumes: `UserAvatar`, `displayNameOf` (Tarefa 2).
- Produces:
  - Horários:
    - `formatMessageTimestamp(ts: number, now: number): string`
    - `formatFullTimestamp(ts: number): string`
    - `formatShortTime(ts: number): string`
    - `formatDayLabel(ts: number): string`
  - Agrupamento:
    - `GROUP_WINDOW_MS = 7 * 60 * 1000`
    - `type TimelineItem<T> = { kind: 'day'; key: string; label: string } | { kind: 'unread'; key: 'unread' } | { kind: 'message'; key: string; message: T; isGroupStart: boolean }`
    - `buildTimeline<T>(messages: T[], opts: { getId(m: T): string; getAuthorId(m: T): string | null; getCreatedAt(m: T): number; unreadMessageId?: string | null }): TimelineItem<T>[]`. As mensagens entram em ordem cronológica.
  - `useChatScroll(opts: { viewportRef: RefObject<HTMLElement | null>; newestId?: string; oldestId?: string; canLoadMore: boolean; loadMore(): void; onReachBottom?(): void; initialScroll(viewport: HTMLElement): void }): { isViewingOld: boolean; newMessageCount: number; scrollToBottom(): void }`
  - `MessageRowView(props: { authorId: string | null; authorName: string; avatarUrl?: string | null; createdAt: number; now: number; isGroupStart: boolean; children: ReactNode })`. Os `children` são o conteúdo: texto, anexos e prévias.
  - `ChannelWelcome({ title, subtitle, icon }: { title: string; subtitle: string; icon: ReactNode })`
  - `JumpToPresentBar({ onJump }: { onJump(): void })`
  - `UnreadDivider()` (mantém `data-unread-divider="true"`)
  - `DaySeparator({ label }: { label: string })`

- [ ] **Step 1: Testes de horário**

Datas montadas em hora local (`new Date(2026, 10, 7, 23, 25)`), para não depender do fuso da máquina.

```ts
const now = new Date(2026, 10, 9, 10, 0).getTime()
it('hoje', () => expect(formatMessageTimestamp(new Date(2026, 10, 9, 8, 5).getTime(), now)).toBe('Hoje às 08:05'))
it('ontem', () => expect(formatMessageTimestamp(new Date(2026, 10, 8, 23, 25).getTime(), now)).toBe('Ontem às 23:25'))
it('dias antigos', () => expect(formatMessageTimestamp(new Date(2026, 10, 7, 23, 25).getTime(), now)).toBe('07/11/2026 23:25'))
it('ontem atravessando o ano', () =>
  expect(formatMessageTimestamp(new Date(2026, 11, 31, 23, 59).getTime(), new Date(2027, 0, 1, 0, 30).getTime())).toBe('Ontem às 23:59'))
it('data por extenso', () => expect(formatFullTimestamp(new Date(2026, 10, 7, 23, 25).getTime())).toBe('sábado, 7 de novembro de 2026 23:25'))
it('rótulo do dia', () => expect(formatDayLabel(new Date(2026, 10, 8, 1, 0).getTime())).toBe('8 de novembro de 2026'))
it('hora curta', () => expect(formatShortTime(new Date(2026, 10, 8, 9, 3).getTime())).toBe('09:03'))
```

Montar `formatFullTimestamp` em partes: dia da semana (`Intl` `weekday:'long'`), vírgula, data (`day:'numeric', month:'long', year:'numeric'`), espaço e `HH:mm`. Não usar um único `Intl` com hora, que acrescenta “às”.

- [ ] **Step 2: Testes de agrupamento**

```ts
const m = (id: string, author: string | null, h: number, min: number, day = 9) =>
  ({ id, author, at: new Date(2026, 10, day, h, min).getTime() })
const opts = { getId: (x) => x.id, getAuthorId: (x) => x.author, getCreatedAt: (x) => x.at }
const starts = (items) => items.filter(i => i.kind === 'message').map(i => i.isGroupStart)
it('mesma pessoa em 7 minutos agrupa', () => expect(starts(buildTimeline([m('1','a',10,0), m('2','a',10,6)], opts))).toEqual([true, false]))
it('mais de 7 minutos abre grupo novo', () => expect(starts(buildTimeline([m('1','a',10,0), m('2','a',10,8)], opts))).toEqual([true, true]))
it('outra pessoa abre grupo novo', () => expect(starts(buildTimeline([m('1','a',10,0), m('2','b',10,1)], opts))).toEqual([true, true]))
it('autor desconhecido nunca agrupa', () => expect(starts(buildTimeline([m('1',null,10,0), m('2',null,10,1)], opts))).toEqual([true, true]))
it('separador de data entre dias, e ele quebra o grupo', () => {
  const items = buildTimeline([m('1','a',23,58,8), m('2','a',0,1,9)], opts)
  expect(items.map(i => i.kind)).toEqual(['day', 'message', 'day', 'message'])
  expect(starts(items)).toEqual([true, true])
})
it('divisor NOVAS antes da primeira não lida, e ele quebra o grupo', () => {
  const items = buildTimeline([m('1','a',10,0), m('2','a',10,1)], { ...opts, unreadMessageId: '2' })
  expect(items.map(i => i.kind)).toEqual(['day', 'message', 'unread', 'message'])
  expect(starts(items)).toEqual([true, true])
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/message-time.test.ts src/renderer/src/lib/message-grouping.test.ts`
Expected: FAIL

- [ ] **Step 4: Implementar as duas libs**

- [ ] **Step 5: Testes de componente e do hook**

```tsx
// MessageRowView.test.tsx
it('início de grupo mostra foto, nome e horário', () => {
  renderRow({ isGroupStart: true, authorName: 'Leo' })
  expect(screen.getByText('Leo')).toBeTruthy(); expect(screen.getByText(/Hoje às/)).toBeTruthy()
})
it('continuação mostra só o texto e a hora na margem', () => {
  renderRow({ isGroupStart: false, authorName: 'Leo' })
  expect(screen.queryByText('Leo')).toBeNull(); expect(screen.getByText('10:00').className).toContain('group-hover:')
})
it('URL gigante quebra a linha', () => {
  const { container } = renderRow({ children: 'https://x.com/' + 'a'.repeat(300) })
  expect(container.querySelector('[data-message-content]')!.className).toContain('break-words')
})
// ChatChrome.test.tsx
it('divisor de não lidas é vermelho com NOVAS', () => {
  const { container } = render(<UnreadDivider />)
  expect(screen.getByText('NOVAS')).toBeTruthy(); expect(container.querySelector('[data-unread-divider="true"]')).toBeTruthy()
})
it('boas-vindas do canal', () => {
  render(<ChannelWelcome title="Boas-vindas a #geral!" subtitle="Este é o começo do canal #geral." icon={null} />)
  expect(screen.getByRole('heading', { name: 'Boas-vindas a #geral!' })).toBeTruthy()
})
it('faixa de mensagens antigas chama o pulo', async () => {
  const onJump = vi.fn(); render(<JumpToPresentBar onJump={onJump} />)
  expect(screen.getByText('Você está vendo mensagens antigas')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Ir para o presente' })); expect(onJump).toHaveBeenCalledOnce()
})
// useChatScroll.test.tsx: viewport falso com scrollTop/scrollHeight/clientHeight definidos por Object.defineProperty
it('perto do topo carrega mais', () => { /* scrollTop=100, canLoadMore=true, dispara 'scroll' */ expect(loadMore).toHaveBeenCalledOnce() })
it('marca que está vendo antigas quando sobe mais de uma tela', () => {
  /* scrollHeight=5000, clientHeight=600, scrollTop=3000 → 'scroll' */ expect(result.current.isViewingOld).toBe(true)
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/components/shell/MessageRowView.test.tsx src/renderer/src/components/shell/ChatChrome.test.tsx src/renderer/src/hooks/useChatScroll.test.tsx`
Expected: FAIL

- [ ] **Step 7: Implementar**

- **`useChatScroll`:** mover para o hook, sem mudar comportamento, a lógica de `MessageList.tsx` L256–419:
  - listener do viewport, `loadMore` com `scrollTop < 150`;
  - compensação de altura quando `oldestId` muda;
  - grudar no fundo quando chega mensagem e você está no fundo (100px);
  - `newMessageCount` e `scrollToBottom`.
  - Novo: `isViewingOld` (estado) = distância do fundo maior que `clientHeight`.
  - O posicionamento inicial no divisor (L256 + `DIVIDER_SCROLL_PADDING_PX`) vira o `initialScroll` passado pelo `MessageList`.
- **`MessageRowView`:**
  - linha `group relative pl-[72px] pr-12 py-0.5 hover:bg-accent`;
  - início de grupo: `mt-4` e `UserAvatar` 40 absoluto em `left-4 top-1`; nome em `text-base font-medium text-strong hover:underline`; horário `text-xs text-muted-foreground` com `Tooltip` mostrando `formatFullTimestamp`;
  - continuação: hora curta absoluta à esquerda, `opacity-0 group-hover:opacity-100 text-[11px]`;
  - conteúdo em `data-message-content`, `text-base leading-[1.375rem] text-foreground whitespace-pre-wrap break-words`. Se o texto for vazio (só anexo), não renderize a linha de texto.
- **`ChatChrome`:**
  - `DaySeparator`: linha `border-border` com o rótulo `text-xs font-semibold text-muted-foreground` no meio;
  - `UnreadDivider`: linha `border-destructive` com etiqueta `NOVAS` `bg-destructive text-white text-[10px] font-bold rounded px-1.5` à direita;
  - `ChannelWelcome`: círculo `size-[68px] bg-secondary` com o ícone, `h1` `text-[32px] font-bold text-strong`, subtítulo em `text-muted-foreground`;
  - `JumpToPresentBar`: faixa `bg-primary text-primary-foreground text-sm rounded-t-lg` colada acima da caixa de texto.
- **`MessageList`:**
  - usa `buildTimeline` (autor = `message.author?.userId ?? null`; `unreadMessageId` = `dividerMessageId`);
  - nome = `displayNameOf({ nickname: nicknameByUserId.get(id), displayName, username })`; recebe a nova prop `nicknameByUserId: Map<string, string>`;
  - nunca “Você” nem `#tag`;
  - `now` vem de um estado que atualiza a cada 60s;
  - `ChannelWelcome` no topo quando `status === 'Exhausted'`, com “Boas-vindas a #nome!” e “Este é o começo do canal #nome.”;
  - o botão flutuante “N novas mensagens ↓” (L412–419) vira `JumpToPresentBar`, mostrado quando `isViewingOld`.
- **`ConversationArea` / `TextChannelView`:**
  - `useQuery(api.channels.getChannel, { channelId })` dá o nome;
  - `useQuery(api.members.listServerMembers, channel ? { serverId: channel.serverId } : 'skip')` vira `nicknameByUserId`.

- [ ] **Step 8: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): mensagens agrupadas, horários e separadores do Discord, boas-vindas e pulo para o presente"
```

---

### Task 9: Anexos e prévias de link

**Files:**
- Modify: `src/renderer/src/lib/message-links.ts`, `src/renderer/src/lib/message-links.test.ts`
- Create: `src/renderer/src/lib/link-accent.ts`, `src/renderer/src/lib/link-accent.test.ts`
- Modify: `src/renderer/src/lib/attachments.ts`, `src/renderer/src/lib/attachments.test.ts`
- Modify: `src/renderer/src/components/shell/LinkPreviewCard.tsx`, `LinkPreviewCard.test.tsx`
- Create: `src/renderer/src/components/shell/ImageLightbox.tsx`, `src/renderer/src/components/shell/AttachmentGallery.tsx`, `src/renderer/src/components/shell/AttachmentGallery.test.tsx`
- Modify: `src/renderer/src/components/shell/MessageList.tsx` (`AttachmentItem` L105, prévia L172/L201)

**Interfaces:**
- Consumes: `MessageRowView` (Tarefa 8).
- Produces:
  - Links:
    - `linksOf(content: string, max?: number): string[]` (padrão 5, sem repetidos, na ordem)
    - `firstLinkOf` continua exportado (`linksOf(content, 1)[0] ?? null`)
  - `linkAccent(url: string): 'x' | 'youtube' | 'default'`
  - Anexos:
    - `isVideo(contentType?: string): boolean`
    - `isAudio(contentType?: string): boolean`
    - `mosaicColumns(imageCount: number): 1 | 2 | 3`
  - `AttachmentGallery({ attachments }: { attachments: MessageAttachment[] })` (o tipo já existe em `MessageList.tsx` L39–61; mova-o para `lib/attachments.ts` e exporte)
  - `ImageLightbox({ src, name, open, onOpenChange })`

- [ ] **Step 1: Testes das libs**

```ts
it('acha até 5 links', () => expect(linksOf(Array.from({ length: 6 }, (_, i) => `https://a.com/${i}`).join(' '))).toHaveLength(5))
it('tira repetidos e mantém a ordem', () => expect(linksOf('https://b.com https://a.com https://b.com')).toEqual(['https://b.com/', 'https://a.com/']))
it('corta pontuação do fim', () => expect(linksOf('olha https://a.com/x).')).toEqual(['https://a.com/x']))
it('firstLinkOf continua igual', () => expect(firstLinkOf('nada')).toBeNull())
it('X e Twitter são azuis', () => { for (const u of ['https://x.com/a', 'https://twitter.com/a', 'https://mobile.twitter.com/a']) expect(linkAccent(u)).toBe('x') })
it('YouTube é vermelho', () => { for (const u of ['https://www.youtube.com/watch?v=1', 'https://youtu.be/1', 'https://m.youtube.com/watch?v=1']) expect(linkAccent(u)).toBe('youtube') })
it('resto usa o destaque', () => expect(linkAccent('https://g1.globo.com')).toBe('default'))
it('vídeo e áudio', () => { expect(isVideo('video/mp4')).toBe(true); expect(isAudio('audio/ogg')).toBe(true); expect(isVideo('image/png')).toBe(false) })
it('mosaico', () => expect([1, 2, 3, 4, 5].map(mosaicColumns)).toEqual([1, 2, 3, 2, 3]))
```

Ajuste `linksOf('https://b.com …')` ao que o normalizador atual de `firstLinkOf` devolve (com ou sem `/` final); o teste deve espelhar a regra existente.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/message-links.test.ts src/renderer/src/lib/link-accent.test.ts src/renderer/src/lib/attachments.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar as libs**

- [ ] **Step 4: Testes de componente**

```tsx
it('prévia do X tem a barra azul', () => {
  mocks.useQuery.mockReturnValue({ url: 'https://x.com/a/1', status: 'ok', title: 'Post', siteName: 'X', fetchedAt: 1 })
  const { container } = render(<LinkPreviewCard url="https://x.com/a/1" />)
  expect(container.querySelector('[data-accent="x"]')!.className).toContain('border-embed-x')
})
it('imagem abre em tela cheia', async () => {
  render(<AttachmentGallery attachments={[img('foto.png')]} />)
  await userEvent.click(screen.getByRole('button', { name: 'Abrir foto.png' }))
  expect(screen.getByRole('dialog', { name: 'foto.png' })).toBeTruthy()
})
it('três imagens formam mosaico de 3 colunas', () => {
  const { container } = render(<AttachmentGallery attachments={[img('a.png'), img('b.png'), img('c.png')]} />)
  expect(container.querySelector('[data-mosaic]')!.getAttribute('data-columns')).toBe('3')
})
it('vídeo toca no chat', () => {
  const { container } = render(<AttachmentGallery attachments={[{ ...img('v.mp4'), contentType: 'video/mp4' }]} />)
  expect(container.querySelector('video[controls]')).toBeTruthy()
})
```

(Use URL única por teste no `LinkPreviewCard`, porque o `Set` de URLs pedidas é do módulo.)

- [ ] **Step 5: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/components/shell/LinkPreviewCard.test.tsx src/renderer/src/components/shell/AttachmentGallery.test.tsx`
Expected: FAIL

- [ ] **Step 6: Implementar**

- **`LinkPreviewCard`:**
  - `max-w-[432px] bg-card rounded border-l-4 p-3`, com `data-accent` e `border-embed-x` / `border-embed-youtube` / `border-primary`;
  - site em `text-xs text-muted-foreground`; título em `text-link font-semibold hover:underline`; descrição `text-sm`;
  - imagem com cantos 4px;
  - mantém o pedido único por URL e o “não ocupa espaço até ter título”.
- **Imagens:**
  - `max-w-[550px] max-h-[350px] object-contain rounded-lg`;
  - cada uma é um `button` “Abrir {nome}” que abre o `ImageLightbox`: `Dialog` com overlay `bg-stage/85`, a imagem até 90vw/90vh, `DialogTitle` com o nome em `sr-only`, e “Abrir original” em link externo;
  - várias imagens viram um grid com `data-mosaic` e `data-columns={mosaicColumns(n)}`;
  - arquivo vira cartão `bg-card border border-border rounded-lg p-3`: ícone, nome em `text-link`, tamanho com `formatBytes`, botão baixar;
  - vídeo: `<video controls>`; áudio: `<audio controls>`.
- **`MessageList`:** uma `LinkPreviewCard` por `linksOf(content)`.

- [ ] **Step 7: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): prévias por link com cor do site, mosaico de imagens, tela cheia e players"
```

---

### Task 10: Caixa de mensagem e “digitando”

**Files:**
- Modify: `src/renderer/src/components/shell/MessageInput.tsx`, `MessageInput.test.tsx`
- Create: `src/renderer/src/components/shell/FileDropOverlay.tsx`
- Create: `src/renderer/src/lib/typing-text.ts`, `src/renderer/src/lib/typing-text.test.ts`
- Modify: `src/renderer/src/components/shell/TypingIndicator.tsx`, `ConversationArea.tsx`, `AppShell.tsx`

**Interfaces:**
- Consumes: nome do canal via `getChannel` (Tarefa 8, já em `TextChannelView`).
- Produces:
  - `type MessageInputHandle = { addFiles(files: File[]): void }`
  - `MessageInput(props: { placeholder: string; onSend(content: string): void; onTyping?(): void; onSendWithAttachments?(content: string, files: File[]): Promise<void>; ref?: Ref<MessageInputHandle> })`
  - `typingText(names: string[]): string | null`
  - `FileDropOverlay({ channelName, active }: { channelName: string; active: boolean })`

- [ ] **Step 1: Testes**

```ts
// typing-text.test.ts
it('ninguém', () => expect(typingText([])).toBeNull())
it('uma pessoa', () => expect(typingText(['Drexx'])).toBe('Drexx está digitando…'))
it('duas pessoas', () => expect(typingText(['Drexx', 'VM'])).toBe('Drexx e VM estão digitando…'))
it('três ou mais', () => expect(typingText(['a', 'b', 'c'])).toBe('Várias pessoas estão digitando…'))
```

```tsx
// MessageInput.test.tsx: trocar getByPlaceholderText('Enviar mensagem...') por 'Conversar em #geral' (prop) e apagar o describe "botão de envio" (L122–141). Acrescentar:
it('não existe botão Enviar', () => { renderInput(); expect(screen.queryByRole('button', { name: 'Enviar mensagem' })).toBeNull() })
it('o “+” só aparece quando dá para anexar', () => {
  renderInput({ onSendWithAttachments: undefined }); expect(screen.queryByRole('button', { name: 'Enviar um arquivo' })).toBeNull()
})
it('colar imagem vira miniatura dentro da caixa', () => {
  renderInput({ onSendWithAttachments: vi.fn() })
  const file = new File(['x'], 'image.png', { type: 'image/png' })
  fireEvent.paste(screen.getByPlaceholderText('Conversar em #geral'), { clipboardData: { files: [file] } })
  expect(screen.getByRole('button', { name: 'Remover image.png' })).toBeTruthy()
})
it('addFiles pela ref também adiciona', () => {
  const ref = createRef<MessageInputHandle>(); renderInput({ onSendWithAttachments: vi.fn(), ref })
  act(() => ref.current!.addFiles([new File(['x'], 'a.txt', { type: 'text/plain' })]))
  expect(screen.getByRole('button', { name: 'Remover a.txt' })).toBeTruthy()
})
```

(No jsdom, faça stub de `URL.createObjectURL` e `URL.revokeObjectURL` com `vi.fn(() => 'blob:x')`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/typing-text.test.ts src/renderer/src/components/shell/MessageInput.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

- **Caixa:**
  - `mx-2 rounded-lg bg-composer border border-input min-h-[52px] flex items-start gap-3 px-4`;
  - `PlusCircle` de 22px “Enviar um arquivo” só com `onSendWithAttachments`;
  - textarea transparente `text-base placeholder:text-hint`;
  - sem botão Enviar; Enter e a guarda de IME de hoje (L126–136) ficam iguais.
- **Miniaturas:**
  - ficam dentro da caixa, acima do texto;
  - imagem via `URL.createObjectURL`, revogada ao remover ou desmontar; outros tipos com ícone de arquivo;
  - nome cortado e lixeira “Remover {nome}”.
- **Arquivos colados e soltos:** `onPaste` com arquivos chama `preventDefault` e o `handleFilesChosen` existente (L51). `addFiles` usa o mesmo caminho.
- **Arrastar:**
  - em `TextChannelView`, `onDragEnter`/`onDragOver`/`onDragLeave`/`onDrop` sobre a conversa. Com `dataTransfer.types` incluindo `Files`, mostra `FileDropOverlay` (camada `bg-stage/70` com cartão “Enviar para #nome”); soltar chama `inputRef.current.addFiles`;
  - em `AppShell`, `window` ganha `dragover`/`drop` com `preventDefault`, para o Electron não abrir o arquivo como página;
  - DM não ganha nada disso.
- **Texto de ajuda:** canal = `Conversar em #${channel.name}`.
- **`TypingIndicator`:**
  - vai para baixo da caixa;
  - faixa de altura fixa `h-6 px-4 text-sm` (sempre reservada); nomes em `font-bold`, sem itálico;
  - três pontinhos `size-1.5 rounded-full bg-foreground motion-safe:animate-bounce`, com atrasos de 0/150/300ms;
  - texto vem de `typingText`, com os nomes via `displayName ?? username`.

- [ ] **Step 4: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): caixa de mensagem do Discord, colar e arrastar arquivos, digitando embaixo"
```

---

### Task 11: Lista de membros e cabeçalho do chat

**Files:**
- Modify: `src/renderer/src/components/shell/MemberList.tsx`, `MemberName.tsx`, `MemberSectionHeader.tsx`, `MemberList.test.tsx`
- Modify: `src/renderer/src/components/shell/ParticipantAudioMenu.tsx`. Extrair `ParticipantAudioMenuItems`.
- Modify: `src/renderer/src/components/shell/ChannelHeader.tsx`

**Interfaces:**
- Consumes: `UserAvatar`, `displayNameOf` (Tarefa 2); `participantVolumes`, `setParticipantVolume`, `toggleParticipantSilenced` (já no `voice-context`).
- Produces:
  - `ParticipantAudioMenuItems(props: { username: string; preference: ParticipantAudioPreference | undefined; onVolumeChange(v: number): void; onToggleSilenced(): void })`. São só os itens; `ParticipantAudioMenu` passa a usá-los.
  - `MemberRow({ member, voiceState, isOwner, sendFriendRequest, audio })`, onde `audio?: { preference; onVolumeChange; onToggleSilenced }` vem só quando a pessoa está na sua call.

- [ ] **Step 1: Testes (em `MemberList.test.tsx`, ajustando os que esperam `#tag` e “ONLINE”)**

```tsx
it('nome sem #tag', () => { renderRow({}); expect(screen.queryByText(/#\d{4}/)).toBeNull() })
it('dono tem coroa', () => { renderRow({ isOwner: true }); expect(screen.getByLabelText('Dono do servidor')).toBeTruthy() })
it('quem está em call mostra Em voz', () => { renderRow({ voiceState: { speaking: false, muted: false, sharing: false, inVoice: true } }); expect(screen.getByText('Em voz')).toBeTruthy() })
it('compartilhando tela tem prioridade', () => { renderRow({ voiceState: { speaking: false, muted: false, sharing: true, inVoice: true } }); expect(screen.getByText('Compartilhando tela')).toBeTruthy() })
it('offline fica a 30%', () => { const { container } = renderRow({ online: false }); expect(container.firstElementChild!.className).toContain('opacity-30') })
it('clique direito em quem está na sua call mostra volume e silenciar', () => {
  renderRow({ audio: { preference: undefined, onVolumeChange: vi.fn(), onToggleSilenced: vi.fn() } })
  fireEvent.contextMenu(screen.getByRole('button', { name: /Leo/ }))
  expect(screen.getByRole('menuitemcheckbox', { name: 'Silenciar para mim' })).toBeTruthy()
})
it('nome longo corta com reticências e mantém o title', () => {
  renderRow({ displayName: 'Gordão Guerreiro do Norte da Silva' })
  const n = screen.getByText('Gordão Guerreiro do Norte da Silva'); expect(n.className).toContain('truncate')
})
it('cabeçalho de seção sem caixa alta', () => {
  render(<MemberSectionHeader label="Online" count={3} />)
  const h = screen.getByRole('heading', { name: 'Online — 3' }); expect(h.className).not.toContain('uppercase')
})
```

Hoje o `voiceState` é `{speaking, muted, sharing}`. Acrescente `inVoice: boolean`, derivado de estar em `voiceParticipantsByServer`. O papel do item “Silenciar para mim” deve ser o que o `ParticipantAudioMenu` já usa; ajuste o `getByRole` se ele não for `menuitemcheckbox`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/components/shell/MemberList.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

- **Coluna:** `w-60 bg-background border-l border-border px-2 [--avatar-ring:var(--background)]`.
- **Seções:** “Online — N” / “Offline — N”, em `text-sm font-medium text-muted-foreground pt-6 pb-1 px-2`.
- **Linha:**
  - `h-11 rounded-md px-2 gap-3 hover:bg-accent`;
  - `UserAvatar` 32 com status;
  - nome com `displayNameOf`, `text-base font-medium text-strong truncate`, `title`;
  - `Crown` de 14px `fill-current text-warning`, com `aria-label="Dono do servidor"`, quando `isOwner` (`servers.find(s => s._id === selectedServerId)?.ownerId === member.userId`);
  - segunda linha `text-xs text-muted-foreground`: `Volume2` 12px `text-voice` + “Em voz”, ou `MonitorUp` + “Compartilhando tela”;
  - offline: `opacity-30`.
- **`MemberName`:** sem `#tag`; o `title` continua `username#tag`.
- **Menus:** o clique esquerdo abre o menu de hoje (Copiar identificador / Adicionar amigo). O direito abre o mesmo menu, mais `DropdownMenuSeparator` e `ParticipantAudioMenuItems` quando `audio` existe.
- **`ChannelHeader`:**
  - `h-12 border-b border-border px-4 gap-2`;
  - `Hash` 24px `text-muted-foreground`; nome em `text-base font-semibold text-strong`;
  - botão de membros `text-icon`, que fica `text-strong` com `aria-pressed=true`.

- [ ] **Step 4: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): lista de membros do Discord com coroa, atividade e volume no clique direito"
```

---

### Task 12: Tela da call — blocos, grade e controles

**Files:**
- Create: `src/renderer/src/lib/call-grid.ts`, `src/renderer/src/lib/call-grid.test.ts`
- Create: `src/renderer/src/components/shell/ParticipantTile.tsx`, `src/renderer/src/components/shell/CallControls.tsx`, `src/renderer/src/components/shell/CallStageParts.test.tsx`
- Modify: `src/renderer/src/components/shell/CallStage.tsx` (tiles L93–125/L189, `StageBar` L364–365), `ParticipantStrip.tsx`, `ScreenShareStage.tsx`

**Interfaces:**
- Consumes: `UserAvatar`, `avatarColorIndex`, `AVATAR_TILE_BG` (Tarefa 2); `CallTimer`, `callStartedAt` (Tarefa 5); `toggleMuted`, `toggleDeafened`, `muted`, `deafened` (Tarefa 6); `DeviceMenu` (Tarefa 7).
- Produces:
  - `gridColumns(count: number): number`
  - `ParticipantTile(props: { userId: string; name: string; avatarUrl?: string | null; muted: boolean; speaking: boolean; onContextMenu?(e: MouseEvent): void })`
  - `CallControlsView(props: { visible: boolean; isSharing: boolean; canShare: boolean; muted: boolean; deafened: boolean; onToggleShare(): void; onToggleMute(): void; onToggleDeafen(): void; onLeave(): void; onFullscreen(): void; inputMenu: ReactNode; outputMenu: ReactNode })`
  - `useIdle(ms: number): { idle: boolean; bind: { onMouseMove(): void } }`

- [ ] **Step 1: Testes**

```ts
it('grade', () => expect([1, 2, 3, 4, 5, 6, 7, 9, 10].map(gridColumns)).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 4]))
```

```tsx
it('bloco de quem fala tem a borda verde', () => {
  const { container } = render(<ParticipantTile userId="u1" name="Leo" muted={false} speaking />)
  expect(container.firstElementChild!.getAttribute('data-speaking')).toBe('true')
})
it('bloco mutado mostra o mic cortado ao lado do nome', () => {
  render(<ParticipantTile userId="u1" name="Gordão" muted speaking={false} />); expect(screen.getByLabelText('Mutado')).toBeTruthy()
})
it('fundo do bloco vem da cor do id', () => {
  const { container } = render(<ParticipantTile userId="u1" name="Leo" muted={false} speaking={false} />)
  expect(container.firstElementChild!.className).toContain(AVATAR_TILE_BG[avatarColorIndex('u1')])
})
it('controles: sair chama o handler e mutado aparece pressionado', async () => {
  const onLeave = vi.fn(); renderControls({ muted: true, onLeave })
  expect(screen.getByRole('button', { name: 'Ativar microfone' }).getAttribute('aria-pressed')).toBe('true')
  await userEvent.click(screen.getByRole('button', { name: 'Sair da call' })); expect(onLeave).toHaveBeenCalledOnce()
})
it('controles escondidos ficam inertes', () => {
  const { container } = renderControls({ visible: false })
  expect(container.firstElementChild!.getAttribute('data-visible')).toBe('false')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/call-grid.test.ts src/renderer/src/components/shell/CallStageParts.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

- **`ParticipantTile`:**
  - `relative aspect-video rounded-lg overflow-hidden grid place-items-center` com `AVATAR_TILE_BG[n]` sobre `bg-stage`, e `UserAvatar` 80 no centro;
  - etiqueta no canto inferior esquerdo `bg-stage/60 text-strong text-sm font-semibold rounded-md px-2 py-0.5`, com `MicOff` 14px `text-destructive` (“Mutado”);
  - quem fala: `data-speaking` e `outline outline-2 -outline-offset-2 outline-success`;
  - o clique direito abre o `ParticipantAudioMenu` que já existe.
- **Grade:** `grid gap-2 p-4 content-center` com `gridTemplateColumns: repeat(${gridColumns(n)}, minmax(0, 1fr))`. Substitui os avatares soltos de L93–125/L189.
- **`StageBar`:** `h-12`; `Volume2` `text-icon`; nome `text-strong font-semibold`; `CallTimer`. Os controles de layout que já existem ficam à direita.
- **`CallControls`:**
  - barra `absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2`;
  - `data-visible`, mais `opacity-0 pointer-events-none` quando oculta; `useIdle(3000)` ligado ao `onMouseMove` do palco;
  - botões `h-11 min-w-[52px] rounded-xl bg-panel hover:bg-secondary`, nesta ordem: compartilhar tela; mic com setinha (`DeviceMenu` audioinput); fone com setinha (audiooutput); separador; sair (`bg-destructive`, “Sair da call”);
  - à direita, tela cheia (`requestFullscreen` no elemento do palco).
- **`ParticipantStrip` e `ScreenShareStage`:** trocam as iniciais por `UserAvatar` e o `username` por `displayNameOf`.

- [ ] **Step 4: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): tela da call com blocos 16:9, grade e barra de controles"
```

---

### Task 13: “Assistir transmissão” (caminho de voz)

**Files:**
- Create: `src/renderer/src/lib/stream-subscription.ts`, `src/renderer/src/lib/stream-subscription.test.ts`
- Modify: `src/renderer/src/state/voice-context.tsx`:
  - `new Room()` L272 e `room.connect` L1338;
  - listeners de publicação perto de L927–1034;
  - `Disconnected` L1125–1129.
- Modify: `src/renderer/src/components/shell/CallStage.tsx` (troca automática para `share` L439–453), `ParticipantTile.tsx`, `ScreenShareStage.tsx`

**Interfaces:**
- Consumes: `ParticipantTile` (Tarefa 12); `sharing` de `voiceParticipantsByChannel`.
- Produces:
  - `shouldAutoSubscribe(source: Track.Source): boolean`. É `false` só para `ScreenShare` e `ScreenShareAudio`.
  - `VoiceContextValue` ganha `watchedScreenShares: ReadonlySet<string>`, `watchScreenShare(identity: string): void` e `stopWatchingScreenShare(identity: string): void`.
  - `ParticipantTile` ganha `live?: { watching: boolean; onWatch(): void }`.

- [ ] **Step 1: Testes**

```ts
it('mic e câmera continuam automáticos', () => { expect(shouldAutoSubscribe(Track.Source.Microphone)).toBe(true); expect(shouldAutoSubscribe(Track.Source.Camera)).toBe(true) })
it('tela e som da tela esperam o clique', () => { expect(shouldAutoSubscribe(Track.Source.ScreenShare)).toBe(false); expect(shouldAutoSubscribe(Track.Source.ScreenShareAudio)).toBe(false) })
it('fonte desconhecida é automática', () => expect(shouldAutoSubscribe(Track.Source.Unknown)).toBe(true))
```

```tsx
it('bloco ao vivo mostra AO VIVO e Assistir transmissão', async () => {
  const onWatch = vi.fn()
  render(<ParticipantTile userId="u1" name="VM" muted={false} speaking={false} live={{ watching: false, onWatch }} />)
  expect(screen.getByText('AO VIVO')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Assistir transmissão' })); expect(onWatch).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/stream-subscription.test.ts src/renderer/src/components/shell/CallStageParts.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

- **Conexão:** `room.connect(url, token, { autoSubscribe: false })`.
- **Assinatura automática:**
  - em `RoomEvent.TrackPublished` (remoto), `pub.setSubscribed(true)` quando `shouldAutoSubscribe(pub.source)` ou quando `watchedScreenShares` tem o participante;
  - logo depois de `await room.connect(…)`, faça a mesma passada por `room.remoteParticipants` e suas `trackPublications`. Publicações de quem já estava na sala chegam durante a conexão e não disparam o evento. **Se uma publicação de mic escapar, a pessoa fica muda**: confira isso no checkpoint.
- **`watchScreenShare(identity)`:** adiciona ao conjunto e chama `setSubscribed(true)` nas publicações `ScreenShare` e `ScreenShareAudio` desse participante. `stopWatchingScreenShare` faz o contrário com `false`.
- **Limpeza:** `Disconnected` limpa o conjunto.
- **Sem mudança:** volume por pessoa e a anexação de áudio (L743–776, L804–833).
- **Tela da call:**
  - quem tem `sharing` e não é você recebe `live` no bloco;
  - assistir leva ao modo `share`: a troca automática de L448 continua baseada em `screenShareTracks`, que agora só cresce quando você assiste ou transmite;
  - na transmissão focada, botão “Parar de assistir”;
  - a sua própria transmissão aparece sem clique (trilha local, já em `screenShareTracks` com `isLocal`).

- [ ] **Step 4: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(voz): transmissão de tela só para quem clica em Assistir, vídeo e som"
```

- [ ] **Step 5: Checkpoint em call real (Windows, 3+ pessoas)**

1. Quem entra numa call em andamento ouve todo mundo, inclusive quem já estava antes (o teste da passada pós-conexão).
2. A começa a transmitir com som do jogo: B não vê nem ouve até clicar em “Assistir transmissão”.
3. B clica: vê e ouve; o volume da pessoa A no clique direito vale para a voz e para o som da transmissão.
4. B clica em “Parar de assistir”: o vídeo e o som da transmissão param, e a voz de A continua.
5. Cair e reconectar o Wi-Fi de B no meio: B volta ouvindo todos e, se estava assistindo, continua assistindo.
6. A vê a própria prévia sem clicar.

Se algum item falhar, pare e conserte antes da Tarefa 14.

---

### Task 14: Início, amigos e DMs

**Files:**
- Modify: `convex/dms.ts` (`listMyDmChannels` L126), `convex/friends.ts` (nova `listOutgoingFriendRequests`). Testes de backend no arquivo de teste existente desses módulos; se não houver, criar `convex/friends.test.ts` no padrão de `convex/voice.test.ts`.
- Create: `src/renderer/src/lib/friends-tabs.ts`, `src/renderer/src/lib/friends-tabs.test.ts`
- Modify: `src/renderer/src/components/friends/FriendsPanel.tsx`, `DmSidebar.tsx`, `DmConversationView.tsx`, `DmMessageList.tsx`
- Modify: `src/renderer/src/components/shell/AppShell.tsx` (L126: `key={selectedDmChannelId}` no `DmConversationView`)
- Create: `src/renderer/src/components/friends/FriendRowView.tsx`, `src/renderer/src/components/friends/FriendRowView.test.tsx`

**Interfaces:**
- Consumes: `buildTimeline`, `MessageRowView`, `ChannelWelcome`, `useChatScroll`, `JumpToPresentBar` (Tarefa 8); `linksOf`, `LinkPreviewCard` (Tarefa 9); `MessageInput` com `placeholder` (Tarefa 10); `UserAvatar`, `displayNameOf` (Tarefa 2).
- Produces:
  - `listMyDmChannels` devolve `otherUser.online: boolean` (via `presence.by_user` + `isOnline`).
  - `api.friends.listOutgoingFriendRequests(): { requestId; toUserId; username; tag; displayName; avatarUrl? }[]` (índice `by_from_to` com prefixo `fromUserId`).
  - `type FriendsTab = 'online' | 'todos' | 'pendente' | 'adicionar'`
  - `friendsForTab(friends: { online: boolean }[], tab: 'online' | 'todos'): typeof friends`
  - `FriendRowView(props: { userId; displayName; username; avatarUrl?; online: boolean; onMessage?(): void; menu?: ReactNode; pending?: 'recebido' | 'enviado'; onAccept?(): void; onReject?(): void })`

- [ ] **Step 1: Testes de backend**

- `listMyDmChannels` devolve `online: true` para quem tem `presence.lastSeen` recente e `false` sem presença.
- `listOutgoingFriendRequests` lista só os pedidos que eu enviei.

Run: `npx vitest run convex/friends.test.ts` (ou o arquivo existente) → FAIL; implementar → PASS.

- [ ] **Step 2: Testes de front**

```ts
it('aba Online filtra', () => expect(friendsForTab([{ online: true }, { online: false }], 'online')).toHaveLength(1))
it('aba Todos mostra todos', () => expect(friendsForTab([{ online: true }, { online: false }], 'todos')).toHaveLength(2))
```

```tsx
it('linha de amigo mostra nome, status e Mensagem', async () => {
  const onMessage = vi.fn(); render(<FriendRowView userId="u1" displayName="VM" username="vm" online onMessage={onMessage} />)
  expect(screen.getByText('VM')).toBeTruthy(); expect(screen.getByText('Online')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Mensagem' })); expect(onMessage).toHaveBeenCalledOnce()
})
it('pedido enviado não tem botão de cancelar', () => {
  render(<FriendRowView userId="u1" displayName="VM" username="vm" online={false} pending="enviado" />)
  expect(screen.getByText('Pedido de amizade enviado')).toBeTruthy(); expect(screen.queryByRole('button', { name: /Cancelar/ })).toBeNull()
})
it('pedido recebido tem aceitar e recusar', () => {
  render(<FriendRowView userId="u1" displayName="VM" username="vm" online={false} pending="recebido" onAccept={vi.fn()} onReject={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Aceitar' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Recusar' })).toBeTruthy()
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/renderer/src/lib/friends-tabs.test.ts src/renderer/src/components/friends/FriendRowView.test.tsx`
Expected: FAIL

- [ ] **Step 4: Implementar**

- **`DmSidebar`:**
  - linha “Amigos” com `Users`, `bg-secondary text-strong` quando a tela de amigos está aberta;
  - título “Mensagens diretas” em `text-sm font-medium text-muted-foreground px-2 pt-4 pb-1`;
  - cada DM: `UserAvatar` 32 com status (`online`), `displayNameOf(otherUser)` em `text-base font-medium truncate`; selecionada `bg-secondary text-strong`, hover `bg-sidebar-accent`;
  - `otherUser` nulo vira “Usuário desconhecido”.
- **`FriendsPanel`:**
  - cabeçalho `h-12 border-b border-border`: `Users`, “Amigos”, divisor vertical e abas `role="tab"` (Online, Todos, Pendente; ativa em `bg-secondary text-strong`), mais o botão “Adicionar amigo” em `bg-primary text-primary-foreground` (vira `text-primary` sem fundo quando ativo);
  - contagem `text-xs font-semibold text-muted-foreground` (“Online — 4”);
  - Pendente: seções “Recebidos — N” (aceitar/recusar) e “Enviados — N” (“Pedido de amizade enviado”);
  - linhas com `FriendRowView` e, no hover, Mensagem e “…” (menu com Remover amizade);
  - a aba Adicionar mantém o formulário de hoje, restilizado.
- **`DmConversationView`:**
  - cabeçalho `h-12 border-b`: `UserAvatar` 24 com status e nome `text-strong font-semibold`;
  - o botão “Carregar mensagens antigas” (L75–81) sai: `useChatScroll` carrega sozinho;
  - texto de ajuda `Conversar com @${displayNameOf(otherUser)}`; sem anexos.
- **`DmMessageList`:**
  - `buildTimeline` + `MessageRowView`; autor = `otherUser` ou eu (`useQuery(api.users.me)`); sem “Você”;
  - `ChannelWelcome` no topo quando esgotado: `UserAvatar` 80, título `displayNameOf(otherUser)` e “Este é o começo do seu histórico de mensagens diretas com @username.”;
  - uma `LinkPreviewCard` por `linksOf`;
  - `JumpToPresentBar` quando `isViewingOld`.

- [ ] **Step 5: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): Início, amigos e DMs no estilo do Discord, com status e pedidos enviados"
```

---

### Task 15: Telas de apoio

**Files:**
- Modify: `src/renderer/src/features/auth/LoginScreen.tsx`, `AuthGate.tsx` (`TelaDeEspera`, `ContaIndisponivel`), `src/renderer/src/components/boundary/RootErrorBoundary.tsx`, `src/renderer/src/main.tsx` (`NotConfiguredScreen` L37–52)
- Modify: `src/renderer/src/platform/electron/ScreenSharePicker.tsx`, `src/renderer/src/components/shell/MicTestPanel.tsx`, `VoiceSettingsPopover.tsx`, `CreateOrJoinServerDialog.tsx`, `CreateChannelDialog.tsx`, `InviteDialog.tsx`, `EditProfileDialog.tsx`
- Create: `src/renderer/src/components/brand/SplashScreen.tsx`, `src/renderer/src/components/brand/SplashScreen.test.tsx`

**Interfaces:**
- Produces: `SplashScreen({ message, children }: { message: string; children?: ReactNode })`. É a estrela de 64px no centro, a mensagem embaixo e ações opcionais.

- [ ] **Step 1: Teste**

```tsx
it('mostra a estrela e a mensagem', () => {
  render(<SplashScreen message="Carregando…" />)
  expect(screen.getByRole('img', { name: 'Hydra' })).toBeTruthy(); expect(screen.getByText('Carregando…')).toBeTruthy()
})
```

Run: `npx vitest run src/renderer/src/components/brand/SplashScreen.test.tsx` → FAIL; implementar → PASS.

- [ ] **Step 2: Restilizar, sem mudar comportamento nem textos**

- **`SplashScreen`:** `h-screen grid place-items-center bg-sidebar`, `HydraMark` `size-16 text-strong` e mensagem `text-sm text-muted-foreground`.
- **Telas que passam a usar o `SplashScreen`:**
  - `TelaDeEspera`;
  - `ContaIndisponivel`, com as ações atuais como `children`;
  - fallback do `RootErrorBoundary` (mensagem de erro + “Recarregar” em `bg-primary`);
  - `NotConfiguredScreen`.
- **`LoginScreen`:**
  - fundo `bg-sidebar`;
  - cartão `w-[480px] max-w-[calc(100vw-32px)] bg-panel border border-panel-border rounded-lg p-8 flex flex-col items-center gap-4`;
  - `HydraMark size-12`, “Hydra” em `text-2xl font-bold text-strong`;
  - botão “Entrar com Google” `w-full h-11 bg-primary`.
- **Seletor de tela, testador de microfone, popover de voz e diálogos:**
  - conteúdo `bg-popover rounded-lg`, título `text-xl font-bold text-strong` (já vem do `dialog.tsx` da Tarefa 2);
  - rodapé de botões `bg-sidebar -mx-6 -mb-6 px-6 py-4 rounded-b-lg flex justify-end gap-2`, com cancelar `variant="ghost"` e confirmar `bg-primary`;
  - campos `bg-sidebar border-input`;
  - miniaturas do seletor `rounded-lg`, com a selecionada em `outline outline-2 outline-primary`.

- [ ] **Step 3: Rodar tudo e commit**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

```bash
git add -A && git commit -m "feat(ui): login, carregamento, erro, seletor de tela e diálogos no estilo do Discord"
```

---

### Task 16: Verificação final e checkpoint no Windows

**Files:** nenhum novo.

- [ ] **Step 1: Os quatro comandos do §4 do spec**

Run: `npm run typecheck && npm run build && npm run build:web && npx vitest run && node scripts/verify-web-bundle.mjs`
Expected: tudo com saída 0; nenhum teste falhando.

- [ ] **Step 2: Nada sobrou no visual antigo**

Run: `grep -rn "'Você'\|#{tag}\|#{.*\.tag}\|uppercase" src/renderer/src/components src/renderer/src/features --include=*.tsx | grep -v "\.test\."`
Expected: revisar cada ocorrência. Não pode sobrar “Você” como nome de autor, `#tag` em nome exibido (fora de `title` e de “copiar identificador”) nem rótulo de seção em `uppercase`. Os textos em maiúscula legítimos, como “AO VIVO” e “NOVAS”, ficam escritos assim no próprio texto, não pela classe.

- [ ] **Step 3: Fonte não inlinada**

Run: `grep -l "data:font" dist-web/assets/*.css; echo "exit=$?"`
Expected: `exit=1`

- [ ] **Step 4: Checkpoint visual com o Leo (Windows, Discord aberto ao lado, mesma resolução)**

Conferir região por região do spec §5.2–§5.12, em posição, tamanho, cor e estados (hover, aberto, não lido, falando, mutado, ao vivo):
- barra de título e voltar/avançar;
- rail;
- lista de canais (recolher, alargar, clique direito, call com cronômetro);
- cartão do usuário;
- cabeçalho;
- mensagens (grupo, horário, data, NOVAS, boas-vindas, pulo para o presente, imagem em tela cheia, prévias);
- caixa de mensagem (colar, arrastar, digitando);
- membros (coroa, Em voz, clique direito com volume);
- tela da call (grade, controles, assistir);
- Início, Amigos, DM;
- login, carregamento, seletor de tela, testador de microfone, popover de voz, diálogos.

Anotar cada divergência como item para corrigir antes de considerar a rodada pronta.
