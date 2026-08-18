# Research: Fase 3 — Shell da UI

**Domain:** Layout estático de app desktop estilo Discord (Electron + React + Tailwind + shadcn/ui), sem dados reais
**Researched:** 2026-08-18
**Confidence:** MEDIUM-HIGH nos componentes shadcn/ui (docs oficiais consultadas); MEDIUM nas proporções de layout do Discord (conhecimento de comunidade/observação direta do produto — Discord não publica um design system público com valores em pixel, marcado caso a caso)

> Este arquivo cobre apenas o necessário para planejar F3. Armadilhas de
> voz/mídia já estão em `.planning/research/PITFALLS.md` e não se aplicam
> aqui — F3 não tem LiveKit nem Convex.

## 1. Estrutura de layout do Discord

Discord não publica specs de design em pixels (as brand guidelines só cobrem
logo/cor). Os valores abaixo vêm de observação direta do cliente oficial e são o
consenso usado por praticamente todo clone de Discord em tutoriais públicos
(ex.: o clone Next.js de Antônio Erdeljac, referência mais citada da comunidade
React para este layout específico). Confiança MEDIUM — são medidas aproximadas,
não uma spec oficial, mas suficientes porque o requisito (APP-01) é "replica a
estrutura", não "pixel-perfect".

| Região | Largura/altura aproximada | Comportamento |
|---|---|---|
| Barra de servidores (rail) | ~72px, largura fixa | Coluna mais à esquerda, ícones circulares empilhados, não encolhe nem cresce com a janela |
| Sidebar de canais | ~240px, largura fixa | Lista de canais do servidor selecionado; no Discord real não é arrastável pelo usuário |
| Área de conversa | flexível (resto do espaço) | Única região que cresce/encolhe com a janela |
| Lista de membros | ~240px, largura fixa | Pode ser escondida via toggle no Discord real, mas F3 não precisa desse toggle (fora do escopo, não é um requisito v1) |
| Cabeçalho do canal | ~48px, altura fixa | Topo da área de conversa, nome do canal + ícone |
| Campo de mensagem | altura mínima ~44px, cresce com quebras de linha | Rodapé da área de conversa |

**Decisão de design derivada:** larguras das colunas laterais são **fixas em
pixel** (`w-[72px]`, `w-60` = 240px), não percentuais nem arrastáveis pelo
usuário. Isso é fiel ao comportamento real do Discord (só a área de conversa é
elástica) e simplifica a implementação — nenhuma lib de resize é necessária
(ver §3).

## 2. Componentes shadcn/ui por região

Consultado via WebFetch em `ui.shadcn.com/docs/components/*` (docs oficiais,
2026-08-18).

| Região | Componente shadcn | Uso | Customização pesada necessária? |
|---|---|---|---|
| Barra de servidores | `Avatar` (`AvatarImage` + `AvatarFallback`) + `Tooltip` | Ícone do servidor + tooltip com nome ao hover (padrão Discord) | Baixa — precisa de wrapper para o indicador de "servidor ativo" (barra branca à esquerda do ícone), que não existe pronto no componente |
| Sidebar de canais | `ScrollArea`, `Separator`, `Badge` | Lista rolável de canais, separador entre categorias, badge de contagem de não lidas | Média — categorias colapsáveis e indentação de canal de voz com avatares aninhados não vêm prontos, são composição custom sobre esses primitivos |
| Avatares com status/fala | `Avatar` + `AvatarBadge` | `AvatarBadge` posiciona um indicador (ex. bolinha verde) no canto inferior direito do avatar — API oficial documentada para status online/offline | Média — o **anel de "está falando"** (ring ao redor do avatar) não é um badge, é um `className` de anel (`ring-2 ring-green-500` condicional) aplicado ao `Avatar` raiz, não ao badge |
| Área de conversa | `ScrollArea`, `Separator`, `Textarea`, `Button` | Lista de mensagens rolável, divisor de "novas mensagens", campo de texto, botão de enviar | Baixa |
| Lista de membros | `ScrollArea`, `Avatar` + `AvatarBadge`, `Separator` | Mesma composição da sidebar de canais, agrupada por status | Baixa |
| Controles de voz (rodapé) | `Button`, `Tooltip`, `Avatar` | Botões de mute/deafen (ícone toggla estado local), tooltip explicando cada botão | Baixa |

### Achado importante: NÃO usar `Resizable`

O componente `ResizablePanelGroup`/`ResizablePanel` do shadcn (sobre
`react-resizable-panels`) foi avaliado e **descartado para o shell principal**.
Motivos:

1. Discord real não permite arrastar a borda entre rail/sidebar/membros — são
   larguras fixas (§1). Usar `Resizable` resolveria um problema que não existe
   no produto que estamos replicando.
2. A API mudou entre versões majors da lib (`direction` → `orientation`,
   `defaultSize` mudou de unidade) — depender dela introduz risco de
   incompatibilidade com a versão que o CLI do shadcn instalar no bootstrap,
   sem nenhum ganho de UX aqui.

Flexbox comum com larguras fixas (`flex-none w-[72px]`, `flex-none w-60`) e uma
coluna `flex-1 min-w-0` para a área de conversa resolve tudo com menos
superfície de erro. Ver padrão de código em §3.

