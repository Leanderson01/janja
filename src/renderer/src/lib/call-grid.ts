/** Colunas da grade de blocos da call: 1, 2, 2, 2, 3… conforme o número de participantes. */
export function gridColumns(count: number): number {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 9) return 3
  return 4
}
