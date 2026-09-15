# Melhorias no limiar de hora extra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Congelar no registro o limiar com que ele foi calculado, parar de pagar como hora normal o minuto que o limiar engoliu, e acabar com a fórmula de pagamento triplicada.

**Architecture:** Três mudanças independentes sobre a feature que já existe em `main`. A 1 adiciona uma coluna anulável em `TimeEntry` e muda quem lê o limiar no recálculo. A 2 move o corte para a origem (`recalcDay` e clock-out), onde `main` já corta a HE negada. A 3 extrai um util de pagamento e faz as duas superfícies de relatório reconciliarem.

**Tech Stack:** Node 20, Express 5, Prisma 7 (`db push`, nunca `migrate`), Jest, React + Vite + TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-14-limiar-de-hora-extra-o-que-melhorar.md`

**Branch:** `feat/overtime-threshold-improvements`, criada de `main` em `c39b501`. A feature do limiar está presente — leia `backend/src/utils/tenantOvertimePolicy.js` e `backend/src/utils/overtime.js:53-60` antes de tocar em qualquer coisa.

## Global Constraints

- **O limiar é corte seco, não franquia.** Abaixo dele não há hora extra; a partir dele a hora extra vale cheia (11 min continuam 11, não 1). Aplicado sempre ao **total do dia**, nunca ao pedaço de uma marcação. Isso já está implementado e não muda.
- **`prisma db push`, nunca `prisma migrate`.** O `DATABASE_URL` de `backend/.env` aponta para **produção** por túnel SSH: nenhuma tarefa deste plano roda comando de banco. O push é passo operacional do dono, no fim.
- **Banco local para teste:** `docker-compose.local.yml`, Postgres em `localhost:55433`, schema `schema_automation`. Só com URL explícita na linha de comando.
- **Estilo de commit:** frase imperativa em português sem acentos, sem prefixo `feat:`/`fix:`, terminando com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **`backend/.gitignore:71` contém `/tests/`.** Arquivo de teste novo exige `git add -f`; confira com `git show --stat HEAD` antes de reportar.
- **Copy do frontend** é inline via `t('EN', 'PT')`, português sem acentos.

---

### Task 1: Congelar o limiar no registro

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `TimeEntry`)
- Modify: `backend/src/utils/recalcDay.js`
- Modify: `backend/src/controllers/time.controller.js` (clock-out, ~1051)
- Modify: `backend/src/controllers/hr.controller.js` (`createHrEntry`, ~409)
- Test: `backend/tests/utils/recalcDay.test.js`

**Interfaces:**
- Consumes: `resolveMinOvertimeMinutes` e `TENANT_OVERTIME_POLICY_SELECT` de `utils/tenantOvertimePolicy.js`.
- Produces: coluna `TimeEntry.overtimeMinMinutesApplied Int?`.

**A regra de migração, que é a parte sutil.** Marcações criadas entre 09/09 e esta mudança **já foram calculadas com limiar** e não têm carimbo. Se `null` significasse "sem limiar", o primeiro recálculo delas mudaria dias já fechados — o oposto do objetivo. Então:

- `null` ⇒ usa o limiar **vigente** do tenant (exatamente o comportamento de hoje).
- valor gravado ⇒ usa o valor gravado, ignorando o vigente.

Assim o dia 1 não muda nada, e cada marcação nova nasce imune. É melhoria monotônica, sem janela de regressão.

- [ ] **Step 1: Escreva os testes que falham**

Em `backend/tests/utils/recalcDay.test.js`, dentro do describe existente:

```js
  describe('limiar congelado no registro', () => {
    // 8h20 numa jornada de 8h => 20 min acima do contrato.
    const shortOvertimeEntry = (over = {}) => ({
      id: 'entry-1',
      userId: 'user-123',
      clockIn: new Date(DAY.getTime() - 500 * 60 * 1000),
      clockOut: new Date(DAY.getTime()),
      breakMinutes: 0,
      status: 'PENDING',
      overtimeStatus: 'PENDING',
      location: null,
      overtimeMinMinutesApplied: null,
      ...over,
    });

    it('usa o limiar gravado no registro e ignora o vigente do tenant', async () => {
      // Tenant hoje em 10, registro carimbado com 30: 20 min de excedente
      // ficam abaixo do carimbo e nao geram hora extra.
      const stored = arrangeEntry(shortOvertimeEntry({ overtimeMinMinutesApplied: 30 }), {
        overtimeMinMinutes: 10,
      });

      const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

      expect(result.overtimeMinutes).toBe(0);
      expect(stored.overtimeStatus).toBeNull();
    });

    it('sem carimbo, cai no limiar vigente do tenant (comportamento de hoje)', async () => {
      const stored = arrangeEntry(shortOvertimeEntry({ overtimeMinMinutesApplied: null }), {
        overtimeMinMinutes: 30,
      });

      const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

      expect(result.overtimeMinutes).toBe(0);
      expect(stored.overtimeStatus).toBeNull();
    });

    it('o carimbo nao vira franquia: acima dele o excedente vale inteiro', async () => {
      arrangeEntry(shortOvertimeEntry({ overtimeMinMinutesApplied: 15 }), {
        overtimeMinMinutes: 0,
      });

      const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

      expect(result.overtimeMinutes).toBe(20);
    });
  });
