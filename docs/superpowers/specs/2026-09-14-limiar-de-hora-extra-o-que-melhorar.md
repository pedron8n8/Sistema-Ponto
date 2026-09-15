# Limiar de hora extra: o que melhorar no que ja existe

Data: 2026-09-14
Status: para decisao

## Por que esta spec existe

A spec de 2026-09-11 (`2026-09-11-overtime-buffer-and-optional-reject-note-design.md`)
afirma ter procurado "em todas as branches locais e remotas, no worktree, nos
stashes e nos commits soltos" e concluiu que a tolerancia de hora extra era
feature nova. **A conclusao estava errada.** `main` ja tem a feature, inteira e
publicada, desde 2026-09-09 (`docs/releases/2026-09-09-hora-extra-e-timesheet.md`).

A busca falhou porque procurou pelas PALAVRAS esperadas — "buffer", "tolerancia",
"grace period", "margem" — e o nome real do campo e `overtimeMinMinutes`, que nao
contem nenhuma delas. A branch `feat/mobile-capacitor` forkou de `main` antes
disso entrar, entao nada apareceu no caminho de quem implementou.

Resultado: a branch atual carrega uma segunda implementacao do mesmo conceito,
com rota colidente. Esta spec registra o que de fato existe, o que a duplicata
descobriu que vale a pena, e o que jogar fora.

**Licao de processo, para a proxima:** procurar pelo CONCEITO (o que o campo
faria com o numero) e nao pelo nome que se espera que ele tenha. Um `git grep`
por `overtime` no schema de cada branch teria achado em um comando.

## O que `main` ja tem

| Peca | Onde |
|---|---|
| Campo | `User.overtimeMinMinutes`, mais `overtimeMinMinutesUpdatedAt` e `overtimeMinMinutesUpdatedById` (`schema.prisma:82-88`) |
| Busca do valor | `backend/src/utils/tenantOvertimePolicy.js` — fragmento `select` unico, para nenhum call site esquecer o campo |
| Regra | `applyOvertimeThreshold` / `applyMinOvertimeMinutes` em `utils/overtime.js:53-60, 238-242` |
| API | `GET`/`PATCH /admin/overtime-settings` (`admin.controller.js:1360-1430`) |
| Tela | `frontend/src/pages/AdminBankHoursPage.tsx` |
| Testes | `overtimeSettings`, `timeClockOutThreshold`, `tenantOvertimePolicy`, `recalcDay` |

A semantica e identica a que a duplicata reinventou, e o comentario em
`overtime.js:53-58` ja diz por que:

> Corte seco, nao franquia: abaixo do limiar nao ha hora extra; a partir dele a
> hora extra vale CHEIA (11min continuam 11, nao 1).
> Recebe sempre o total do DIA, nunca o pedaco de uma marcacao.

Cobertura dos caminhos: clock-out (`time.controller.js:1051`), painel ao vivo
(`:1571`), KPI/presenca do supervisor (`supervisor.controller.js:426`), worker de
alerta proativo (`proactiveAlertWorker.js:454`) e recalculo do dia
(`recalcDay.js:152`). **Nenhum caminho ficou de fora** — o trabalho de ligacao
feito na branch duplicada e integralmente redundante.

`main` tambem faz uma coisa que a duplicata nao fez, e faz melhor: quando a hora
extra e NEGADA, o recalculo regrava `workedMinutes = trabalhado − HE`
(`recalcDay.js:166-171`). O tempo negado sai do reconhecido na ORIGEM, entao todo
consumidor herda — relatorio, export, KPI. A duplicata resolvia o mesmo caso na
camada de relatorio, em dois lugares, com um preenchimento cronologico para
distribuir o teto entre as marcacoes do dia. Mais codigo, mais superficie, mesmo
resultado.

## Melhoria 1 — o limiar nao e congelado no registro (defeito real)

`recalculateUserDay` le o limiar VIGENTE do tenant a cada recalculo
(`recalcDay.js:119-127`), e o `select` das marcacoes nao guarda nada
(`:136`).

Consequencia: um ADMIN que sobe o limiar de 10 para 20 faz a **proxima correcao
do RH num dia antigo** zerar hora extra que ja estava aprovada e reverter o
credito de banco de horas — sem erro em tela. Basta o RH consertar um typo nas
notas de um dia fechado para o numero mudar.

As colunas de procedencia registram QUEM mudou e QUANDO, o que ajuda numa
contestacao, mas nao impedem a mudanca retroativa: elas documentam a alteracao da
configuracao, nao o valor com que cada dia foi fechado.

**Correcao proposta:** coluna `TimeEntry.overtimeMinMinutesApplied Int?`,
gravada no fechamento e nas criacoes/fechamentos do RH; o recalculo usa o valor
do registro, nunca o vigente. `null` = registro anterior a esta mudanca, tratado
como "sem limiar", que e o comportamento que ele ja tinha. E exatamente o que o
`TimeEntry` ja faz com `overtimePercent`, pelo mesmo motivo.

