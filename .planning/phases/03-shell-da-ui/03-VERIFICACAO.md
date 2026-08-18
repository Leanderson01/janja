# Fase 3 — Verificação dos critérios de sucesso

**Data:** 2026-08-18
**Resultado:** aprovada
**Verificado por:** Leo, em máquina Windows nativa

| # | Critério | Resultado |
|---|---|---|
| 1 | Barra de servidores, sidebar de canais, área de conversa e lista de membros na estrutura do Discord | ✅ |
| 2 | Redimensionar a janela não quebra o layout | ✅ |
| 3 | Navegar entre servidor/canal fictícios muda a área de conversa sem backend | ✅ |

`APP-01` satisfeito.

## Por que a verificação humana era obrigatória

Todos os planos desta fase reportaram os mesmos critérios como "inferido do
código, não confirmado visualmente". O WSL2 não renderiza a janela do Electron de
forma confiável — o Chromium derruba o processo de GPU sob WSLg e Xvfb. Nenhum
agente podia afirmar que o layout estava correto, e nenhum afirmou. A confirmação
veio de execução real em Windows.

## Slots antecipados para fases futuras

O layout já contém, como estrutura estática, os pontos onde as fases seguintes
penduram dado real. Isso foi deliberado: descobrir na Fase 7 que o avatar não tem
onde receber um anel de "falando" significaria retrabalho de CSS em cima de
código já testado.

| Slot | Fase que consome |
|---|---|
| Badge de contagem de não lidas por canal | F5 |
| Divisor de "novas mensagens" na área de conversa | F5 |
| Avatares de participantes aninhados sob canais de voz | F7 |
| Anel de fala e ícone de mudo no avatar | F7 |
| Barra de controles de voz no rodapé da sidebar | F7 |
| Região de compartilhamento de tela | F8 |

## Observações de execução

- `minWidth: 900` / `minHeight: 600` — abaixo disso as 4 regiões colapsam.
- O CLI do shadcn escreve num diretório literal `@/` na raiz do repositório em vez
  de resolver o alias. Ocorreu em três planos distintos desta fase; cada um moveu
  os arquivos para `src/renderer/src/components/ui/` e removeu o diretório órfão.
- `lucide-react` não era dependência transitiva, ao contrário do que a pesquisa
  assumiu. Instalado explicitamente.