```

O helper `arrangeEntry` existente precisa aceitar o segundo argumento com a configuração do tenant — ajuste-o para montar `user.findUnique` devolvendo `{ contractDailyMinutes: 480, organizationAdmin: { overtimeMinMinutes } }`, mantendo o default atual quando o argumento não vier, para os testes existentes não mudarem.

- [ ] **Step 2: Rode e confirme que falha**

Run (de `backend/`): `npx jest tests/utils/recalcDay.test.js`
Expected: FAIL no primeiro caso — o recálculo ainda lê o vigente (10) e devolve 20 em vez de 0. O segundo e o terceiro já passam: são o comportamento atual, capturado agora.

- [ ] **Step 3: Adicione a coluna**

Em `backend/prisma/schema.prisma`, no model `TimeEntry`, depois de `overtimePercent`:

```prisma
  // Limiar de hora extra curta com que ESTE registro foi calculado. Congelado
  // aqui pelo mesmo motivo de overtimePercent: o recalculo do dia nao pode reler
  // a configuracao atual do tenant e mudar hora extra ja aprovada. null =
  // registro anterior a este carimbo, que cai no vigente para nao alterar dia
  // ja fechado.
  overtimeMinMinutesApplied Int?
```

Run (de `backend/`): `npx prisma generate` — **nunca `db push`**.

- [ ] **Step 4: Leia o carimbo no recálculo**

Em `backend/src/utils/recalcDay.js`, acrescente o campo ao `select` das marcações e troque a resolução do limiar por marcação:

```js
    select: {
      id: true,
      clockIn: true,
      clockOut: true,
      breakMinutes: true,
      status: true,
      overtimeStatus: true,
      overtimeMinMinutesApplied: true,
    },
```

e, dentro do laço, antes de `calculateIncrementalOvertimeSummary`:

```js
    // Carimbo do proprio registro quando existe; so cai no vigente do tenant
    // para marcacao anterior a este campo, onde usar o vigente e o que preserva
    // o numero que ela ja tinha.
    const entryMinOvertimeMinutes =
      entry.overtimeMinMinutesApplied ?? minOvertimeMinutes;
```

passando `minOvertimeMinutes: entryMinOvertimeMinutes` no cálculo.

- [ ] **Step 5: Carimbe onde a marcação nasce fechada**

No clock-out (`time.controller.js`, no `data` do update que fecha o ponto, junto de `overtimeStatus`):

```js
        overtimeMinMinutesApplied: resolveMinOvertimeMinutes(userConfig),
