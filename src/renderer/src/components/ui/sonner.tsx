import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Tema fixo em "dark", sem `useTheme()` de `next-themes`.
//
// O template oficial do shadcn importa `useTheme` de `next-themes` — uma lib de
// alternância de tema para Next.js. Este app não é Next, não tem alternância de
// tema e não deve ganhar essa dependência: o tema escuro é forçado por
// `class="dark"` no `<html>` de `src/renderer/index.html` (Plano 08.5-01).
// Se alguém "consertar" isto reintroduzindo `next-themes`, o hook devolveria
// "system" e o toast poderia renderizar claro dentro de um app escuro.
const Toaster = ({ ...props }: ToasterProps): React.JSX.Element => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
