---
phase: 05-chat-em-tempo-real
plan: 05
type: execute
wave: 4
depends_on: ["05-03", "05-04"]
files_modified:
  - src/renderer/src/components/shell/MessageInput.tsx
  - src/renderer/src/components/shell/TypingIndicator.tsx
  - src/renderer/src/components/shell/ConversationArea.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário digitando num canal faz os outros membros verem 'fulano está digitando' em poucos segundos"
    - "Parar de digitar (ou o app travar no meio da digitação) faz o indicador sumir sozinho, sem exigir nenhum evento explícito de 'parei'"
    - "Digitar rápido não gera uma mutation por tecla — no máximo uma a cada ~2s por usuário por canal"
  artifacts:
    - path: "src/renderer/src/components/shell/TypingIndicator.tsx"
      provides: "Componente que lê convex/typing.ts:listTyping e aplica TTL client-side via tick de 1s"
      exports: ["TypingIndicator"]
  key_links:
    - from: "src/renderer/src/components/shell/MessageInput.tsx"
      to: "src/renderer/src/components/shell/ConversationArea.tsx (TextChannelView)"
      via: "prop onTyping opcional, chamada a cada tecla — quem decide throttle/chamar convex/typing.ts é o chamador, não o MessageInput"
      pattern: "onTyping"
    - from: "src/renderer/src/components/shell/TypingIndicator.tsx"
      to: "convex/typing.ts (listTyping)"
      via: "useQuery(api.typing.listTyping, { channelId }) + setInterval(1000) local para recalcular quem ainda conta como 'digitando'"
      pattern: "listTyping"
---

<objective>
Ligar a UI do indicador de "está digitando" (CHAT-07) ao backend do plano 05-03,
mantendo `MessageInput.tsx` genérico (a Fase 6 já planeja reaproveitá-lo como está,
`onSend` puro, para a conversa de DM — ver nota de contexto abaixo) e implementando a
expiração puramente no cliente via tick de 1s, exatamente como justificado em
`05-RESEARCH.md §7`.

Purpose: sem este plano, `convex/typing.ts` (05-03) não tem nenhum consumidor — CHAT-07
fica implementado no backend mas invisível para o usuário.
Output: indicador visível abaixo da lista de mensagens, atualizado em tempo real, some
sozinho após alguns segundos sem digitação.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/05-chat-em-tempo-real/05-RESEARCH.md
@.planning/phases/05-chat-em-tempo-real/05-03-digitando-backend-PLAN.md
@src/renderer/src/components/shell/MessageInput.tsx
@src/renderer/src/components/shell/ConversationArea.tsx
@src/renderer/src/components/ui/avatar.tsx

# IMPORTANTE: 06-RESEARCH.md §7 (Fase 6, pesquisa já feita em paralelo) registra que
# MessageInput.tsx "é reaproveitado como está" pela conversa de DM, genérico por
# `onSend` — SEM saber de channelId de servidor. Este plano NÃO pode amarrar
# MessageInput.tsx a `convex/typing.ts`/`channelId` diretamente, ou quebra essa premissa
# de reuso da Fase 6 (que roda em paralelo e não coordena com este plano). Solução: um
# único prop novo, OPCIONAL, `onTyping?: () => void`, sem nenhum conhecimento de Convex
# dentro de MessageInput.tsx — quem decide throttle e chama a mutation é o chamador
# (ConversationArea, Task 3 abaixo). Se a Fase 6 nunca passar essa prop, MessageInput
# continua funcionando exatamente como está hoje, sem nenhuma mudança de comportamento.
#
# Depende do plano 05-04 (ConversationArea.tsx já reescrito lá) — roda depois para não
# haver dois planos editando o mesmo arquivo em paralelo (mesma razão de sequenciamento
# de qualquer plano que toque um arquivo já tocado por outro).
</context>

<tasks>

<task type="auto">
  <name>Task 1: MessageInput ganha onTyping opcional</name>
  <files>src/renderer/src/components/shell/MessageInput.tsx</files>
  <action>
    Adicionar um prop opcional `onTyping?: () => void` a `MessageInputProps`, chamado
    dentro do handler de `onChange` do `Textarea` (antes ou depois de `setContent`, não
    importa a ordem) — sem debounce/throttle aqui, isso é responsabilidade de quem
    fornece a função (Task 3). Não importar nada de Convex neste arquivo — o componente
    continua sem saber o que `onTyping` faz por trás.
    ```tsx
    type MessageInputProps = {
      onSend: (content: string) => void
      onTyping?: () => void
    }

    export function MessageInput({ onSend, onTyping }: MessageInputProps): React.JSX.Element {
      const [content, setContent] = useState('')

      function handleChange(value: string): void {
        setContent(value)
        onTyping?.()
      }
      // ... resto do componente igual, trocando onChange={(e) => setContent(e.target.value)}
      // por onChange={(e) => handleChange(e.target.value)}
    }
    ```
  </action>
  <verify>`npm run typecheck:web` passa. `MessageInput.tsx` continua funcionando sem passar `onTyping` (prop opcional) — não quebra nenhum uso existente.</verify>
  <done>MessageInput aceita um hook opcional de "digitando", sem acoplamento a Convex.</done>
</task>