```

Em `createHrEntry` (`hr.controller.js`), o `target` precisa carregar a política — acrescente `TENANT_OVERTIME_POLICY_SELECT` ao `select` do alvo e grave no `data` do `create`:

```js
        overtimeMinMinutesApplied: resolveMinOvertimeMinutes(target),
```

**Não carimbe em `updateHrEntry`.** Editar um registro já fechado mantém o carimbo que ele tem: re-carimbar com o vigente é exatamente a regressão que esta tarefa remove.

- [ ] **Step 6: Rode e confirme que passa**

Run (de `backend/`): `npx jest tests/utils/recalcDay tests/controllers/time tests/controllers/overtimeSettings tests/utils/tenantOvertimePolicy`
Expected: PASS. Se uma suíte verde quebrar, investigue — não afrouxe a asserção.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/src/utils/recalcDay.js backend/src/controllers/time.controller.js backend/src/controllers/hr.controller.js backend/tests/utils/recalcDay.test.js
git commit -m "Congelar no registro o limiar de hora extra com que ele foi calculado" -m "O recalculo lia o limiar vigente do tenant, entao um ADMIN que subia o valor
fazia a proxima correcao do RH num dia antigo zerar hora extra ja aprovada e
reverter banco de horas, sem erro em tela.

Marcacao sem carimbo cai no vigente de proposito: as criadas desde 09/09 foram
calculadas COM limiar e um null tratado como 'sem limiar' mudaria dia fechado.
Assim o dia 1 nao muda nada e cada marcacao nova nasce imune.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Minuto engolido pelo limiar sai do reconhecido

**Files:**
- Modify: `backend/src/utils/recalcDay.js`
- Modify: `backend/src/controllers/time.controller.js` (clock-out)
- Test: `backend/tests/utils/recalcDay.test.js`, `backend/tests/controllers/timeClockOutThreshold.test.js`

**Interfaces:**
- Consumes: a coluna e a resolução por marcação da Task 1.
- Produces: nada para tarefas seguintes.

**A regra.** Quando o limiar engole o excedente, o reconhecido passa a ser `min(trabalhado, contrato)`. É o espelho exato do que `main` já faz com a HE **negada** em `recalcDay.js:166` (`workedMinutes = trabalhado − HE`): as duas situações são "esse tempo não vira hora extra", e hoje uma reduz o reconhecido e a outra não.

Fazer na **origem**, não na camada de relatório: é o que faz todo consumidor herdar — página de custo, export, KPI, detalhamento — sem cada um precisar aplicar teto por conta própria.

**Atenção:** dia abaixo do contrato não muda (400 trabalhados seguem 400). E o excedente ACIMA do limiar continua inteiro no reconhecido, porque aí ele é hora extra de verdade.

- [ ] **Step 1: Escreva os testes que falham**

Em `backend/tests/utils/recalcDay.test.js`, no describe da Task 1:

```js
    it('tira do reconhecido o minuto que o limiar engoliu', async () => {
      // 500 trabalhados, contrato 480, limiar 30: os 20 de excedente nao viram
      // hora extra E nao ficam como hora normal paga.
      const stored = arrangeEntry(shortOvertimeEntry({ overtimeMinMinutesApplied: 30 }));

      const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

      expect(result.overtimeMinutes).toBe(0);
      expect(result.workedMinutes).toBe(480);
      expect(stored.workedMinutes).toBe(480);
    });

    it('acima do limiar o excedente continua inteiro no reconhecido', async () => {
      const stored = arrangeEntry(shortOvertimeEntry({ overtimeMinMinutesApplied: 15 }));

      const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

      expect(result.overtimeMinutes).toBe(20);
      expect(stored.workedMinutes).toBe(500);
    });

    it('dia abaixo do contrato nao e tocado', async () => {
      const stored = arrangeEntry(
        shortOvertimeEntry({
          clockIn: new Date(DAY.getTime() - 400 * 60 * 1000),
          overtimeMinMinutesApplied: 30,
        })
      );

      const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

      expect(result.workedMinutes).toBe(400);
      expect(stored.workedMinutes).toBe(400);
    });
