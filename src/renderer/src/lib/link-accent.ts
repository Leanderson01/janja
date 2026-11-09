// Cor da barra lateral da prévia de link: X e YouTube têm a própria cor, o
// resto usa o destaque do app. Compara o host inteiro (ou subdomínio dele),
// nunca "contém": "notx.com" não é X.

export type LinkAccent = 'x' | 'youtube' | 'default'

const X_HOSTS = ['x.com', 'twitter.com']
const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be']

function matches(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}

export function linkAccent(url: string): LinkAccent {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'default'
  }
  if (matches(host, X_HOSTS)) return 'x'
  if (matches(host, YOUTUBE_HOSTS)) return 'youtube'
  return 'default'
}
