#!/usr/bin/env node
// Falha alto e cedo se as variáveis de ambiente que o electron-vite embute em tempo de
// build (como literal, não como `process.env.X` lido em runtime) não estiverem
// presentes ANTES de gerar o instalador. Sem isso, `npm run build:win` termina com
// sucesso e produz um .exe que trava numa tela de carregamento infinita em toda máquina
// que o instalar, sem nenhum erro visível (09-RESEARCH.md §4).
//
// Roda ANTES de `electron-vite build` (ver package.json, script `build:win`). Usa o
// mesmo mecanismo de carregamento de env do próprio Vite (`loadEnv`) para checar
// exatamente o que o build real vai enxergar — `.env`, `.env.local`, `.env.[mode]`,
// `.env.[mode].local`, mesclado com `process.env` (que tem prioridade, igual o Vite já
// faz). Reimplementar esse merge à mão à parte divergiria do comportamento real do Vite
// mais cedo ou mais tarde.
import { loadEnv } from 'vite'

const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production'
const root = process.cwd()

// Terceiro argumento '' carrega TODAS as variáveis do arquivo de env, não só as
// prefixadas com VITE_ — precisamos enxergar MAIN_VITE_WORKOS_CLIENT_ID também.
const fileEnv = loadEnv(mode, root, '')
const env = { ...fileEnv, ...process.env }

// As três variáveis que o electron-vite substitui por literais estáticos dentro do
// bundle (main + renderer) no momento do build — nenhuma delas é secreta, mas todas são
// obrigatórias para o app funcionar (09-RESEARCH.md §4). VITE_CONVEX_SITE_URL ainda não
// é lida por nenhum código neste ponto do roadmap (chega no Plano 09-02), mas exigir já
// agora é deliberado: o instalador real só é gerado depois que 09-02 e 09-03 também
// rodarem, e a falha tem que ser barulhenta desde já, não só quando o código passar a
// consumir a variável.
const REQUIRED = ['VITE_CONVEX_URL', 'VITE_CONVEX_SITE_URL', 'MAIN_VITE_WORKOS_CLIENT_ID']

const missing = REQUIRED.filter((key) => !env[key] || String(env[key]).trim() === '')

if (missing.length > 0) {
  console.error('')
  console.error('========================================================================')
  console.error('ERRO: build do instalador abortado — variáveis de ambiente ausentes.')
  console.error('========================================================================')
  console.error('')
  console.error('O electron-vite embute estas variáveis DENTRO do executável no momento')
  console.error('do build (não são lidas em runtime na máquina de quem instala). Se')
  console.error('estiverem vazias agora, o instalador final gera um app que trava numa')
  console.error('tela de carregamento em TODAS as máquinas que o instalarem, sem nenhum')
  console.error('erro visível para quem for testar.')
  console.error('')
  console.error('Faltando:')
  for (const key of missing) console.error(`  - ${key}`)
  console.error('')
  console.error('Preencha essas variáveis em .env.local, na raiz do projeto (veja')
  console.error('.env.local.example para o formato esperado de cada uma), e rode o')
  console.error('build de novo.')
  console.error('')
  process.exit(1)
}

console.log(
  `OK verify-build-env: ${REQUIRED.join(', ')} presentes — build pode continuar.`
)
