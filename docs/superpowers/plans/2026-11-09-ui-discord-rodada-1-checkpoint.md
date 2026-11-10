# UI do Discord, rodada 1: o que falta antes do merge

Branch `ui/discord-rodada-1`. Código revisado tarefa por tarefa e na branch inteira.
Faltam só as verificações que precisam do Windows e de gente de verdade.

## 1. Ordem de publicação (obrigatória)

1. `npx convex deploy` **primeiro**.
2. Depois merge na `main` / build da web (Vercel).
3. Por último, o instalador do Electron.

Se o app novo for ao ar antes do backend:
- entrar na call já mutado ou ensurdecido falha;
- abrir a aba **Pendente** de Amigos derruba o app na tela de erro.

Entrar desmutado continua funcionando mesmo com o backend antigo.

## 2. Call real no Windows (você + 2 pessoas, A e B; C quando indicado)

### Mic e fone fora da call
- [ ] Mutar antes de entrar → entra mutado; ninguém te vê desmutado nem ouve nada.
- [ ] Ensurdecer antes de entrar → entra ensurdecido.
- [ ] Fechar e abrir o app → continua mutado.
- [ ] Trocar o mic fora da call → a call usa o mic escolhido (testar também entrando mutado).
- [ ] Tirar o fone USB e entrar → entra com o dispositivo padrão, sem erro.
- [ ] VAD desmutado: voz normal, como antes.
- [ ] VAD em call, mic fechado pelo silêncio: trocar o mic → o VAD responde ao mic novo.
- [ ] Entrar mutado em VAD → desmutar → o VAD abre quando você fala.
- [ ] Ensurdecido, clicar no mic → desensurdece e desmuta; os outros te veem desmutado.
- [ ] Trocar o mic enquanto mutado → ninguém ouve nenhum estalo.

### Push-to-talk
- [ ] Ao entrar, ninguém te ouve, nem um clique, até você apertar a tecla.
- [ ] Segurar a tecla **antes** de clicar no canal e continuar segurando → você é ouvido sem apertar de novo.
- [ ] Em call: mutar, depois desmutar segurando a tecla → é ouvido na hora.

### Assistir transmissão
- [ ] Quem entra numa call em andamento ouve todo mundo, inclusive quem já estava.
- [ ] C entra depois de A já estar transmitindo: ouve A na hora e só vê a tela de A depois de clicar.
- [ ] Alguém entra depois de B: B ouve a pessoa sem fazer nada.
- [ ] A transmite com som do jogo: B não vê nem ouve até clicar em "Assistir transmissão".
- [ ] B clica: vê e ouve. O volume de A (clique direito no quadro) vale para a voz e para o som da transmissão.
- [ ] B clica em "Parar de assistir": vídeo e som da transmissão param; a voz de A continua.
- [ ] B ensurdece assistindo: o som da transmissão some; ao desensurdecer, volta no volume de A.
- [ ] A e C transmitindo: B assiste só A; só o som do jogo de A toca; o quadro de C segue com "Assistir transmissão".
- [ ] A troca de mic no meio da transmissão: B continua ouvindo A e o som da transmissão.
- [ ] A para e transmite de novo: B não recebe sem clicar de novo; o palco não troca sozinho.
- [ ] A sai da call, volta e transmite: B não recebe sem clicar.
- [ ] O Wi-Fi de B cai e volta: B volta ouvindo todos e, se assistia, continua assistindo a mesma transmissão.
- [ ] Queda longa de B (a reconexão desiste): B sai da call; ao voltar, não está assistindo nada.
- [ ] A cai da internet e reconecta por completo: B precisa clicar de novo. **Decisão sua:** o Discord provavelmente manteria B assistindo.
- [ ] A vê a própria prévia sem clicar.
- [ ] Quadro ao vivo: clique esquerdo assiste; clique direito abre volume e silenciar. Fechar esse menu com Esc devolve o foco ao quadro.
- [ ] Abrir o menu de volume no quadro de A e A parar de transmitir: na próxima transmissão, o menu não abre sozinho.
- [ ] Na grade, enquanto A transmite e B não clicou, o aviso diz "Clique em "Assistir transmissão" para ver a tela".
- [ ] DevTools de B, depois de entrar e depois da queda de Wi-Fi: nenhum erro `[voice] falha ao assinar`, e nenhum estalo na voz dos outros quando a conexão volta.

## 3. Conferência visual (janja ao lado do Discord, mesma resolução)

Região por região do spec §5.2–§5.12. Conferir posição, tamanho, cor e estados: hover, aberto, não lido, falando, mutado, ao vivo.

- [ ] Barra de título: voltar/avançar; dá para arrastar a janela; duplo clique maximiza.
- [ ] Login, carregamento e tela de erro também dão para arrastar.
- [ ] Rail: ícones quadrados, pílula, selo da call.
- [ ] Lista de canais: recolher, alargar arrastando, clique direito, cronômetro da call.
- [ ] Cartão do usuário: voz conectada, setinhas de dispositivo.
- [ ] Mensagens:
  - agrupamento, horário, data entre dias e NOVAS em vermelho;
  - boas-vindas e "Ir para o presente";
  - imagem em tela cheia e prévias de link.
- [ ] Caixa de mensagem:
  - colar imagem mostra a miniatura;
  - arrastar arquivo funciona;
  - "digitando" aparece embaixo.
- [ ] Membros: coroa, "Em voz", volume no menu (nunca para você mesmo).
- [ ] Call:
  - grade 16:9 e controles;
  - em tela cheia, os menus aparecem;
  - "Compartilhar tela" em tela cheia mostra o seletor;
  - na transmissão, a barra fica acima da faixa de pessoas.
- [ ] Voltar (←) para a call em que você está mostra o palco, não uma prévia.
- [ ] Início, Amigos (Online / Todos / Pendente) e DM.
- [ ] Seletor de tela, teste de microfone, popover de voz e diálogos.

## 4. Decisões para você confirmar

- Ensurdecer não toca som (regra antiga do projeto). O Discord tem um som próprio.
- Quem transmite reconectar por completo encerra o "assistir" de quem via.
- Menu de membro: o mesmo menu no clique esquerdo e no direito.
- Quadro ao vivo: o clique esquerdo assiste.
- A busca em "Adicionar amigo" mostra `usuário#tag`. É o identificador buscado.

## 5. Para depois (anotado na revisão final, não bloqueia)

- **Falha ao entrar na call:** se a entrada falhar depois de conectar ao LiveKit, a sala fica conectada sem mic e a próxima tentativa é bloqueada. Esse problema já existia.
- **Ícones de mute desatualizados:** reenviar o estado de mic e fone ao servidor quando a conexão volta. Uma falha hoje só se corrige no próximo clique.
- **Acessibilidade:** o avatar sem foto é lido como "Hydra"; algumas abas e botões não dizem o nome da pessoa.
