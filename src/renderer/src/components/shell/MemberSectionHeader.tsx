// Cabeçalho de seção da lista de membros (Plano 08.5-04). Nasceu de um `<h3>`
// que vivia dentro de `MemberGroup`, onde o chamador montava a string
// `ONLINE — 3` à mão. Duas razões para o componente próprio:
//
// 1. A formatação `{label} — {count}` fica num lugar só. Quem acrescentar uma
//    seção nova não copia o travessão nem erra o espaçamento.
// 2. O brief da fase pede "cabeçalho de seção reutilizável na lista de
//    membros". Reutilizável aqui significa: outra composição de lista pode
//    usar o mesmo cabeçalho sem arrastar `MemberGroup` junto.
//
// O agrupamento que ele rotula hoje é SÓ online/offline. Cargo é v2 e não
// entra em schema, query, mutation nem tipo nesta fase — este componente não
// sabe o que é cargo, só recebe um rótulo e uma contagem.
export function MemberSectionHeader({
  label,
  count
}: {
  label: string
  count: number
}): React.JSX.Element {
  return (
    <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label} — {count}
    </h3>
  )
}