<task type="auto">
  <name>Task 2: Componente TypingIndicator com expiração client-side</name>
  <files>src/renderer/src/components/shell/TypingIndicator.tsx</files>
  <action>
    Criar `src/renderer/src/components/shell/TypingIndicator.tsx`:
    ```tsx
    import { useQuery } from 'convex/react'
    import { useEffect, useState } from 'react'

    import { api } from '../../../../../convex/_generated/api'
    import type { Id } from '../../../../../convex/_generated/dataModel'

    const TYPING_TTL_MS = 6000
    const TICK_MS = 1000

    // Expiração é aplicada aqui, no cliente, por tick de setInterval — não no servidor
    // (05-RESEARCH.md §7: uma query Convex não reavalia sozinha só por causa do tempo
    // passar, sem escrita nova). O tick força este componente a recalcular "quem ainda
    // conta como digitando" a cada segundo, mesmo sem nenhum dado novo chegar do
    // servidor — é o que garante o indicador sumir sozinho se o autor travar/fechar o
    // app no meio da digitação.
    export function TypingIndicator({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element | null {
      const typers = useQuery(api.typing.listTyping, { channelId })
      const [now, setNow] = useState(() => Date.now())

      useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), TICK_MS)
        return () => clearInterval(interval)
      }, [])

      const active = (typers ?? []).filter((t) => now - t.updatedAt < TYPING_TTL_MS)

      if (active.length === 0) return null

      const names = active.map((t) => t.displayName)
      const text =
        names.length === 1
          ? `${names[0]} está digitando...`
          : names.length === 2
            ? `${names[0]} e ${names[1]} estão digitando...`
            : `${names.length} pessoas estão digitando...`

      return (
        <div className="px-4 h-5 flex items-center text-xs text-muted-foreground italic">
          {text}
        </div>
      )
    }
    ```
  </action>
  <verify>`npm run typecheck:web` passa. Componente retorna `null` (não renderiza nada, nem espaço vazio visível de forma estranha) quando ninguém está digitando.</verify>
  <done>Indicador pronto para ser montado em qualquer canal, com expiração local independente de nova mensagem do servidor.</done>
</task>

<task type="auto">
  <name>Task 3: Ligar TypingIndicator e onTyping em ConversationArea</name>
  <files>src/renderer/src/components/shell/ConversationArea.tsx</files>
  <action>
    Em `TextChannelView` (reescrito no plano 05-04), acrescentar o throttle de escrita e
    montar `TypingIndicator` entre `MessageList` e `MessageInput`:
    ```tsx
    const TYPING_THROTTLE_MS = 2000

    function TextChannelView({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
      const sendMessage = useMutation(api.messages.sendMessage)
      const setTyping = useMutation(api.typing.setTyping)
      const lastTypingCallRef = useRef(0)

      function handleSend(content: string): void {
        sendMessage({ channelId, content }).catch(() => {})
      }

      function handleTyping(): void {
        const now = Date.now()
        if (now - lastTypingCallRef.current < TYPING_THROTTLE_MS) return
        lastTypingCallRef.current = now
        setTyping({ channelId }).catch(() => {})
      }

      return (
        <>
          <div className="flex-1 min-h-0">
            <MessageList channelId={channelId} />
          </div>
          <TypingIndicator channelId={channelId} />
          <MessageInput onSend={handleSend} onTyping={handleTyping} />
        </>
      )
    }
    ```
    Acrescentar `useRef` aos imports de `react` (se ainda não importado) e `TypingIndicator`
    ao import local de componentes deste diretório.
  </action>
  <verify>
    `npm run typecheck:web` passa; `npm run build` passa. Teste manual (dev, uma conta):
    digitar no campo de mensagem não deve gerar erro no console; abrir o DevTools do
    Convex (dashboard) e confirmar que `setTyping` não é chamado mais de uma vez a cada
    ~2s mesmo digitando rápido continuamente.
  </verify>
  <done>Indicador de digitando visível e funcional dentro do canal de texto, com throttle de escrita confirmado.</done>
</task>

</tasks>

<visual_verifications>

### 1. Indicador de "está digitando" aparece e some
- **URL:** tela principal do app, canal de texto selecionado
- **Viewport:** desktop
- **Expected:** Texto "[nome] está digitando..." visível logo acima do campo de envio enquanto outro membro digita; desaparece poucos segundos após parar
- **Context:** Task 3 montou TypingIndicator dentro de TextChannelView

</visual_verifications>

<verification>
- `npm run typecheck:web` passa.
- `npm run build` passa.
- `MessageInput.tsx` continua compilando e funcionando sem nenhuma referência a Convex
  dentro do arquivo (grep: nenhum `import ... from 'convex` em `MessageInput.tsx`).
- Nenhuma chamada a `setTyping` acontece fora do throttle de 2s (inspeção manual do
  código de `TextChannelView`, não só teste automatizado).
</verification>

<success_criteria>
CHAT-07 observável por um humano usando o app com uma conta digitando e outra
observando (verificação final com duas contas fica para o plano 05-06). MessageInput
permanece genérico o bastante para a Fase 6 reaproveitar sem qualquer ajuste.
</success_criteria>

<output>
After completion, create `.planning/phases/05-chat-em-tempo-real/05-05-SUMMARY.md`.
</output>
