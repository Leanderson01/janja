# Roteiro de verificação — Fases 4 e 6

Servidores/canais e amigos/DMs. As duas juntas porque ambas precisam de duas contas.

## Preparar

Na pasta `janja`, no **Windows**:

```
git pull
npm install
npx convex dev
```

Deixe o `convex dev` rodando num terminal. Noutro:

```
npm run dev
```

### Duas contas na mesma máquina

O app tem trava de instância única — necessária porque o retorno do login do Google
chega por ela. Para testar com duas contas ao mesmo tempo, use uma segunda máquina, ou
peça a alguém do grupo. Se não houver segunda máquina, dá para testar em sequência:
faça a ação com a conta A, saia, entre com a conta B e confira o resultado.

---

## Fase 4 — Servidores e canais

| # | Passo | Esperado |
|---|---|---|
| 1 | Entrar com a conta A | Barra de servidores vazia, sem erro |
| 2 | Clicar em "+" e criar um servidor | Aparece na barra e já fica selecionado |
| 3 | Criar um canal de texto | Aparece na seção TEXTO da sidebar |
| 4 | Criar um canal de voz | Aparece na seção VOZ |
| 5 | Abrir o diálogo de convite e gerar um código | Código aparece e pode ser copiado |
| 6 | Entrar com a conta B e usar o código | B entra no servidor e o vê na barra |
| 7 | Olhar a lista de membros | Ambos aparecem, com online/offline |
| 8 | Com a conta A, revogar o convite | Código para de funcionar para novos ingressos; B, que já entrou, continua dentro |
| 9 | Redimensionar a janela | Layout não quebra |

**Ponto de atenção:** o botão de convite só aparece para o dono do servidor. Se a
conta B enxergar esse botão, é defeito.

---

## Fase 6 — Amigos e DMs

| # | Passo | Esperado |
|---|---|---|
| 1 | Ir para o Home (ícone no topo da barra de servidores) | Painel de amigos abre |
| 2 | Ler o próprio `USER#123` no cabeçalho | Visível e copiável |
| 3 | Na aba Adicionar, buscar o `USER#123` da outra conta | Usuário encontrado |
| 4 | Enviar pedido de amizade | Confirmação, sem erro |
| 5 | Na outra conta, aba Pedidos | Pedido aparece |
| 6 | Aceitar | Some dos pedidos e entra na lista de amigos |
| 7 | Ver a lista de amigos | Mostra online/offline |
| 8 | Clicar em "Mensagem" num amigo | Abre a conversa direta |
| 9 | Trocar mensagens nos dois sentidos | Chegam em tempo real |
| 10 | Remover a amizade | Some da lista dos dois lados |

**Ponto de atenção:** buscar um `USER#123` que não existe deve dizer que não encontrou,
não dar erro nem tela em branco.

---

## Chat de canal — adiantando parte da Fase 5

Já está implementado e vale conferir junto:

| # | Passo | Esperado |
|---|---|---|
| 1 | Enviar mensagem num canal de texto | Aparece na hora para os dois |
| 2 | Enviar 30+ mensagens e rolar para o topo | Histórico carrega **sem a lista pular** |
| 3 | Enquanto lê o histórico, receber mensagem nova | O scroll **não** é roubado; aparece "N novas mensagens" |
| 4 | Clicar nesse aviso | Vai para o fim |
| 5 | Abrir um canal com mensagens não lidas | Divisor marca onde você parou |
| 6 | Olhar a sidebar | Badge de contagem no canal com não lidas |

Os passos 2 e 3 são os que mais importam: são requisitos que só se verificam com a
janela aberta e histórico de verdade.

---

## Como reportar

Diga o número do passo que falhou e o que aconteceu. Se aparecer erro no console
(`Ctrl+Shift+I`), cole o texto. "Passou tudo" também serve.
