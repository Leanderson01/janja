import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, it, vi } from 'vitest'
import schema from './schema'
import * as tag from './lib/tag'

const modules = import.meta.glob('./**/*.ts')

describe('users.ensureUser', () => {
  it('rejeita quando não há identidade autenticada', async () => {
    const t = convexTest(schema, modules)

    await expect(t.mutation(anyApi.users.ensureUser, {})).rejects.toThrow()
  })

  it('primeiro login gera um username#tag de 4 dígitos', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo', email: 'leo@example.com' })

    const result = await asLeo.mutation(anyApi.users.ensureUser, {})

    expect(result.username).toBe('leo')
    expect(result.tag).toMatch(/^\d{4}$/)
    expect(result.workosId).toBe('workos_leo')
  })

  // --- Regressão do defeito relatado (nome opaco na tela) ---

  it('sem claim de e-mail nem de nome, o username NUNCA vira o subject do WorkOS', async () => {
    // Este é o cenário real: o access token do WorkOS não carrega `email`
    // nem `name` (ver o cabeçalho de lib/identity.ts).
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'user_01m0bc3v1ggfds20pcc4bhjjcp' })

    const result = await asLeo.mutation(anyApi.users.ensureUser, {})

    expect(result.username).not.toBe('user_01m0bc3v1ggfds20pcc4bhjjcp')
    expect(result.username).toBe('usuario')
    expect(result.displayName).toBe('Usuario')
    expect(result.tag).toMatch(/^\d{4}$/)
  })

  it('a dica de perfil do cliente vira nome humano quando o JWT não tem claim', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'user_01m0bc3v1ggfds20pcc4bhjjcp' })

    const result = await asLeo.mutation(anyApi.users.ensureUser, {
      profile: { name: 'João Silva', email: 'jsilva123@gmail.com' }
    })

    expect(result.username).toBe('joao.silva')
    expect(result.displayName).toBe('João Silva')
  })

  it('claim verificada do JWT tem precedência sobre a dica do cliente', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo', name: 'Leo Verdadeiro' })

    const result = await asLeo.mutation(anyApi.users.ensureUser, {
      profile: { name: 'Impostor Qualquer', email: 'impostor@example.com' }
    })

    expect(result.username).toBe('leo.verdadeiro')
    expect(result.displayName).toBe('Leo Verdadeiro')
  })

  it('a dica do cliente nunca decide o workosId', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo' })

    const result = await asLeo.mutation(anyApi.users.ensureUser, {
      profile: { name: 'Outra Pessoa', email: 'outra@example.com' }
    })

    expect(result.workosId).toBe('workos_leo')
  })

  it('avatar só aceita http(s) — dica com javascript: é descartada', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo' })

    const result = await asLeo.mutation(anyApi.users.ensureUser, {
      profile: { name: 'Leo', pictureUrl: 'javascript:alert(1)' }
    })

    expect(result.avatarUrl).toBeUndefined()
  })

  it('avatar http(s) da dica é aceito', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo' })

    const result = await asLeo.mutation(anyApi.users.ensureUser, {
      profile: { name: 'Leo', pictureUrl: 'https://lh3.googleusercontent.com/foto.jpg' }
    })

    expect(result.avatarUrl).toBe('https://lh3.googleusercontent.com/foto.jpg')
  })

  it('conserta o username opaco de quem já entrou antes da correção', async () => {
    const t = convexTest(schema, modules)
    const opaque = 'user_01m0bc3v1ggfds20pcc4bhjjcp'

    const existingId = await t.run((ctx) =>
      ctx.db.insert('users', {
        workosId: opaque,
        username: opaque,
        tag: '4242',
        displayName: opaque
      })
    )

    const asLeo = t.withIdentity({ subject: opaque })
    const result = await asLeo.mutation(anyApi.users.ensureUser, {
      profile: { name: 'João Silva', email: 'jsilva@gmail.com' }
    })

    expect(result._id).toBe(existingId) // amizades/mensagens apontam para o _id
    expect(result.username).toBe('joao.silva')
    expect(result.displayName).toBe('João Silva')
    expect(result.tag).toBe('4242') // tag preservada, o par continua livre

    const rows = await t.run((ctx) => ctx.db.query('users').collect())
    expect(rows).toHaveLength(1)
  })

  it('o conserto sorteia outra tag se o par derivado já estiver ocupado', async () => {
    const t = convexTest(schema, modules)
    const opaque = 'user_01m0bc3v1ggfds20pcc4bhjjcp'

    await t.run(async (ctx) => {
      await ctx.db.insert('users', {
        workosId: 'workos_outro',
        username: 'joao.silva',
        tag: '4242',
        displayName: 'João Anterior'
      })
      await ctx.db.insert('users', {
        workosId: opaque,
        username: opaque,
        tag: '4242',
        displayName: opaque
      })
    })

    const asLeo = t.withIdentity({ subject: opaque })
    const result = await asLeo.mutation(anyApi.users.ensureUser, {
      profile: { name: 'João Silva' }
    })

    expect(result.username).toBe('joao.silva')
    expect(result.tag).not.toBe('4242')
  })

  it('NUNCA sobrescreve um nome que a pessoa escolheu à mão', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) =>
      ctx.db.insert('users', {
        workosId: 'workos_leo',
        username: 'apelido.escolhido',
        tag: '0007',
        displayName: 'Apelido Escolhido'
      })
    )

    const asLeo = t.withIdentity({ subject: 'workos_leo' })
    const result = await asLeo.mutation(anyApi.users.ensureUser, {
      profile: { name: 'João Silva' }
    })

    expect(result.username).toBe('apelido.escolhido')
    expect(result.displayName).toBe('Apelido Escolhido')
    expect(result.tag).toBe('0007')
  })

  it('login repetido com a mesma identidade nunca cria um segundo documento', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo', email: 'leo@example.com' })

    const first = await asLeo.mutation(anyApi.users.ensureUser, {})
    const second = await asLeo.mutation(anyApi.users.ensureUser, {})

    const rows = await t.run((ctx) => ctx.db.query('users').collect())
    expect(rows).toHaveLength(1)
    expect(second.username).toBe(first.username)
    expect(second.tag).toBe(first.tag)
    expect(second._id).toBe(first._id)
  })

  it('colisão de (username, tag) resulta em uma tag diferente, nunca em erro nem duplicata', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) =>
      ctx.db.insert('users', {
        workosId: 'workos_other',
        username: 'leo',
        tag: '0001',
        displayName: 'Leo Existente'
      })
    )

    const spy = vi.spyOn(tag, 'generateFourDigitTag')
    spy.mockReturnValueOnce('0001').mockReturnValueOnce('4242')

    const asLeo = t.withIdentity({ subject: 'workos_leo', email: 'leo@example.com' })
    const result = await asLeo.mutation(anyApi.users.ensureUser, {})

    expect(spy).toHaveBeenCalledTimes(2)
    expect(result.username).toBe('leo')
    expect(result.tag).not.toBe('0001')
    expect(result.tag).toBe('4242')

    const rows = await t.run((ctx) => ctx.db.query('users').collect())
    expect(rows).toHaveLength(2)

    spy.mockRestore()
  })
})

