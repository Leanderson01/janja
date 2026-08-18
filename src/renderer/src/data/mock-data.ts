// Dados mockados do shell da UI (Fase 3).
//
// Este arquivo é a única fonte de dados de todo o shell nesta fase — os
// componentes de src/renderer/src/components/shell/** só leem daqui, não
// duplicam fixtures. As fases 4-8 vão substituir tudo isto por queries
// reativas do Convex, mantendo (na medida do possível) o mesmo formato de
// tipos para minimizar retrabalho.

export type Server = {
  id: string
  name: string
  iconUrl?: string
}

export type Channel = {
  id: string
  serverId: string
  name: string
  type: 'text' | 'voice'
  category: string // ex: "TEXTO", "VOZ" — usado para agrupar na sidebar
  unreadCount: number // 0 = sem badge
  firstUnreadMessageId?: string // onde o divisor "novas mensagens" aparece
}

export type Member = {
  id: string
  serverId: string
  username: string
  tag: string // 4 dígitos, ex: "0231" — junto formam USER#123
  avatarUrl?: string
  status: 'online' | 'offline'
}

export type VoiceParticipant = {
  channelId: string
  memberId: string
  speaking: boolean
  muted: boolean
  deafened: boolean
}

export type Message = {
  id: string
  channelId: string
  authorId: string // referencia Member.id
  content: string
  createdAt: number // epoch ms, usado para ordenar
}

export const mockServers: Server[] = [
  { id: 'srv-1', name: 'Galera do Sinuca' },
  { id: 'srv-2', name: 'Dev & Café' }
]

export const mockChannels: Channel[] = [
  // srv-1
  {
    id: 'chan-1-geral',
    serverId: 'srv-1',
    name: 'geral',
    type: 'text',
    category: 'TEXTO',
    unreadCount: 3,
    firstUnreadMessageId: 'msg-4'
  },
  {
    id: 'chan-1-memes',
    serverId: 'srv-1',
    name: 'memes',
    type: 'text',
    category: 'TEXTO',
    unreadCount: 0
  },
  {
    id: 'chan-1-avisos',
    serverId: 'srv-1',
    name: 'avisos',
    type: 'text',
    category: 'TEXTO',
    unreadCount: 0
  },
  {
    id: 'chan-1-sinuca',
    serverId: 'srv-1',
    name: 'Sinuca',
    type: 'voice',
    category: 'VOZ',
    unreadCount: 0
  },
  {
    id: 'chan-1-lounge',
    serverId: 'srv-1',
    name: 'Lounge',
    type: 'voice',
    category: 'VOZ',
    unreadCount: 0
  },
  // srv-2
  {
    id: 'chan-2-geral',
    serverId: 'srv-2',
    name: 'geral',
    type: 'text',
    category: 'TEXTO',
    unreadCount: 0
  },
  {
    id: 'chan-2-bugs',
    serverId: 'srv-2',
    name: 'bugs',
    type: 'text',
    category: 'TEXTO',
    unreadCount: 1,
    firstUnreadMessageId: 'msg-10'
  },
  {
    id: 'chan-2-deploys',
    serverId: 'srv-2',
    name: 'deploys',
    type: 'text',
    category: 'TEXTO',
    unreadCount: 0
  },
  {
    id: 'chan-2-pair',
    serverId: 'srv-2',
    name: 'Pair Programming',
    type: 'voice',
    category: 'VOZ',
    unreadCount: 0
  },
  {
    id: 'chan-2-standup',
    serverId: 'srv-2',
    name: 'Daily',
    type: 'voice',
    category: 'VOZ',
    unreadCount: 0
  }
]