```

E o equivalente no clock-out, em `backend/tests/controllers/timeClockOutThreshold.test.js` — leia a suíte existente e siga a montagem dela; o caso novo é: tenant com limiar 30, turno de 500 minutos, o `data` do update tem `workedMinutes: 480` e `overtimeStatus: null`.

- [ ] **Step 2: Rode e confirme que falha**

Run (de `backend/`): `npx jest tests/utils/recalcDay tests/controllers/timeClockOutThreshold`
Expected: FAIL nos dois casos de corte — `workedMinutes` vem 500 em vez de 480. Os casos de "acima do limiar" e "abaixo do contrato" já passam.

- [ ] **Step 3: Corte na origem**

O cálculo já devolve `overtimeMinutes` filtrado pelo limiar. O que falta é distinguir "não houve excedente" de "houve e o limiar engoliu". Em `utils/overtime.js`, `calculateIncrementalOvertimeSummary` passa a devolver também o excedente **antes** do corte — algo como `overtimeMinutesBeforeThreshold` — sem alterar nenhum campo existente.

Com isso, no recálculo e no clock-out, o reconhecido vira:

```js
    // Minuto engolido pelo limiar sai do reconhecido, igual ao tratamento da HE
    // negada logo abaixo: as duas situacoes sao "esse tempo nao vira hora
    // extra", e deixar uma delas virar hora normal paga e o que fazia a planilha
    // pagar 490 minutos num dia de 480 de contrato.
    const swallowedByThreshold =
      overtime.overtimeMinutes === 0 ? overtime.overtimeMinutesBeforeThreshold : 0;
    const recognizedMinutes = Math.max(0, overtime.workedMinutes - swallowedByThreshold);