describe('users.findUserByUsernameTag', () => {
  it('retorna o usuário quando (username, tag) existe', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) =>
      ctx.db.insert('users', {
        workosId: 'workos_leo',
        username: 'leo',
        tag: '1234',
        displayName: 'Leo'
      })
    )

    const result = await t.query(anyApi.users.findUserByUsernameTag, {
      username: 'leo',
      tag: '1234'
    })

    expect(result).not.toBeNull()
    expect(result?.username).toBe('leo')
    expect(result?.tag).toBe('1234')
    expect(result).not.toHaveProperty('workosId')
  })

  it('retorna null quando o par não existe', async () => {
    const t = convexTest(schema, modules)

    const result = await t.query(anyApi.users.findUserByUsernameTag, {
      username: 'ninguem',
      tag: '0000'
    })

    expect(result).toBeNull()
  })

  it('retorna null quando o username existe mas a tag não bate', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) =>
      ctx.db.insert('users', {
        workosId: 'workos_leo',
        username: 'leo',
        tag: '1234',
        displayName: 'Leo'
      })
    )

    const result = await t.query(anyApi.users.findUserByUsernameTag, {
      username: 'leo',
      tag: '9999'
    })

    expect(result).toBeNull()
  })
})

describe('users.me', () => {
  it('devolve o próprio perfil sem expor o workosId', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo', name: 'Leo Neves' })
    await asLeo.mutation(anyApi.users.ensureUser, {})

    const result = await asLeo.query(anyApi.users.me, {})

    expect(result?.username).toBe('leo.neves')
    expect(result?.displayName).toBe('Leo Neves')
    expect(result).not.toHaveProperty('workosId')
  })

  it('devolve null sem sessão, em vez de lançar', async () => {
    const t = convexTest(schema, modules)

    await expect(t.query(anyApi.users.me, {})).resolves.toBeNull()
  })

  it('devolve null quando há sessão mas ensureUser ainda não rodou', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo' })

    await expect(asLeo.query(anyApi.users.me, {})).resolves.toBeNull()
  })
})