export const mockMembers: Member[] = [
  // srv-1
  { id: 'mem-1-ana', serverId: 'srv-1', username: 'ana', tag: '0231', status: 'online' },
  { id: 'mem-1-bruno', serverId: 'srv-1', username: 'bruno', tag: '4410', status: 'online' },
  { id: 'mem-1-carla', serverId: 'srv-1', username: 'carla', tag: '9981', status: 'offline' },
  { id: 'mem-1-diego', serverId: 'srv-1', username: 'diego', tag: '1123', status: 'online' },
  { id: 'mem-1-elis', serverId: 'srv-1', username: 'elis', tag: '5502', status: 'offline' },
  // srv-2
  { id: 'mem-2-felipe', serverId: 'srv-2', username: 'felipe', tag: '2290', status: 'online' },
  { id: 'mem-2-giulia', serverId: 'srv-2', username: 'giulia', tag: '3317', status: 'online' },
  { id: 'mem-2-hugo', serverId: 'srv-2', username: 'hugo', tag: '7765', status: 'offline' },
  { id: 'mem-2-ines', serverId: 'srv-2', username: 'ines', tag: '0044', status: 'online' },
  { id: 'mem-2-joao', serverId: 'srv-2', username: 'joao', tag: '6608', status: 'offline' }
]

export const mockVoiceParticipants: VoiceParticipant[] = [
  {
    channelId: 'chan-1-sinuca',
    memberId: 'mem-1-ana',
    speaking: true,
    muted: false,
    deafened: false
  },
  {
    channelId: 'chan-1-sinuca',
    memberId: 'mem-1-bruno',
    speaking: false,
    muted: true,
    deafened: false
  },
  {
    channelId: 'chan-1-sinuca',
    memberId: 'mem-1-diego',
    speaking: false,
    muted: false,
    deafened: true
  },
  {
    channelId: 'chan-2-pair',
    memberId: 'mem-2-felipe',
    speaking: true,
    muted: false,
    deafened: false
  },
  {
    channelId: 'chan-2-pair',
    memberId: 'mem-2-ines',
    speaking: false,
    muted: true,
    deafened: false
  }
]

export const mockMessages: Message[] = [
  // chan-1-geral (6 mensagens; msg-4 é o divisor de não lidas)
  {
    id: 'msg-1',
    channelId: 'chan-1-geral',
    authorId: 'mem-1-ana',
    content: 'Bom dia, pessoal! Alguém topa uma sinuca hoje à noite?',
    createdAt: 1755500000000
  },
  {
    id: 'msg-2',
    channelId: 'chan-1-geral',
    authorId: 'mem-1-bruno',
    content: 'Eu topo, que horas?',
    createdAt: 1755500060000
  },
  {
    id: 'msg-3',
    channelId: 'chan-1-geral',
    authorId: 'mem-1-ana',
    content: 'Lá pelas 20h, no canal de voz Sinuca',
    createdAt: 1755500120000
  },
  {
    id: 'msg-4',
    channelId: 'chan-1-geral',
    authorId: 'mem-1-diego',
    content: 'Fechado, entro assim que sair do trabalho',
    createdAt: 1755500180000
  },
  {
    id: 'msg-5',
    channelId: 'chan-1-geral',
    authorId: 'mem-1-elis',
    content: 'Vou tentar aparecer também, sem promessas',
    createdAt: 1755500240000
  },
  {
    id: 'msg-6',
    channelId: 'chan-1-geral',
    authorId: 'mem-1-carla',
    content: 'Marca aí, quero revanche da semana passada',
    createdAt: 1755500300000
  },
  // chan-2-bugs (4 mensagens; msg-10 é o divisor de não lidas)
  {
    id: 'msg-7',
    channelId: 'chan-2-bugs',
    authorId: 'mem-2-felipe',
    content: 'O build de staging quebrou depois do último merge',
    createdAt: 1755600000000
  },
  {
    id: 'msg-8',
    channelId: 'chan-2-bugs',
    authorId: 'mem-2-giulia',
    content: 'Já vi o erro, é uma migration faltando',
    createdAt: 1755600060000
  },
  {
    id: 'msg-9',
    channelId: 'chan-2-bugs',
    authorId: 'mem-2-hugo',
    content: 'Abro a PR de correção em 10 minutos',
    createdAt: 1755600120000
  },
  {
    id: 'msg-10',
    channelId: 'chan-2-bugs',
    authorId: 'mem-2-ines',
    content: 'Valeu, aviso quando o deploy passar de novo',
    createdAt: 1755600180000
  }
]
