# Hora extra: janela própria, negação que desconta, limiar curto e timesheet ao vivo

**Data:** 2026-09-09 · **Branch:** `feat/overtime-split-and-deny-adjusts-time` · 19 commits nesta rodada

---

## ⚠️ O deploy exige uma alteração de schema ANTES de subir o código

`backend/src/controllers/admin.controller.js` faz `select` explícito de duas colunas novas. Se o código subir antes delas existirem, `GET` e `PATCH /admin/overtime-settings` passam a falhar — a tela de política de horas quebra.

```
schema_automation."User"
  overtimeMinMinutesUpdatedAt    DateTime?
  overtimeMinMinutesUpdatedById  String?
```

Aplicar com `prisma db push` (este projeto não usa `migrate`), **sobrepondo a URL**:

```bash
cd backend
DATABASE_URL="<url de producao>" npx prisma db push
```

`backend/.env` aponta `DATABASE_URL` para o túnel SSH até o Postgres de produção. Confirme qual banco a saída do comando nomeia antes de confirmar a execução.

## Outros dois pontos operacionais

- **A tool MCP nasce desligada.** `reports_weekly_timesheet` entrou no catálogo (80 → 81 tools), mas a allowlist é **por conexão** (`McpConnection.tools`): nenhuma conexão existente a recebe até um ADMIN/INTEGRATOR marcá-la em Configurações › MCP / IA.
- **O log de requisição não sobe ligado.** Ativa com `HTTP_LOG=1` ou `NODE_ENV=development`; em produção fica fora por padrão, porque o path pode carregar id de colaborador.

---

## O que entrou

Quatro tarefas pedidas. Três já existiam nesta branch e foram revisadas e corrigidas; a quarta não existia.

### 1. Hora extra em janela própria, trabalho normal em aba

`/app/supervisor/overtime` como tela dedicada, e a fila de pendências dividida em duas abas. Os registros com HE pendente deixam de exibir os botões de decisão na aba de trabalho normal — só o aviso de que a decisão vive na outra aba. A ordem obrigatória (decidir a HE antes de aprovar o registro) não mudou; ficou visível.

### 2. Negar hora extra desconta do tempo reconhecido

Negar passa a gravar `workedMinutes` menos os minutos negados. As marcações de entrada e saída **não** são alteradas: negar é decisão sobre reconhecimento, não reescrita do ponto.

O desconto vive em dois lugares — `rejectOvertime`/`rejectEntriesBulk` e o ramo `REJECTED` de `recalcDay` — porque o recálculo do dia (edição do RH, sincronização offline) regravaria o valor cheio.

**Quatro caminhos de leitura ressuscitavam os minutos negados** e foram fechados. Todos pelo mesmo motivo: `workedMinutes` é `Int @default(0)`, então um `0` é ambíguo, e os consumidores tratavam `0` como "nunca calculado" e recalculavam a duração de `clockIn`/`clockOut`. Uma entrada que era HE de ponta a ponta tem `0` **autoritativo**.

- `reportWorker` (exportação)
- agregados do KPI do supervisor
- snapshot de presença — **o guard existia mas era código morto**: o `select` omitia `overtimeStatus`, então a comparação era sempre `undefined === 'REJECTED'`
- marcações anteriores do clock-out, que inflavam `workedMinutesBeforeEntry` e davam HE nova sobre tempo já negado

### 3. Hora extra abaixo do limiar não é hora extra

`User.overtimeMinMinutes`, por tenant, na linha do dono da conta. Corte seco e não franquia: abaixo do limiar não há HE; a partir dele a HE vale **cheia** (11 min continuam 11). Aplicado sempre ao **total do dia**, nunca à fatia de uma marcação — cortar por marcação deixaria a HE acumular em fatias abaixo do limiar.

**O bug principal:** o limiar não era aplicado no **clock-out**, o único caminho que persiste HE e estampa `overtimeStatus`. Num tenant com limiar de 10, um dia de 8h06 gravava `overtimeMinutes: 6` com `overtimeStatus: 'PENDING'` — e HE pendente **bloqueia a aprovação do registro**, exatamente o que o limiar existe para evitar. O painel ao vivo e o `recalcDay` já respeitavam a regra, então o número mudava sozinho entre a tela e o fechamento do dia.

**Teto de 10 minutos** (era 120). Não é proteção contra erro de digitação: com 120 permitidos, uma configuração do tenant apagava até 2h de HE trabalhada por pessoa por dia. A CLT (art. 58 §1º) tolera ~5 min por marcação e ~10 min no dia. A configuração agora grava **quem alterou e quando**, porque antes só havia um `console.log`, que morre com o container.

### 4. Relatório em tempo real (novo)

`GET /reports/weekly-timesheet` calcula a semana de forma síncrona, sem fila, respeitando o tempo reconhecido e o limiar do tenant. Um endpoint só, consumido por duas superfícies para que os números não divirjam:

- **Web:** painel "Esta semana, ao vivo" em `/app/reports`, com os sete dias e totais. Polling só enquanto há marcação aberta.
- **MCP:** `reports_weekly_timesheet`, leitura, uma chamada. Antes, responder "quantas horas nesta semana" exigia três (`export` → `status` → `list`) e devolvia um nome de arquivo, não números.

## Correções que não estavam no pedido

- **Concorrência:** `rejectOvertime` escrevia sem predicado de estado, ao contrário do caminho em lote. Agora leva `overtimeStatus: 'PENDING'` no `UPDATE` e devolve `409` a quem perde a corrida. `rejectEntriesBulk` também reportava a contagem pré-leitura.
- **Banco de horas do reject em lote:** a reversão rodava num laço **antes** da transação, então uma falha dela deixava as marcações `PENDING` com o crédito já perdido. Virou uma leitura só, com as escritas dentro da transação — o que também removeu o gargalo que limitava o tamanho do lote.
- **INTEGRATOR:** `/admin/overtime-settings` concede o papel de propósito, mas a única UI ficava atrás de rota ADMIN-only. De quebra, um `Promise.all` fazia o `403` do overview de banco de horas derrubar o KPI que o INTEGRATOR tem direito de ver.
- **Filas truncadas:** a fila de HE e a de pendências usavam `limit=500` sem paginação. Nas pendências o efeito era pior: as ações **por colaborador** montam `entryIds` do que está carregado, mas a confirmação prometia "todos os N registros deste período". A ação de período inteiro sempre esteve correta — manda `{ scope }` e o servidor resolve.
- **Catálogo MCP:** o pattern de data era `'^\d{4}-\d{2}-\d{2}$'` entre aspas simples, e `\d` colapsa para `d` em JS. O schema anunciado era `^d{4}-d{2}-d{2}$`, que **rejeita qualquer data real** em cliente que valide. Afetava as 11 tools com parâmetro de data.

## Causa raiz comum, e o que impede a repetição

Quatro dos achados são o mesmo erro: um `select` escrito à mão que esqueceu um campo de que o consumidor precisava. **O mock do Prisma é `jest.fn()` e ignora `select`**, então nenhum teste de comportamento pega isso — a linha chega sem o campo e tudo "passa", com o número errado.

- `RECOGNIZED_MINUTES_SELECT` e `TENANT_OVERTIME_POLICY_SELECT`: fragmentos compartilhados, espalhados no `select` em vez de listados à mão.
- `assertOvertimeStatusSelected`: lança em `NODE_ENV=test` quando um `workedMinutes: 0` chega sem `overtimeStatus`, transformando um guard morto em falha de teste. Em produção apenas avisa — um registro legado real pode chegar sem o campo, e derrubar a requisição do colaborador seria pior.
- Os testes novos afirmam a **forma da query**, não só o resultado.

**Testes deixaram de ser invisíveis.** `backend/.gitignore` tinha `/tests/`: todo teste novo nascia fora do git e da CI — eram 4 arquivos e 35 testes nesse estado. A exclusão do deploy foi para o `.dockerignore`, onde pertence.

## Verificação

| | Antes | Depois |
|---|---|---|
| `jest` subset verde (o que a CI roda) | 23 suites / 293 testes | **29 / 322** |
| `jest` completo | 5 vermelhas (quarentena) | as mesmas 5, nenhuma nova |
| E2E contra Postgres real | 16/16 | **16/16** |
| Reversão de banco de horas (E2E) | — | **12/12** |
| Passagem HTTP pelas 4 telas | — | **24/24** |
| `tsc` / `npm run build` / `vitest` | verde | verde / verde / 56-56 |

### Validação manual na interface (2026-09-09)

As quatro tarefas foram exercitadas na tela, em ambiente local isolado:

| Tarefa | Evidência |
|---|---|
| Limiar de HE curta | Limiar em 10; saída batida com 483 min → **0 de HE**, `overtimeStatus` nulo |
| Janela/aba de HE | Aba listando a decisão pendente, separada do trabalho normal |
| Negar HE desconta | Bruno: **REALIZADO 18:00 → 16:00**, **SALDO 02:00 → 00:00**, accruals revertidos |
| Timesheet ao vivo | Painel "Esta semana, ao vivo" exibindo **08:03** |

Também confirmado que o detalhamento diário passou a mostrar 08:00 (antes 10:00) para o dia cuja HE foi negada.

## Riscos conhecidos, não resolvidos

- **`rejectEntriesBulk`:** um `UPDATE` que perde a corrida do predicado não impede a reversão do accrual daquela linha. Corrigir exigiria transação interativa, cujo timeout não aguenta um lote de 200 — trocaria uma falha rara por uma provável.
- **Sem teste de componente** para nenhuma das telas novas: `vitest` cobre um único arquivo (`offlineQueue`). Layout e navegação foram validados a olho, não automatizados.
- **Conformidade brasileira (AFD, AFDT/ACJEF, REP-C, LGPD) segue não iniciada.** O teto de 10 minutos apenas evita que esta funcionalidade agrave um problema de CLT; não endereça a conformidade em si.