describe('users.updateProfile', () => {
  type TestCtx = ReturnType<typeof convexTest>
  async function seedLeo(t: TestCtx): Promise<ReturnType<TestCtx['withIdentity']>> {
    const asLeo = t.withIdentity({ subject: 'workos_leo', name: 'Leo Neves' })
    await asLeo.mutation(anyApi.users.ensureUser, {})
    return asLeo
  }

  it('renomeia username, tag e displayName de uma vez', async () => {
    const t = convexTest(schema, modules)
    const asLeo = await seedLeo(t)

    const result = await asLeo.mutation(anyApi.users.updateProfile, {
      username: 'Joao',
      tag: '0001',
      displayName: 'João Silva'
    })

    expect(result.username).toBe('joao') // canonizado
    expect(result.tag).toBe('0001')
    expect(result.displayName).toBe('João Silva')
  })

  it('argumento ausente não mexe no campo', async () => {
    const t = convexTest(schema, modules)
    const asLeo = await seedLeo(t)
    const before = await asLeo.query(anyApi.users.me, {})

    const result = await asLeo.mutation(anyApi.users.updateProfile, {
      displayName: 'Só o apelido'
    })

    expect(result.username).toBe(before?.username)
    expect(result.tag).toBe(before?.tag)
    expect(result.displayName).toBe('Só o apelido')
  })

  it('recusa o par já usado por outra pessoa, com mensagem em português', async () => {
    const t = convexTest(schema, modules)
    await t.run((ctx) =>
      ctx.db.insert('users', {
        workosId: 'workos_outro',
        username: 'joao',
        tag: '0001',
        displayName: 'João Anterior'
      })
    )
    const asLeo = await seedLeo(t)

    await expect(
      asLeo.mutation(anyApi.users.updateProfile, { username: 'joao', tag: '0001' })
    ).rejects.toThrow('joao#0001 já está em uso')

    // Nada foi gravado pela metade.
    const me = await asLeo.query(anyApi.users.me, {})
    expect(me?.username).toBe('leo.neves')
  })

  it('a unicidade é do PAR: mesmo username com outra tag é permitido', async () => {
    const t = convexTest(schema, modules)
    await t.run((ctx) =>
      ctx.db.insert('users', {
        workosId: 'workos_outro',
        username: 'joao',
        tag: '0001',
        displayName: 'João Anterior'
      })
    )
    const asLeo = await seedLeo(t)

    const result = await asLeo.mutation(anyApi.users.updateProfile, {
      username: 'joao',
      tag: '0002'
    })

    expect(result.username).toBe('joao')
    expect(result.tag).toBe('0002')
  })

  it('salvar o próprio par sem mudar nada não acusa colisão consigo mesmo', async () => {
    const t = convexTest(schema, modules)
    const asLeo = await seedLeo(t)
    const before = await asLeo.query(anyApi.users.me, {})

    const result = await asLeo.mutation(anyApi.users.updateProfile, {
      username: before!.username,
      tag: before!.tag,
      displayName: 'Leo'
    })

    expect(result.username).toBe(before?.username)
    expect(result.tag).toBe(before?.tag)
  })

  it('recusa username curto, tag fora do formato e displayName vazio', async () => {
    const t = convexTest(schema, modules)
    const asLeo = await seedLeo(t)

    await expect(asLeo.mutation(anyApi.users.updateProfile, { username: 'a' })).rejects.toThrow(
      'ao menos 2'
    )
    await expect(asLeo.mutation(anyApi.users.updateProfile, { tag: '12' })).rejects.toThrow(
      '4 dígitos'
    )
    await expect(
      asLeo.mutation(anyApi.users.updateProfile, { displayName: '   ' })
    ).rejects.toThrow('nome de exibição')
  })

  it('exige sessão', async () => {
    const t = convexTest(schema, modules)

    await expect(t.mutation(anyApi.users.updateProfile, { username: 'joao' })).rejects.toThrow()
  })

  it('o rename mantém o _id, então amizades e mensagens não quebram', async () => {
    const t = convexTest(schema, modules)
    const asLeo = await seedLeo(t)
    const before = await asLeo.query(anyApi.users.me, {})

    const result = await asLeo.mutation(anyApi.users.updateProfile, {
      username: 'outro.nome',
      tag: '9876'
    })

    expect(result._id).toBe(before?._id)
  })

  it('depois do rename o novo par é encontrável por findUserByUsernameTag', async () => {
    const t = convexTest(schema, modules)
    const asLeo = await seedLeo(t)

    await asLeo.mutation(anyApi.users.updateProfile, { username: 'Joao', tag: '0001' })

    const found = await asLeo.query(anyApi.users.findUserByUsernameTag, {
      username: 'joao',
      tag: '0001'
    })
    expect(found?.displayName).toBe('Leo Neves')
  })
})
