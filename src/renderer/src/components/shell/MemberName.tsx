import { cn } from '@/lib/utils'

// Nome do membro + `#tag`, extraído de `MemberRow` (Plano 08.5-04).
//
// PONTO DE EXTENSÃO — leia antes de mudar:
// `className` é opcional e HOJE NINGUÉM PASSA. Ele existe porque o brief desta
// fase pede "nome do membro em componente próprio, capaz de receber cor
// depois". Quando existir cargo (v2), a cor do nome entra por aqui — o
// chamador passa a classe/estilo — e nenhuma outra parte da lista de membros
// muda.
//
// O que este componente deliberadamente NÃO tem: prop `color`, `role` ou
// `roleId`. Qualquer uma delas já seria introduzir o conceito de cargo, que é
// o "Não fazer" literal do `08.5-BRIEF.md` (decisão de 2026-08-18, opção "c").
// O ponto de extensão é de UI e só de UI: uma prop de classe que não é
// persistida em lugar nenhum e não tem semântica própria.
// Nome humano na frente, `#tag` como desambiguador (duas "João Silva" existem;
// a tag é o que as separa). O identificador exato — `username#tag`, que é o que
// se digita para adicionar alguém — fica no `title` e no item "Copiar
// identificador" do menu, porque ele é para copiar, não para ler.
export function MemberName({
  displayName,
  username,
  tag,
  className
}: {
  displayName: string
  username: string
  tag: string
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('truncate text-sm', className)} title={`${username}#${tag}`}>
      {displayName}
      <span className="text-muted-foreground">#{tag}</span>
    </span>
  )
}
