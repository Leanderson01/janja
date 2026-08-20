import { cn } from '@/lib/utils'

// Marca do Hydra: estrela branca de cinco pontas. Mesma geometria do ícone do
// app (`brand/hydra-star.svg`, que gera `build/icon.png` e `build/icon.ico`) —
// razão áurea entre o raio externo e o interno, ponta para cima.
//
// Aqui a estrela vem SEM o quadrado preto do ícone: dentro do app o fundo já é
// escuro, e um retângulo preto por cima dele apareceria como um bloco. O ícone
// do sistema operacional precisa do quadrado porque é exibido sobre fundos que
// não controlamos.
//
// `currentColor` de propósito: quem usa decide a cor pelo contexto (branca no
// escuro, e continua legível se algum dia existir tema claro).
const STAR_PATH =
  'M 512 92 L 604.55 377.87 L 905.11 377.34 L 661.79 553.63 L 755.35 839.19 ' +
  'L 512 662.04 L 268.65 839.19 L 362.21 553.63 L 118.89 377.34 L 419.45 377.87 Z'

export function HydraMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={cn('size-6', className)}
      fill="currentColor"
      role="img"
      aria-label="Hydra"
    >
      <path d={STAR_PATH} />
    </svg>
  )
}
