// Extração do link de uma mensagem de texto (CHAT-15, prévias de link).
//
// Função PURA e barata de propósito: ela roda uma vez por mensagem renderizada
// na lista do canal, então não pode fazer nada além de olhar a string. Quem
// busca metadata é a `action` do Convex (convex/linkPreviews.ts); aqui só se
// decide SE existe um link e QUAL.

/** Teto de tamanho. Uma URL maior que isto ou é lixo colado ou é um data-dump
 *  disfarçado — em qualquer dos casos não vira prévia, e mandá-la para o
 *  servidor só gastaria uma linha de cache que nunca acerta. */
const MAX_URL_LENGTH = 2000

// Só esquema explícito. NÃO se tenta adivinhar link sem esquema (`www.x.com`,
// `x.com`): em conversa normal "liguei pro x.com", "manda o arquivo.zip" e
// "às 9h.qualquer" viram falso positivo, e cada falso positivo é uma
// requisição de servidor e um cartão errado na tela. O custo de exigir
// `http://`/`https://` é o usuário que colou sem esquema não ganhar prévia —
// o que é invisível, porque nada é renderizado nesse caso.
//
// A fronteira à esquerda (`^` ou um caractere que não continua uma palavra
// nem um endereço) impede que "xhttps://exemplo.com" ou
// "mailto:eu@https://x.com" sejam lidos como link — casos em que o "http" é
// pedaço de outra coisa. Aspas, parênteses e `<` ficam PERMITIDOS ali,
// porque link colado entre aspas ou dentro de parênteses é escrita normal.
// A classe negada corta a URL no primeiro espaço, aspas ou sinal de
// menor/maior — os delimitadores que aparecem quando alguém cola um link
// dentro de texto ou de markup.
const LINK_RE = /(^|[^A-Za-z0-9+.\-@:_/])(https?:\/\/[^\s<>"'`]+)/i

// Pontuação que gruda no fim de link no fim de frase: "olha isso: https://x.com."
// `.` `,` `;` `:` `!` `?` e aspas nunca fazem parte útil de uma URL no fim.
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/

/** `)` e `]` são o caso chato: a Wikipédia tem URL com parêntese de verdade
 *  (`/wiki/Java_(linguagem)`). A regra que funciona é aparar o fechamento só
 *  quando ele está SOBRANDO em relação às aberturas dentro da própria URL. */
function trimUnbalancedClosers(url: string): string {
  let out = url
  for (;;) {
    const last = out[out.length - 1]
    if (last !== ')' && last !== ']') break
    const open = last === ')' ? '(' : '['
    const opens = out.split(open).length - 1
    const closes = out.split(last).length - 1
    if (closes <= opens) break
    out = out.slice(0, -1)
  }
  return out
}

/**
 * Devolve a PRIMEIRA URL http/https do texto, ou `null` se não houver nenhuma.
 *
 * Só a primeira, por decisão: uma prévia por mensagem. Uma mensagem com cinco
 * links viraria cinco requisições de servidor e um muro de cartões que empurra
 * o resto da conversa para fora da tela.
 */
export function firstLinkOf(content: string): string | null {
  if (content.length === 0) return null

  const match = LINK_RE.exec(content)
  if (!match) return null

  let url = match[2]
  url = url.replace(TRAILING_PUNCTUATION, '')
  url = trimUnbalancedClosers(url)
  // A poda de pontuação pode reexpor pontuação: "https://x.com/a)." vira
  // "https://x.com/a)" e depois "https://x.com/a". Uma segunda passada resolve
  // os casos comuns sem virar laço.
  url = url.replace(TRAILING_PUNCTUATION, '')

  if (url.length > MAX_URL_LENGTH) return null

  // Última peneira: o que sobrou precisa ser URL de verdade com host. Sem isto,
  // "http://" solto (ou "https://." depois da poda) chegaria à action, que
  // gastaria uma linha de cache `failed` para descobrir o óbvio.
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname.length === 0) return null

  return url
}
