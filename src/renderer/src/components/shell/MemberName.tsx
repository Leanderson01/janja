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
export function MemberName({
  username,
  tag,
  className
}: {
  username: string
  tag: string
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('truncate text-sm', className)}>
      {username}
      <span className="text-muted-foreground">#{tag}</span>
    </span>
  )
}
