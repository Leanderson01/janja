// Polyfills que os primitivos do Radix usam e o jsdom não implementa.
//
// Importar no topo de TODO arquivo de teste que renderiza componente Radix,
// logo depois do docblock `// @vitest-environment jsdom` e ANTES de qualquer
// render(). Sem isto o teste morre com `hasPointerCapture is not a function`,
// um erro que não diz nada sobre a causa e que já foi motivo suficiente para
// alguém desistir de testar teclado.
//
// Não vive em `vitest.config.ts` de propósito: o ambiente global do projeto é
// `edge-runtime` (exigência do `convex-test`, usado pelos testes de `convex/`).
// O ambiente jsdom é escolhido por arquivo, via docblock.

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = (): boolean => false
  Element.prototype.setPointerCapture = (): void => {}
  Element.prototype.releasePointerCapture = (): void => {}
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = (): void => {}
}

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver

export {}