## 3. Padrão de layout que sobrevive a redimensionamento

O erro mais comum em layouts de 3-4 colunas com Flexbox é **filhos flex que não
encolhem** porque o `min-width`/`min-height` inicial de um flex item é `auto`
(não `0`), fazendo o conteúdo interno (texto longo, listas) forçar a coluna a
crescer além do espaço disponível e vazar a barra de rolagem horizontal da
janela inteira. Isso é bem documentado no próprio CSS Flexbox spec e é a causa
nº1 de "layout quebra ao redimensionar" em apps com sidebar + conteúdo.

**Padrão robusto (usado neste plano):**

```tsx
// Container raiz: ocupa a janela inteira, nunca gera scroll na própria janela
<div className="h-screen w-screen overflow-hidden flex">

  {/* Colunas fixas: flex-none impede que estas colunas encolham OU cresçam */}
  <div className="flex-none w-[72px] ...">{/* Barra de servidores */}</div>
  <div className="flex-none w-60 ...">{/* Sidebar de canais */}</div>

  {/* Coluna elástica: flex-1 cresce/encolhe; min-w-0 é o pulo do gato —
      sem isso, conteúdo largo (mensagem longa, nome comprido) empurra a
      coluna além do espaço disponível */}
  <div className="flex-1 min-w-0 flex flex-col">
    <div className="flex-none h-12">{/* Cabeçalho do canal */}</div>
    {/* min-h-0 é o equivalente vertical do min-w-0 — necessário para que
        ScrollArea/overflow-y-auto realmente limite a altura em vez de
        empurrar o rodapé para fora da tela */}
    <div className="flex-1 min-h-0 overflow-y-auto">{/* Mensagens */}</div>
    <div className="flex-none">{/* Campo de mensagem */}</div>
  </div>

  <div className="flex-none w-60 ...">{/* Lista de membros */}</div>
</div>
```

Regra geral a aplicar em toda a Fase 3: **todo container flex que tem um filho
com `overflow-y-auto`/`ScrollArea` precisa de `min-h-0` (se for `flex-col`) ou
`min-w-0` (se for `flex-row`) no próprio filho que rola.** Sem isso o scroll
interno não funciona e o overflow vaza para a janela.

Não são necessárias media queries — a única coluna que responde ao tamanho da
janela é a central (`flex-1`), e ela já se ajusta automaticamente porque as
outras três são `flex-none` com largura fixa. O único guarda-corpo adicional
necessário é um `minWidth`/`minHeight` na janela do Electron (`src/main/index.ts`,
`BrowserWindow`) — sem ele, a janela pode ficar menor que a soma das três
colunas fixas (72 + 240 + 240 = 552px) mais um mínimo utilizável para a área de
conversa, quebrando o layout de um jeito que nenhum CSS resolve (não há espaço
físico). Recomendação: `minWidth: 900, minHeight: 600`.

## 4. Ícones

shadcn/ui não inclui um pacote de ícones — a convenção quase universal (usada
nos exemplos oficiais da própria documentação shadcn) é `lucide-react`. Como o
bootstrap (F0) já instala shadcn/ui, `lucide-react` deveria já estar disponível
como dependência transitiva dos componentes gerados; se não estiver, é
`npm install lucide-react` — pacote leve, sem dependências nativas, sem risco.
Ícones necessários nesta fase: `Hash` (canal de texto), `Volume2` (canal de
voz), `Mic`/`MicOff`, `Headphones`/`HeadphoneOff` (deafen), `ChevronDown`
(categoria colapsável), `Send` (enviar mensagem), `MonitorUp` (placeholder de
compartilhamento de tela para F8).

## 5. Estado de seleção (servidor/canal ativos)

Não há necessidade de biblioteca de estado global nesta fase. O app ainda não
tem múltiplas telas roteadas (isso também não é requisito desta fase), só um
shell com regiões que reagem à mesma seleção. `React.createContext` +
`useState` no componente raiz (`AppShell`) é suficiente e não introduz
dependência nova fora da stack já decidida (`PROJECT.md` marca a stack como
"decidido no design, não reabrir sem motivo forte"). Quando F4 substituir os
dados mockados por Convex, esse mesmo contexto de seleção provavelmente
sobrevive (a seleção de servidor/canal continua sendo estado de UI puro, não
dado de domínio) — vale reaproveitar a mesma interface (`selectedServerId`,
`selectedChannelId`, `setSelectedServerId`, `setSelectedChannelId`) para minimizar
retrabalho.

## 6. Fontes

- https://ui.shadcn.com/docs/components/resizable (WebFetch, 2026-08-18)
- https://ui.shadcn.com/docs/components/scroll-area (WebFetch, 2026-08-18)
- https://ui.shadcn.com/docs/components/avatar (WebFetch, 2026-08-18)
- Conhecimento de comunidade sobre proporções do Discord (MEDIUM confidence,
  sem doc oficial — consistente com o tratamento dado a fatos equivalentes em
  `.planning/research/FEATURES.md`)
- CSS Flexbox `min-width: auto` initial value — comportamento padrão da spec,
  causa raiz documentada de overflow em layouts de sidebar

---
*Research for: Fase 3 — Shell da UI (janja)*
