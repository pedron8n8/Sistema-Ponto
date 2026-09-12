# Buffer de hora extra por empresa e nota opcional na negacao

Data: 2026-09-11
Status: aprovado, aguardando plano de implementacao

## Problema

Duas mudancas independentes no dominio de hora extra.

**1. Nao existe tolerancia.** Hoje `calculateIncrementalOvertimeSummary`
(`backend/src/utils/overtime.js:118-123`) calcula
`overtimeMinutes = max(0, trabalhado - contrato)`, sem piso. Um minuto acima do
contrato ja grava `overtimeStatus: 'PENDING'`
(`backend/src/controllers/time.controller.js:1037`), o que trava a aprovacao da
propria marcacao ate alguem decidir a hora extra
(`supervisor.controller.js:1039-1049` e `:1412-1422`, erro 409
`OVERTIME_PENDING`). O resultado e uma fila de aprovacoes gerada por ruido de
relogio.

Levantamento feito antes de escrever esta spec: nao existe buffer, tolerancia,
grace period ou margem ligada a jornada em nenhuma branch local ou remota, nem
em worktree, stash ou commit solto. Os unicos "grace" do repositorio
(`PROACTIVE_SHIFT_END_OVERSHOOT_GRACE_MINUTES`,
`PROACTIVE_ALERT_POST_SHIFT_GRACE_MINUTES`, em
`backend/src/workers/proactiveAlertWorker.js:34,50`) decidem quando disparar
notificacao de fim de turno e nao entram na aritmetica de hora extra. Esta e,
portanto, uma feature nova.

**2. Negar hora extra exige justificativa.** `rejectOvertime`
(`supervisor.controller.js:1747-1753`) devolve 400 quando o comentario tem menos
de 5 caracteres. A regra deve virar opcional para hora extra, e continuar
obrigatoria para a rejeicao da marcacao em si.

## Decisoes

| Questao | Decisao |
|---|---|
| Semantica do buffer | Gatilho, nao desconto. Dentro do buffer, zero. Acima, o excedente inteiro. Com buffer 10, 25 min extras geram 25 min de hora extra, nao 15. |
| Escopo do buffer | Por empresa (`organizationAdminId`), configurado na pagina de admin. |
| Valor vigente x historico | Snapshot no registro. O recalculo reusa o buffer do dia, nao o atual. |
| Default sem configuracao | 0 minutos, para o deploy nao alterar folha de pagamento de nenhuma empresa sem alguem pedir. |
| Gate de plano | Nenhum. Diferente de `location-settings`, que exige GROWTH/PRO. |
| Nota na negacao | Opcional para hora extra. Obrigatoria para marcacao, inclusive em lote. |
| Lote | Endpoint novo, so de hora extra. O `rejectEntriesBulk` atual nao muda. |

## 1. Configuracao por empresa

Reusa o model `AppSetting` (`backend/prisma/schema.prisma:257`), chave/valor
JSON, mesmo mecanismo da geofence (`backend/src/utils/geofence.js:224`,
`backend/src/controllers/admin.controller.js:1314`). Nao ha tabela nova: a chave
carrega o escopo.

- Chave: `overtimeBuffer:<organizationAdminId>`
- Valor: `{ "bufferMinutes": 10 }`
- Ausente: buffer 0

A empresa de um usuario e `user.organizationAdminId || user.id` — um ADMIN e a
propria empresa, e seus colaboradores apontam para ele.

Ao contrario da geofence, a leitura **nao** e cacheada em singleton de processo
no boot (`initGeofenceConfig`): aquele padrao assume um valor global e aqui o
valor e por tenant.

### Modulo novo: `backend/src/utils/overtimeBuffer.js`

| Funcao | Contrato |
|---|---|
| `resolveOrganizationAdminId(user)` | `user.organizationAdminId` ou, na ausencia, `user.id`; `null` se nao der para resolver |
| `getOvertimeBufferMinutes(organizationAdminId)` | Le o `AppSetting`, normaliza, devolve `0` se ausente, invalido ou se `organizationAdminId` for `null`. Nunca lanca: falha de leitura vira 0, porque um erro de configuracao nao pode impedir alguem de bater ponto. |
| `normalizeBufferMinutes(value)` | Inteiro truncado, limitado a 0..120. Nao numero, negativo ou `NaN` viram 0. |
| `OVERTIME_BUFFER_KEY_PREFIX` | `'overtimeBuffer:'` |

Teto de 120 minutos: um buffer maior que isso deixa de ser tolerancia de relogio
e vira jornada nao remunerada.