```

gravando `workedMinutes: recognizedMinutes`. **Acumule `workedMinutesBeforeEntry` com o valor CHEIO**, não com o reconhecido — mesma razão que o comentário do bloco de HE negada já dá em `recalcDay.js:180-184`: a diferença cai inteira na faixa acima do contrato e não pode deslocar a hora extra das marcações seguintes.

- [ ] **Step 4: Rode e confirme que passa**

Run (de `backend/`): `npx jest tests/utils/recalcDay tests/controllers/time tests/utils/overtime`
Expected: PASS, incluindo as suítes existentes de HE negada.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/overtime.js backend/src/utils/recalcDay.js backend/src/controllers/time.controller.js backend/tests/utils/recalcDay.test.js backend/tests/controllers/timeClockOutThreshold.test.js
git commit -m "Tirar do reconhecido o minuto que o limiar de hora extra engoliu" -m "Num contrato de 480 com limiar 30, um dia de 500 gravava 500 minutos
reconhecidos com zero de hora extra — entao a planilha pagava os 20 minutos como
hora normal. E o espelho do que ja se faz com a HE negada: as duas situacoes sao
'esse tempo nao vira hora extra'.

Feito na origem e nao na camada de relatorio, para todo consumidor herdar sem
aplicar teto por conta propria.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Uma fonte de verdade para pagamento, e custo que reconcilia com o export

**Files:**
- Create: `backend/src/utils/entryPayment.js`
- Modify: `backend/src/controllers/time.controller.js`, `backend/src/controllers/report.controller.js`, `backend/src/workers/reportWorker.js`
- Modify: `frontend/src/pages/Reports.tsx`
- Test: `backend/tests/utils/entryPayment.test.js` (novo), `backend/tests/controllers/report.controller.test.js`, `backend/tests/workers/reportWorker.test.js`

**Interfaces:**
- Produces: `calculateEntryPaymentRaw`, `calculateEntryPayment`, `resolveSettledOvertime`, `resolveIncurredOvertime`.

**Já existe implementado e testado** na branch `feat/mobile-capacitor`, commits `5d9dd7a` e `c7fc865`. Comece lendo `git show 5d9dd7a` e `git show c7fc865` e porte o que se aplica — **sem** o teto contratual (`calculateDayPaymentRaw`, `allocateDayNormalMinutes` e o preenchimento cronológico dos commits `95c14d7`, `9914c79`, `8202268`), que a Task 2 torna desnecessário ao cortar na origem.

Pontos que o porte precisa preservar:

- Aritmética e arredondamento **separados**: quem agrega soma cru e arredonda uma vez só. Acumular valores já arredondados desloca centavos.
- `calculateEntryPayment` mantém a forma que o clock-out consome — a resposta não pode mudar um centavo.
- As duas políticas nomeadas, com o comentário de cabeçalho dizendo que respondem perguntas diferentes e que `incorrido = liquidado + pendente` tem que valer.
- A página de custo expõe `pendingOvertimeCost`, `pendingOvertimeMinutes` e `settledCost`, e o `Reports.tsx` mostra quanto do custo é HE aguardando decisão.
- O teste que encadeia os dois lados: `settledCost` da página de custo igual ao que o export paga pelas mesmas marcações.

- [ ] **Step 1: Leia os commits de origem e porte**

Run: `git show 5d9dd7a`, `git show c7fc865`

Aplique em cima do código de `main`, que diverge do de origem — `report.controller.js` e `reportWorker.js` mudaram nos 20 commits. Não force um cherry-pick; porte à mão e confira cada hunk.

- [ ] **Step 2: Rode**

Run (de `backend/`): `npx jest tests/utils/entryPayment tests/controllers/report.controller tests/workers/reportWorker tests/controllers/time`
Expected: PASS. Nenhum valor esperado existente deve mudar — este é refactor, não mudança de comportamento. Se um mudar, pare e reporte.

- [ ] **Step 3: Frontend**

Run (de `frontend/`): `npm run build`

- [ ] **Step 4: Commit**

```bash
git add backend/src/utils/entryPayment.js backend/src/controllers backend/src/workers/reportWorker.js backend/tests frontend/src/pages/Reports.tsx
git commit -m "Unificar a formula de pagamento e reconciliar custo com o export" -m "Tres copias a mao da mesma aritmetica, e as copias discordavam em silencio: a
pagina de custo conta HE aguardando decisao pelo adicional, o export so conta HE
aprovada. As duas leituras sao legitimas; o defeito era nao dar para reconciliar.

Agora custo = pagavel + HE pendente, com o pedaco pendente exposto como campo e
mostrado na tela.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Levar a coluna ao banco

**Files:** nenhum. Passo operacional, **do dono do projeto**.

O `DATABASE_URL` de `backend/.env` aponta para produção por túnel SSH. A coluna da Task 1 é anulável e o código trata `null` caindo no vigente, então **as duas ordens de deploy são seguras** — diferente da rodada anterior. Ainda assim, aplique o schema antes de subir o backend, para o carimbo começar a valer imediatamente.

- [ ] **Step 1: Local primeiro**

```bash
cd backend
npx prisma db push --url 'postgresql://omnipunt:omnipunt_local@localhost:55433/omnipunt_local?schema=schema_automation&options=-c%20search_path%3Dschema_automation'
```

- [ ] **Step 2: Conferir na tela local** (`docker-compose.local.yml`, porta 8080): limiar 15 no admin, turno de 8h10 fecha sem hora extra e sem pagar os 10 minutos; turno de 8h20 gera 20 minutos de hora extra.

- [ ] **Step 3: Produção, com o dono presente**

```bash
npx prisma db push
```

---

## Ordem

1 → 2 → 3 → 4. A Task 2 depende da coluna da 1 apenas para os testes usarem carimbo; a 3 é independente das duas e pode correr em paralelo se necessário.