Custo: uma coluna anulavel, um `db push`, e o carimbo em tres call sites.

## Melhoria 2 — minuto engolido pelo limiar continua sendo pago como hora normal

Hoje, num contrato de 480 com limiar 15, um dia de 490 minutos grava
`overtimeMinutes = 0` e `workedMinutes = 490`. O pagamento entao paga 490 minutos
a 1x.

Isso e inconsistente com o tratamento da HE negada, que `main` ja trima na origem
(`recalcDay.js:166`): as duas situacoes sao "esse tempo nao vira hora extra", e
uma reduz o reconhecido enquanto a outra nao.

**A decisao e sua, e nao e obvia:**

- **(A) Manter como esta.** O minuto foi trabalhado e e pago como hora normal; o
  limiar so decide se ha ADICIONAL. Defensavel, e o mais generoso com o
  colaborador.
- **(B) Trimar igual a HE negada**, gravando `workedMinutes = min(trabalhado,
  contrato)` quando o limiar engoliu o excedente. Alinha as duas situacoes numa
  regra so. E o que foi pedido em conversa ("o OT menor que 15 nao deve contar").

Se for (B): a mudanca e na origem (`recalcDay.js` e clock-out), nao na camada de
relatorio, pelo mesmo motivo que fez o tratamento da HE negada ficar bom ali.

**Atencao, (B) e retroativo na leitura:** relatorios de periodos ja fechados
passam a mostrar valores menores. Se alguem ja pagou com base num relatorio
antigo, os numeros deixam de bater com o que foi pago. Precisa de aviso a quem
usa a planilha antes do deploy.

## Melhoria 3 — a formula de pagamento continua triplicada em `main`

`time.controller.calculateFinancialSummary`, `report.controller.getDailyBreakdown`
e `workers/reportWorker.resolveEntryPayment` implementam a mesma aritmetica a mao.
`main` nao tem `entryPayment.js`.

Elas nao sao identicas, e a diferenca e invisivel: a pagina de custo conta HE
aguardando decisao pelo adicional ("quanto o dia custou"), o export so conta HE
aprovada ("quanto pago agora"). As duas leituras sao legitimas, mas os totais
divergem e nada explica por que.

**Correcao proposta:** `backend/src/utils/entryPayment.js` com a aritmetica e as
duas politicas nomeadas (`resolveSettledOvertime`, `resolveIncurredOvertime`), e a
pagina de custo expondo o pedaco pendente como campo proprio, de modo que
`custo = pagavel + HE aguardando decisao` feche por construcao. Ja implementado e
testado na branch atual — aproveitavel como esta.

## O que aproveitar da branch atual, e o que descartar

**Descartar (duplica `main`, e a rota colide):**

- `backend/src/utils/overtimeBuffer.js` e a chave `AppSetting` `overtimeBuffer:<id>`
- `TimeEntry.overtimeBufferMinutes` e o parametro `bufferMinutes` em `overtime.js`
- `GET`/`PATCH /admin/overtime-settings` da branch — `main` ja usa essa rota
- O card de tolerancia no `AdminDashboard.tsx` — `main` ja tem o seu em `AdminBankHoursPage.tsx`
- A ligacao do buffer no snapshot de presenca e no worker de alerta — `main` ja liga

**Aproveitar (nao existe em `main`, verificado):**

- Nota opcional ao negar hora extra, com a fronteira da rejeicao da marcacao preservada e agora testada
- `POST /supervisor/overtime/bulk/reject`
- `entryPayment.js` e a reconciliacao custo x export (Melhoria 3)

**Tambem descartar (verificado depois da primeira versao desta spec):**

- A correcao de concorrencia da reversao de banco de horas no lote. `main` ja
  corrigiu em `1de2f71`, e melhor: `planEntryBankHoursReversal` le o que reverter
  numa query unica e as ESCRITAS entram no `$transaction`, mantendo transacao em
  lote em vez de interativa — o que evita o timeout que 200 registros x 4 queries
  estourariam. Provado contra Postgres real com dois colaboradores.

**Reaproveitar como ideia, nao como codigo:**

- O snapshot (Melhoria 1), aplicado ao campo de `main`

## Decisoes que preciso de voce

1. **Melhoria 2: (A) manter ou (B) trimar?** Muda folha e e retroativa na leitura.
2. **Melhoria 1 entra nesta rodada ou vira trabalho proprio?** E uma coluna nova,
   com `db push` em producao.
3. **A branch atual vira PR so com a parte aproveitavel, ou fecha e nasce uma
   nova a partir de `main`?** Ela esta 9 commits a frente com a duplicata dentro,
   e forkou antes do limiar existir.