## 2. Calculo

`calculateIncrementalOvertimeSummary` recebe `bufferMinutes` (default 0, para
todo chamador existente manter o comportamento atual). O buffer se aplica ao
**total acumulado do dia**, nunca ao registro isolado:

```
aplica(x) = x <= bufferMinutes ? 0 : x

effectiveContract = resolveContractDailyMinutes(contractDailyMinutes)
totalDepois       = minutosAntes + workedMinutes
antes             = aplica(max(0, minutosAntes - effectiveContract))
depois            = aplica(max(0, totalDepois  - effectiveContract))
overtimeMinutes   = max(0, depois - antes)
```

### Por que ao total do dia

Aplicar por registro deixa o dia vazar. Com contrato 480 e buffer 10, dois
registros que somam 492 minutos dariam 6 e 6: cada um passa por baixo do buffer
e o dia fecha com 12 minutos de hora extra que nunca foram registrados. Com a
formula acima, o primeiro registro da 0 (`aplica(6) = 0`) e o segundo da 12
(`depois = aplica(12) = 12`, `antes = 0`), fechando o dia em 12.

### Casos de borda normativos

| Cenario (contrato 480, buffer 10) | `overtimeMinutes` |
|---|---|
| 480 min trabalhados | 0 |
| 490 min (exatamente no buffer) | 0 |
| 491 min | 11 |
| 505 min | 25 |
| Dois registros: 486 e depois +6 (total 492) | 0 e depois 12 |
| Buffer 0 | identico ao comportamento de hoje |

O split 50/100% (`overtime.js:129-131`, domingo ou feriado) atua sobre o valor ja
filtrado pelo buffer.

Quando `overtimeMinutes` e 0, `overtimeStatus` continua `null`
(`time.controller.js:1037`) e o gate `OVERTIME_PENDING` deixa de disparar. Nao ha
alteracao nos guards de aprovacao: eles somem sozinhos.

`calculateCurrentDailyProgress` (`overtime.js:139-179`, painel ao vivo) recebe o
mesmo buffer. Sem isso a tela mostra hora extra acumulando durante o dia e o
fechamento entrega zero.

Aqui o buffer vem da **configuracao vigente**, nao de snapshot: o dia ainda esta
aberto, nenhum registro foi fechado e portanto nenhum snapshot foi gravado. O
valor gravado e sempre o do clock-out, e e ele que passa a valer a partir dali.

## 3. Snapshot no registro

Coluna nova:

```prisma
// TimeEntry
overtimeBufferMinutes Int?
```

Segue o que o `TimeEntry` ja faz com `overtimePercent` (`schema.prisma:171-174`):
o registro guarda o parametro com que foi calculado.

| Momento | Comportamento |
|---|---|
| Clock-out (`time.controller.js:~1004`) | Le o buffer vigente da empresa, usa no calculo e grava na coluna |
| Criacao pelo RH (`hr.controller.js:347,409`) | Grava o buffer vigente antes de chamar o recalculo |
| Recalculo (`recalcDay.js:82-88`) | Usa `entry.overtimeBufferMinutes` ou 0 na ausencia, **nunca** a configuracao atual |
| Registro anterior a esta feature | `null`, tratado como 0: o comportamento que ele ja tinha |

E isto que torna o numero auditavel. Sem o snapshot, um ADMIN que sobe o buffer
de 10 para 20 faz com que a proxima correcao do RH num dia antigo zere uma hora
extra ja aprovada e reverta o credito de banco de horas, sem erro em tela —
`recalculateUserDay` reprocessa o dia inteiro e re-credita (`recalcDay.js:56-130`).

O clock-out precisa incluir `organizationAdminId` no `select` do usuario, que
hoje traz apenas `contractDailyMinutes`.

## 4. API e tela

Espelha `location-settings` (`backend/src/routes/admin.routes.js:108,114`), sem o
`requirePlan`.

- `GET /admin/overtime-settings` devolve `{ overtimeSettings: { bufferMinutes } }`
- `PATCH /admin/overtime-settings`, body `{ bufferMinutes }`, mesma forma na
  resposta

Escopo: a empresa de quem chama, via `resolveOrganizationAdminId(req.user)`.

`bufferMinutes` fora de 0..120 devolve 400 em vez de truncar em silencio — na
escrita a intencao do usuario e explicita e truncar esconde erro de digitacao.
`normalizeBufferMinutes` continua truncando na leitura, onde o dado ja esta
gravado e o calculo nao pode falhar.

