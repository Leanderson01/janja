/** Frase da faixa “digitando” do Discord; `null` quando ninguém digita. */
export function typingText(names: string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return `${names[0]} está digitando…`
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando…`
  return 'Várias pessoas estão digitando…'
}