Campo numerico no bloco de configuracoes do
`frontend/src/pages/AdminDashboard.tsx`, com texto curto explicando que e gatilho
e nao desconto — a diferenca entre "25 vira 25" e "25 vira 15" nao e obvia e
decide pagamento.

## 5. Nota opcional e lote de hora extra

### Individual

Remover o bloco `supervisor.controller.js:1747-1753`. O comentario continua
aceito e continua sendo gravado enriquecido com os minutos originais (`:1787`);
apenas deixa de ser exigido.

Atualizar o comentario da rota (`supervisor.routes.js:~107`, hoje "Body:
{ comment: string } (obrigatório)") e o catalogo MCP
(`backend/src/mcp/catalog/approvals.js:148-153`): tirar `comment` do array de
obrigatorios e corrigir a descricao, que hoje afirma "Comentario obrigatorio".

### Lote so de hora extra

`POST /supervisor/overtime/bulk/reject`, body
`{ entryIds: string[], comment?: string }`. Nega apenas horas extras pendentes;
nao altera o `status` das marcacoes. Reusa `loadEntryForOvertimeDecision` por
item e a reversao de banco de horas de `rejectOvertime`. Itens que nao estao com
hora extra pendente sao reportados como ignorados, nao como erro — mesma forma de
resposta do `rejectEntriesBulk`.

`rejectEntriesBulk` (`supervisor.controller.js:1478-1530`) **nao muda**: continua
rejeitando marcacoes e continua exigindo 5 caracteres, porque a exigencia ali
pertence a rejeicao da marcacao.

Sem tool MCP para o lote novo. A exposicao MCP do projeto ja opera perto do teto
de tools, e negacao em lote sem justificativa e a ultima coisa a abrir para
agente sem pedido explicito.

### Frontend

Remover a validacao de 5 caracteres do caminho de hora extra em
`SupervisorDashboard.tsx:725`, `SupervisorPendingItemsPage.tsx:315` e
`AdminPendingApprovalsPage.tsx:175`, junto com o aviso "Negar exige comentario
(min. 5 caracteres)" (`SupervisorDashboard.tsx:1653-1658`). O textarea continua
existindo e continua enviando o que for digitado.

Botao de negar hora extra em lote na tela que ja tem selecao multipla
(`SupervisorPendingItemsPage.tsx`).

## 6. Testes

`backend/src/utils/overtime.js` nao tem teste unitario hoje — nem do split
50/100%, nem de feriado, nem de `resolveContractDailyMinutes`. Como o modulo
decide folha de pagamento e vai passar a ter mais um parametro, o arquivo novo
cobre o que ja existia junto com o buffer.

| Arquivo | Cobertura |
|---|---|
| `backend/tests/utils/overtime.test.js` (novo) | Toda a tabela de bordas da secao 2; buffer 0 reproduz o comportamento atual; split 50/100% e feriado; `resolveContractDailyMinutes` com valor ausente e invalido |
| `backend/tests/utils/overtimeBuffer.test.js` (novo) | Resolucao da empresa; ausencia de linha da 0; normalizacao de negativo, `NaN`, string e acima de 120 |
| `backend/tests/utils/recalcDay.test.js` | Recalculo usa o snapshot do registro e ignora a configuracao atual; ausencia de snapshot vale 0 |
| `backend/tests/controllers/supervisor.controller.test.js` | `rejectOvertime` sem comentario devolve 200; rejeitar **marcacao** sem comentario continua devolvendo 400 (guarda a fronteira do escopo, hoje sem teste nenhum); lote novo nega so hora extra e nao mexe no `status` da marcacao |

## Risco operacional

A coluna nova exige `prisma db push`, e o `DATABASE_URL` de `backend/.env` neste
repositorio aponta para **producao** por tunel SSH. O push so acontece com
override explicito da variavel e confirmacao do dono do projeto. Nada de
`prisma migrate`: o projeto usa `db push`.

## Fora de escopo

- Recalcular dias passados ao mudar o buffer. Por desenho: o snapshot existe
  justamente para o passado nao se mexer.
- Aprovacao de hora extra em lote. So a negacao foi pedida.
- A divergencia pre-existente de 3 contra 5 caracteres na rejeicao de marcacao
  comum, onde o frontend valida 3 e o backend exige 5
  (`SupervisorPendingItemsPage.tsx:266`, `AdminPendingApprovalsPage.tsx:122`,
  `SupervisorDashboard.tsx:877`). E bug real, mas de outro caminho.
- Unificar as seis copias de `if (!comment || comment.trim().length < 5)` do
  `supervisor.controller.js`.
