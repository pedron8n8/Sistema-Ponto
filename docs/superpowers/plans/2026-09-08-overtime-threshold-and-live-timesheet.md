# Overtime Threshold Completion + Live Weekly Timesheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the short-overtime threshold and the "denied overtime leaves the recognized total" rule through every code path that computes or reads worked minutes, then add a live weekly timesheet served from one endpoint to both the web app and the omni MCP connection.

**Architecture:** Two independent halves shipped as three phases. Phase 1 fixes correctness by replacing four hand-written Prisma `select` blocks and two overtime-computation call sites with shared fragments, so a new call site cannot silently omit `overtimeStatus` or `overtimeMinMinutes` again. Phase 2 makes new tests visible to git and CI — without it, every test written in this plan is invisible to the repo. Phase 3 adds `GET /reports/weekly-timesheet`, consumed by a live panel in `Reports.tsx` and by one new declarative MCP catalog entry, so the numbers cannot drift between surfaces.

**Tech Stack:** Node 20, Express, Prisma (Postgres, `schema_automation`), Jest + hand-written Prisma mock, React 18 + Vite + TypeScript, Tailwind, react-i18next, BullMQ (untouched by this plan's read path).

**Spec:** This document is self-contained. It implements the four tasks in the original request plus the findings from the review recorded in `docs/superpowers/plans/2026-09-08-overtime-threshold-and-live-timesheet.md` (this file, "Findings This Plan Closes" below).

## Global Constraints

- Backend is CommonJS (`require`/`module.exports`). No ESM, no TypeScript in `backend/`.
- Prisma schema changes ship via `npx prisma db push`, **never** `prisma migrate` — this project has no migration history.
- Tenancy is application-level: no RLS, no `tenantId`. Isolation rides on `organizationAdminId` and `resolveVisibleUserIds`. Never add a query that reads across tenants.
- The short-overtime threshold lives on the **tenant owner's** `User` row (`User.overtimeMinMinutes`), read via the `organizationAdmin` relation. `null` or `0` means the rule is off.
- The threshold is a **hard cut, not an allowance**: below it there is no overtime; at or above it the overtime counts in **full** (11 min stays 11, not 1).
- The threshold always applies to the **day total**, never to a single entry's slice.
- `workedMinutes` is `Int @default(0)`, so `0` is ambiguous. A `0` is authoritative **only** when `overtimeStatus === 'REJECTED'`. Every query whose rows reach `isWorkedMinutesAuthoritative` **must** select `overtimeStatus`.
- Do **not** unify the three worked-minutes fallback formulas. They deliberately disagree (the report deducts break, the KPI and payroll paths do not); unifying them would silently change payroll numbers for legacy rows. Share the *predicate* and the *select*, not the arithmetic.
- In-app copy bypasses locale files: components use a local `t = (en, pt) => i18nT(isPt ? pt : en)` helper. Follow that pattern; do not add keys to locale JSON.
- Frontend calls go through `apiFetch`, which already toasts and throws on error and auto-hashes an idempotency key. Do not add your own toast for the same failure.
- Touch targets on interactive elements: `min-h-[44px]` with `md:min-h-0`.
- Pending overtime blocks entry approval. That ordering is an invariant — never bypass it.
- CI runs a green subset only. These five suites are quarantined and expected red; do not "fix" them in this plan: `tests/routes/routes.integration.test.js`, `tests/controllers/admin.controller.test.js`, `tests/controllers/finance.controller.test.js`, `tests/controllers/user.controller.test.js`, `tests/controllers/vacation.controller.test.js`.

## Findings This Plan Closes

Verified against the working tree and, where marked, at runtime against local Postgres.

| # | Severity | Finding | Closed by |
|---|---|---|---|
| 1 | HIGH | `time.controller.js:1004` clock-out omits `minOvertimeMinutes`; its `userConfig` select omits `organizationAdmin.overtimeMinMinutes`. Persists `overtimeMinutes: 6` and `overtimeStatus: 'PENDING'` for a 6-min day, blocking approval. **Proven at runtime.** | Task 3 |
| 2 | HIGH | `supervisor.controller.js:346` guard `isWorkedMinutesAuthoritative` is dead code — the `todayEntries` select (line 302) omits `overtimeStatus`, so the check is always `undefined === 'REJECTED'`. Denied hours flow back into presence KPIs and alerts. | Task 4 |
| 3 | MEDIUM | Clock-out and `getCurrentEntry` prior-entry queries (`time.controller.js:990`, `:1508`) select only `clockIn/clockOut/workedMinutes`, so `resolveWorkedMinutes` re-derives full duration for denied entries and inflates `workedMinutesBeforeEntry`. | Task 3 |
| 4 | MEDIUM | `proactiveAlertWorker.js:352` `closedEntriesToday` omits `overtimeStatus` and has no authoritative-zero guard; alerts fire over hours the manager already denied. | Task 5 |
| 5 | MEDIUM | `MAX_OVERTIME_MIN_MINUTES = 120` permits erasing 2h/day of worked overtime. CLT art. 58 §1º tolerates ~10 min/day. No record of who changed the tenant-wide setting. | Task 7 |
| 6 | MEDIUM | `SupervisorOvertimePage.tsx:69` uses `limit=500` with no pagination and ignores `pagination.total`; a truncated queue reads as a finished one. | Task 9 |
| 7 | LOW | `/admin/overtime-settings` grants INTEGRATOR, but the only UI (`AdminBankHoursPage`) sits behind `allowedRoles={['ADMIN']}` (`App.tsx:315`). The grant is unreachable. | Task 8 |
| 8 | LOW | `rejectOvertime` writes with `where: { id }` and no `overtimeStatus: 'PENDING'` predicate, unlike the bulk path directly above it. | Task 6 |
| 9 | LOW | `rejectEntriesBulk` reports `overtimeRejectedCount: overtimeIds.length` (pre-read) though each per-row `updateMany` now returns a real `count`. | Task 6 |
| 10 | PROCESS | `backend/.gitignore:71` is `/tests/`. Both new test files are ignored — they pass locally and would never be committed or run in CI. | Task 1 |
| 11 | PROCESS | Tests exercise the calculators directly with the threshold passed in; nothing asserts a **caller** passes it. This is how finding 1 survived a suite by the same author. | Tasks 2–5 (select-shape assertions) |
| 12 | PROCESS | `backend/.env.docker-local` and four DB-mutating scripts are untracked **and** un-ignored; `git add -A` would commit an env file and scripts that write to a DB. | Task 1 |
| — | REFUTED | "ADMIN is exempt from its own threshold." Not reproducible: `auth.middleware.js:201` and `user.controller.js:769` both self-tenant ADMINs, and the local DB shows 1/1 ADMINs with `organizationAdminId` set. No task. |

## File Structure

**Phase 1 — correctness**
- Modify `backend/src/utils/recognizedMinutes.js` — add the shared select fragment and a dev-mode assertion next to the existing predicate. Owns the "is this zero authoritative" question.
- Create `backend/src/utils/tenantOvertimePolicy.js` — owns "how do I fetch and resolve a tenant's threshold": the `organizationAdmin` select fragment and the resolver. Separate file from `overtime.js` because `overtime.js` is pure arithmetic with no Prisma knowledge, and mixing a query fragment into it would give it two responsibilities.
- Modify `backend/src/controllers/time.controller.js` — clock-out and `getCurrentEntry` selects and call sites.
- Modify `backend/src/controllers/supervisor.controller.js` — presence select, reject predicate, bulk count.
- Modify `backend/src/workers/proactiveAlertWorker.js` — scan select and reducer.
- Modify `backend/src/controllers/admin.controller.js` + `backend/prisma/schema.prisma` — threshold cap and provenance columns.
- Modify `frontend/src/App.tsx` — INTEGRATOR on the bank-hours route.
- Modify `frontend/src/pages/SupervisorOvertimePage.tsx` — pagination.

**Phase 3 — live weekly timesheet**
- Create `backend/src/utils/weeklyTimesheet.js` — pure shaping of entries into days + totals. No Prisma, so it is unit-testable without the mock.
- Modify `backend/src/controllers/report.controller.js` + `backend/src/routes/report.routes.js` — the new endpoint.
- Create `backend/src/mcp/catalog/reports.js` entry — declarative, inherits guards via the loopback REST bridge.
- Modify `frontend/src/pages/Reports.tsx` — live panel.

---

### Task 1: Make tests visible to git, and dev artifacts invisible

Everything later in this plan writes tests. Until this lands, those tests are ignored files that never reach CI or another worktree. This task must go first.

**Files:**
- Modify: `backend/.gitignore:71`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Consumes: nothing.
- Produces: a repo where `backend/tests/**` is tracked and `backend/.env.docker-local`, `backend/*-local*.js`, `backend/inspect-local-db.js`, `backend/recalc-test-days.js`, `backend/seed-overtime-test.js`, `docker-compose.local.yml` are ignored.

- [ ] **Step 1: Confirm the problem before changing anything**

Run:
```bash
git check-ignore -v backend/tests/utils/overtimeThreshold.test.js backend/tests/utils/recognizedMinutes.test.js
```
Expected: both lines match `backend/.gitignore:71:/tests/`. This is the bug.

- [ ] **Step 2: Stop ignoring tests, keep them off the VPS**

The comment "Testes nao vao pra VPS" describes a *deploy* concern, not a *version control* concern. Deployment already excludes tests via the Docker build; git should not.

In `backend/.gitignore`, replace line 71:

```gitignore
# Testes nao vao pra VPS
/tests/
```

with:

```gitignore
# Testes SAO versionados (a exclusao do deploy e feita pelo .dockerignore,
# nao aqui). Ignorar /tests/ fazia todo teste novo nascer invisivel para o
# git e para a CI: passava na maquina de quem escreveu e nunca era commitado.
```

- [ ] **Step 3: Confirm the tests are now visible**

Run:
```bash
git check-ignore -v backend/tests/utils/overtimeThreshold.test.js; echo "exit=$?"
git status --porcelain backend/tests
```
Expected: `check-ignore` exits 1 with no output; `git status` lists `?? backend/tests/utils/overtimeThreshold.test.js` and `?? backend/tests/utils/recognizedMinutes.test.js`.

- [ ] **Step 4: Verify the deploy image really does exclude tests**

Run:
```bash
grep -n "tests" backend/.dockerignore
```
Expected: a `tests` entry. **If there is none, add it** — this is what makes Step 2 safe:

```gitignore
tests
```

- [ ] **Step 5: Ignore the local-only dev artifacts**

Append to the repo-root `.gitignore`:

```gitignore
# Stack local de teste e scripts que MEXEM em banco. Ficam fora do git de
# proposito: .env.docker-local carrega credenciais locais e os scripts abaixo
# escrevem no banco, entao um `git add -A` distraido os publicaria.
/docker-compose.local.yml
/backend/.env.docker-local
/backend/inspect-local-db.js
/backend/recalc-test-days.js
/backend/seed-overtime-test.js
/backend/verify-overtime-local.js
```

- [ ] **Step 6: Verify nothing dangerous is stageable and nothing useful is lost**

Run:
```bash
git status --porcelain | grep -E "\.env|docker-compose.local|seed-overtime|recalc-test|inspect-local|verify-overtime"; echo "exit=$?"
```
Expected: exit 1, no output — none of those appear as untracked-and-stageable any more.

- [ ] **Step 7: Commit**

```bash
git add backend/.gitignore backend/.dockerignore .gitignore
git add backend/tests/utils/overtimeThreshold.test.js backend/tests/utils/recognizedMinutes.test.js
git commit -m "Version the backend tests, and ignore the local-only dev artifacts

/tests/ in backend/.gitignore made every new test file invisible to git and
to CI: it passed on the machine that wrote it and was never committed. The
deploy exclusion belongs in .dockerignore, which already handles it."
```

---

### Task 2: Shared fragments so a call site cannot omit the threshold or the status

Findings 1–4 are all the same mistake in four places: a hand-written `select` that forgot a field the consumer needs. The Prisma mock is a plain `jest.fn()` and ignores `select` entirely, so no behavior test can catch it. The fix is one shared fragment per concern plus a dev-mode assertion that turns a silently-dead guard into a loud failure in tests.

**Files:**
- Modify: `backend/src/utils/recognizedMinutes.js`
- Create: `backend/src/utils/tenantOvertimePolicy.js`
- Test: `backend/tests/utils/tenantOvertimePolicy.test.js`
- Test: `backend/tests/utils/recognizedMinutes.test.js` (extend)

**Interfaces:**
- Consumes: `isWorkedMinutesAuthoritative(entry)` (already exported from `recognizedMinutes.js`).
- Produces:
  - `RECOGNIZED_MINUTES_SELECT` — `{ workedMinutes: true, overtimeStatus: true }`, spread into any `select` whose rows reach `isWorkedMinutesAuthoritative`.
  - `assertOvertimeStatusSelected(entry, context)` — throws in `NODE_ENV === 'test'`, `console.warn`s otherwise, when `workedMinutes === 0` and `overtimeStatus === undefined`.
  - `TENANT_OVERTIME_POLICY_SELECT` — `{ organizationAdmin: { select: { overtimeMinMinutes: true } } }`.
  - `resolveMinOvertimeMinutes(userRow)` → `number | null`.

- [ ] **Step 1: Write the failing test for the tenant policy resolver**

Create `backend/tests/utils/tenantOvertimePolicy.test.js`:

```javascript
const {
  TENANT_OVERTIME_POLICY_SELECT,
  resolveMinOvertimeMinutes,
} = require('../../src/utils/tenantOvertimePolicy');

describe('TENANT_OVERTIME_POLICY_SELECT', () => {
  it('pede o limiar pela relacao do dono da organizacao', () => {
    expect(TENANT_OVERTIME_POLICY_SELECT).toEqual({
      organizationAdmin: { select: { overtimeMinMinutes: true } },
    });
  });
});

describe('resolveMinOvertimeMinutes', () => {
  it('devolve o limiar do dono da organizacao', () => {
    expect(resolveMinOvertimeMinutes({ organizationAdmin: { overtimeMinMinutes: 10 } })).toBe(10);
  });

  it('devolve null quando o limiar esta desligado', () => {
    expect(resolveMinOvertimeMinutes({ organizationAdmin: { overtimeMinMinutes: null } })).toBeNull();
  });

  it('devolve null para base legada sem dono de organizacao', () => {
    expect(resolveMinOvertimeMinutes({ organizationAdmin: null })).toBeNull();
    expect(resolveMinOvertimeMinutes({})).toBeNull();
    expect(resolveMinOvertimeMinutes(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/utils/tenantOvertimePolicy.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/tenantOvertimePolicy'`.

- [ ] **Step 3: Write the minimal implementation**

Create `backend/src/utils/tenantOvertimePolicy.js`:

```javascript
// Como se BUSCA e se resolve o limiar de HE curta do tenant.
//
// Vive fora de utils/overtime.js de proposito: overtime.js e aritmetica pura e
// nao sabe o que e Prisma. O que quebrou antes nao foi a conta, foi cada call
// site escrever seu proprio `select` e esquecer o campo. Fragmento unico
// resolve isso — quem faz a query espalha a constante e nao tem como esquecer.
const TENANT_OVERTIME_POLICY_SELECT = {
  organizationAdmin: { select: { overtimeMinMinutes: true } },
};

// Colaborador sem dono de organizacao (base legada) simplesmente nao tem
// limiar: o comportamento volta a ser o de antes, sem limiar nenhum.
const resolveMinOvertimeMinutes = (userRow) =>
  userRow?.organizationAdmin?.overtimeMinMinutes ?? null;

module.exports = { TENANT_OVERTIME_POLICY_SELECT, resolveMinOvertimeMinutes };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx jest tests/utils/tenantOvertimePolicy.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for the select fragment and the assertion**

Append to `backend/tests/utils/recognizedMinutes.test.js`:

```javascript
const {
  RECOGNIZED_MINUTES_SELECT,
  assertOvertimeStatusSelected,
} = require('../../src/utils/recognizedMinutes');

describe('RECOGNIZED_MINUTES_SELECT', () => {
  it('pede os dois campos que o predicado precisa', () => {
    expect(RECOGNIZED_MINUTES_SELECT).toEqual({
      workedMinutes: true,
      overtimeStatus: true,
    });
  });
});

describe('assertOvertimeStatusSelected', () => {
  // O mock do Prisma e um jest.fn() e IGNORA `select`, entao nenhum teste de
  // comportamento pega um select incompleto. Esta asercao transforma um guard
  // morto em falha alta durante os testes.
  it('explode quando o zero chega sem overtimeStatus no select', () => {
    expect(() =>
      assertOvertimeStatusSelected({ workedMinutes: 0 }, 'presenca')
    ).toThrow(/overtimeStatus/);
  });

  it('aceita o zero quando overtimeStatus veio no select', () => {
    expect(() =>
      assertOvertimeStatusSelected({ workedMinutes: 0, overtimeStatus: 'REJECTED' }, 'presenca')
    ).not.toThrow();
    expect(() =>
      assertOvertimeStatusSelected({ workedMinutes: 0, overtimeStatus: null }, 'presenca')
    ).not.toThrow();
  });

  it('nao se mete quando o valor gravado e positivo', () => {
    expect(() => assertOvertimeStatusSelected({ workedMinutes: 480 }, 'presenca')).not.toThrow();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && npx jest tests/utils/recognizedMinutes.test.js`
Expected: FAIL — `assertOvertimeStatusSelected is not a function`.

- [ ] **Step 7: Implement the fragment and the assertion**

In `backend/src/utils/recognizedMinutes.js`, add above `module.exports`:

```javascript
// Campos que QUALQUER query precisa trazer para o predicado acima funcionar.
// Espalhe no `select` em vez de listar a mao: o bug que isso previne e um
// `select` sem overtimeStatus, que faz o predicado comparar
// `undefined === 'REJECTED'` e devolver false para sempre — guard morto, e o
// fallback ressuscita justamente os minutos negados.
const RECOGNIZED_MINUTES_SELECT = {
  workedMinutes: true,
  overtimeStatus: true,
};

// Guard morto e invisivel: nao quebra nada, so devolve o numero errado. O mock
// do Prisma ignora `select`, entao teste de comportamento nao pega. Em teste
// isto explode; em producao apenas avisa, porque um registro legado real pode
// chegar sem o campo e derrubar a requisicao seria pior que somar demais.
const assertOvertimeStatusSelected = (entry, context) => {
  if (!entry || entry.workedMinutes !== 0) return;
  if (entry.overtimeStatus !== undefined) return;

  const message =
    `[recognizedMinutes] ${context}: entrada com workedMinutes 0 chegou sem ` +
    'overtimeStatus no select. Espalhe RECOGNIZED_MINUTES_SELECT na query, ' +
    'senao o zero autoritativo de HE negada vira fallback e os minutos negados voltam.';

  if (process.env.NODE_ENV === 'test') throw new Error(message);
  console.warn(message);
};
```

Then extend the exports:

```javascript
module.exports = {
  isWorkedMinutesAuthoritative,
  RECOGNIZED_MINUTES_SELECT,
  assertOvertimeStatusSelected,
};
```

- [ ] **Step 8: Run both suites to verify they pass**

Run: `cd backend && npx jest tests/utils/recognizedMinutes.test.js tests/utils/tenantOvertimePolicy.test.js`
Expected: PASS, 14 tests total.

- [ ] **Step 9: Commit**

```bash
git add backend/src/utils/tenantOvertimePolicy.js backend/src/utils/recognizedMinutes.js backend/tests/utils/tenantOvertimePolicy.test.js backend/tests/utils/recognizedMinutes.test.js
git commit -m "Share the overtime-policy and recognized-minutes select fragments

Four call sites hand-wrote a select and forgot a field the consumer needed.
The Prisma mock ignores select, so no behavior test could catch it. One
fragment per concern, plus an assertion that turns a dead guard into a test
failure instead of a wrong number."
```

---

### Task 3: Apply the threshold where overtime is actually persisted

The clock-out path is the primary overtime write and the only one that stamps `overtimeStatus`. It never received the threshold. Its prior-entry query also resurrects denied minutes into `workedMinutesBeforeEntry`.

**Files:**
- Modify: `backend/src/controllers/time.controller.js` (clock-out `userConfig` select ~line 880, prior-entries select ~line 990, `calculateIncrementalOvertimeSummary` call ~line 1004, `getCurrentEntry` prior-entries select ~line 1508)
- Test: `backend/tests/controllers/timeClockOutThreshold.test.js`

**Interfaces:**
- Consumes: `TENANT_OVERTIME_POLICY_SELECT`, `resolveMinOvertimeMinutes` (Task 2); `RECOGNIZED_MINUTES_SELECT` (Task 2); `calculateIncrementalOvertimeSummary({ ..., minOvertimeMinutes })` (already accepts the parameter).
- Produces: a clock-out that writes `overtimeMinutes: 0` and `overtimeStatus: null` when the day's overtime is under the tenant threshold.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/controllers/timeClockOutThreshold.test.js`:

```javascript
const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

describe('clock-out e o limiar de HE curta', () => {
  beforeEach(() => jest.clearAllMocks());

  // Asercao de FORMA, nao de comportamento. O mock ignora `select`, entao a
  // unica maneira de provar que o limiar chega ao clock-out e olhar a query.
  it('pede o limiar do tenant na leitura de configuracao do colaborador', async () => {
    const { getClockOutUserConfigSelect } = require('../../src/controllers/time.controller');

    expect(getClockOutUserConfigSelect()).toMatchObject({
      contractDailyMinutes: true,
      organizationAdmin: { select: { overtimeMinMinutes: true } },
    });
  });

  it('pede overtimeStatus nas marcacoes anteriores do dia', async () => {
    const { getPriorEntriesSelect } = require('../../src/controllers/time.controller');

    expect(getPriorEntriesSelect()).toMatchObject({
      clockIn: true,
      clockOut: true,
      workedMinutes: true,
      overtimeStatus: true,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/controllers/timeClockOutThreshold.test.js`
Expected: FAIL — `getClockOutUserConfigSelect is not a function`.

- [ ] **Step 3: Extract the two selects as named constants and export them**

In `backend/src/controllers/time.controller.js`, add the requires at the top of the file, beside the existing `overtime` require:

```javascript
const {
  TENANT_OVERTIME_POLICY_SELECT,
  resolveMinOvertimeMinutes,
} = require('../utils/tenantOvertimePolicy');
const { RECOGNIZED_MINUTES_SELECT } = require('../utils/recognizedMinutes');
```

Then, near the other module-level constants, define:

```javascript
// Exportados e nomeados para que um teste possa afirmar a FORMA da query. O
// bug que isso fecha foi exatamente um select incompleto aqui: o clock-out
// gravava HE de 6min com o limiar de 10min ligado, e HE pendente bloqueia a
// aprovacao do ponto.
const CLOCK_OUT_USER_CONFIG_SELECT = {
  contractDailyMinutes: true,
  hourlyRate: true,
  ...TENANT_OVERTIME_POLICY_SELECT,
};

const PRIOR_ENTRIES_SELECT = {
  clockIn: true,
  clockOut: true,
  ...RECOGNIZED_MINUTES_SELECT,
};

const getClockOutUserConfigSelect = () => CLOCK_OUT_USER_CONFIG_SELECT;
const getPriorEntriesSelect = () => PRIOR_ENTRIES_SELECT;
```

Replace the inline `select` in the clock-out `userConfig` query (the one currently listing `contractDailyMinutes` and `hourlyRate`) with `select: CLOCK_OUT_USER_CONFIG_SELECT`.

Replace the inline `select` in **both** prior-entry queries (clock-out ~line 990 and `getCurrentEntry` ~line 1508) with `select: PRIOR_ENTRIES_SELECT`.

Add both getters to `module.exports`.

- [ ] **Step 4: Pass the threshold into the clock-out calculation**

In the clock-out handler, change the `calculateIncrementalOvertimeSummary` call:

```javascript
    const overtime = calculateIncrementalOvertimeSummary({
      clockIn: openEntry.clockIn,
      clockOut: clockOutTime,
      contractDailyMinutes: userConfig?.contractDailyMinutes,
      workedMinutesBeforeEntry,
      breakMinutes: breakSummary.totalMinutes,
      // Sem isto o clock-out gravava HE abaixo do limiar e a estampava como
      // PENDING, e HE pendente BLOQUEIA a aprovacao do ponto. O painel ao vivo
      // e o recalcDay ja respeitavam o limiar, entao o numero mudava sozinho
      // entre a tela e o fechamento.
      minOvertimeMinutes: resolveMinOvertimeMinutes(userConfig),
    });
```

- [ ] **Step 5: Make `resolveWorkedMinutes` respect the authoritative zero**

Find `resolveWorkedMinutes` (~line 419) and add the guard before its duration fallback:

```javascript
  assertOvertimeStatusSelected(entry, 'time.resolveWorkedMinutes');
  if (isWorkedMinutesAuthoritative(entry)) return 0;
```

Add `isWorkedMinutesAuthoritative` and `assertOvertimeStatusSelected` to the `recognizedMinutes` require in Step 3.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && npx jest tests/controllers/timeClockOutThreshold.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 7: Prove it end to end against real Postgres**

The local stack must be up (`docker compose -f docker-compose.local.yml up -d`) and the column pushed (`cd backend && npx prisma db push`).

Run: `cd backend && node verify-overtime-local.js`
Expected: `16/16 checagens passaram.`

Then re-run the runtime reproduction that first caught this bug. With an ADMIN at `overtimeMinMinutes: 10`, a member on a 480-min contract, and an open entry 486 minutes old, calling the real `clockOut`:

Expected **after** this task:
```
APOS CLOCK-OUT  -> {"workedMinutes":486,"overtimeMinutes":0,"overtimeStatus":null}
```
Before this task it was `{"workedMinutes":486,"overtimeMinutes":6,"overtimeStatus":"PENDING"}`.

- [ ] **Step 8: Run the full green subset for regressions**

Run:
```bash
cd backend && npx jest --testPathIgnorePatterns tests/routes/routes.integration.test.js tests/controllers/admin.controller.test.js tests/controllers/finance.controller.test.js tests/controllers/user.controller.test.js tests/controllers/vacation.controller.test.js
```
Expected: all suites pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/controllers/time.controller.js backend/tests/controllers/timeClockOutThreshold.test.js
git commit -m "Apply the short-overtime threshold where overtime is persisted

Clock-out is the only path that stamps overtimeStatus, and it never received
minOvertimeMinutes. An 8h06 day on a 10-minute threshold wrote 6 minutes of
PENDING overtime, and pending overtime blocks entry approval. Its prior-entry
query also re-derived full duration for denied entries."
```

---

### Task 4: Revive the dead guard in the presence snapshot

**Files:**
- Modify: `backend/src/controllers/supervisor.controller.js` (`todayEntries` select ~line 302)
- Test: `backend/tests/controllers/supervisorPresenceRecognized.test.js`

**Interfaces:**
- Consumes: `RECOGNIZED_MINUTES_SELECT`, `assertOvertimeStatusSelected` (Task 2).
- Produces: a presence snapshot whose `closedWorkedMinutesToday` excludes denied overtime.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/controllers/supervisorPresenceRecognized.test.js`:

```javascript
const {
  RECOGNIZED_MINUTES_SELECT,
  assertOvertimeStatusSelected,
} = require('../../src/utils/recognizedMinutes');

describe('snapshot de presenca e o zero autoritativo', () => {
  it('a asercao pega o select incompleto que existia antes', () => {
    // Forma exata que a query de presenca usava: sem overtimeStatus.
    const rowFromOldSelect = { id: 'e1', userId: 'u1', workedMinutes: 0, location: null };

    expect(() =>
      assertOvertimeStatusSelected(rowFromOldSelect, 'presenca')
    ).toThrow(/overtimeStatus/);
  });

  it('o fragmento compartilhado traz o campo que faltava', () => {
    expect(RECOGNIZED_MINUTES_SELECT.overtimeStatus).toBe(true);
  });

  it('o select da presenca espalha o fragmento', () => {
    const { getTodayEntriesSelect } = require('../../src/controllers/supervisor.controller');

    expect(getTodayEntriesSelect()).toMatchObject({
      id: true,
      userId: true,
      clockIn: true,
      clockOut: true,
      workedMinutes: true,
      overtimeStatus: true,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/controllers/supervisorPresenceRecognized.test.js`
Expected: FAIL on the third test — `getTodayEntriesSelect is not a function`.

- [ ] **Step 3: Name the select, spread the fragment, export the getter**

In `backend/src/controllers/supervisor.controller.js`, extend the existing `recognizedMinutes` require:

```javascript
const {
  isWorkedMinutesAuthoritative,
  RECOGNIZED_MINUTES_SELECT,
  assertOvertimeStatusSelected,
} = require('../utils/recognizedMinutes');
```

Add near the other module constants:

```javascript
// O guard isWorkedMinutesAuthoritative logo abaixo era CODIGO MORTO: este
// select nao trazia overtimeStatus, entao a comparacao era sempre
// `undefined === 'REJECTED'` e o fallback ressuscitava a duracao cheia da
// entrada — as horas negadas voltavam para o KPI, para o status OVERTIME_ACTIVE
// e para o alerta de limite.
const TODAY_ENTRIES_SELECT = {
  id: true,
  userId: true,
  clockIn: true,
  clockOut: true,
  location: true,
  updatedAt: true,
  ...RECOGNIZED_MINUTES_SELECT,
};

const getTodayEntriesSelect = () => TODAY_ENTRIES_SELECT;
```

Replace the inline `select` of the `todayEntries` query with `select: TODAY_ENTRIES_SELECT`, and add `getTodayEntriesSelect` to `module.exports`.

- [ ] **Step 4: Add the assertion at the point of use**

In the closed-entry reducer inside `buildTeamPresenceSnapshot`, immediately before the existing `if (isWorkedMinutesAuthoritative(entry)) return 0;`:

```javascript
    assertOvertimeStatusSelected(entry, 'supervisor.presence');
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx jest tests/controllers/supervisorPresenceRecognized.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the supervisor suites for regressions**

Run: `cd backend && npx jest tests/controllers/supervisor.controller.test.js tests/controllers/supervisorBankHoursRelease.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/supervisor.controller.js backend/tests/controllers/supervisorPresenceRecognized.test.js
git commit -m "Select overtimeStatus in the presence snapshot so its guard runs

The isWorkedMinutesAuthoritative check added for denied overtime was dead
code here: the todayEntries select omitted overtimeStatus, so the comparison
was always undefined === 'REJECTED' and the fallback re-derived the full
duration of exactly the entries the guard was meant to protect."
```

---

### Task 5: Stop the alert worker from alerting on denied hours

**Files:**
- Modify: `backend/src/workers/proactiveAlertWorker.js` (`closedEntriesToday` select ~line 352, reducer ~line 360)
- Test: `backend/tests/workers/proactiveAlertRecognized.test.js`

**Interfaces:**
- Consumes: `RECOGNIZED_MINUTES_SELECT`, `isWorkedMinutesAuthoritative`, `assertOvertimeStatusSelected` (Task 2).
- Produces: `workedMinutesByUser` that excludes denied overtime.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/workers/proactiveAlertRecognized.test.js`:

```javascript
describe('scan de alerta proativo e o zero autoritativo', () => {
  it('pede overtimeStatus nas marcacoes fechadas do dia', () => {
    const { getClosedEntriesSelect } = require('../../src/workers/proactiveAlertWorker');

    expect(getClosedEntriesSelect()).toMatchObject({
      userId: true,
      clockIn: true,
      clockOut: true,
      workedMinutes: true,
      overtimeStatus: true,
    });
  });

  it('nao soma a duracao cheia de uma entrada com HE negada', () => {
    const { sumRecognizedMinutesByUser } = require('../../src/workers/proactiveAlertWorker');

    const totals = sumRecognizedMinutesByUser([
      // Entrada normal de 8h.
      {
        userId: 'u1',
        workedMinutes: 480,
        overtimeStatus: null,
        clockIn: new Date('2026-08-28T09:00:00Z'),
        clockOut: new Date('2026-08-28T17:00:00Z'),
      },
      // Turno extra de 1h com a HE negada: reconhecido 0, de proposito.
      {
        userId: 'u1',
        workedMinutes: 0,
        overtimeStatus: 'REJECTED',
        clockIn: new Date('2026-08-28T18:00:00Z'),
        clockOut: new Date('2026-08-28T19:00:00Z'),
      },
    ]);

    expect(totals.u1).toBe(480);
  });

  it('ainda cura registro legado que nunca passou pelo recalculo', () => {
    const { sumRecognizedMinutesByUser } = require('../../src/workers/proactiveAlertWorker');

    const totals = sumRecognizedMinutesByUser([
      {
        userId: 'u2',
        workedMinutes: 0,
        overtimeStatus: null,
        clockIn: new Date('2026-08-28T09:00:00Z'),
        clockOut: new Date('2026-08-28T13:00:00Z'),
      },
    ]);

    expect(totals.u2).toBe(240);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/workers/proactiveAlertRecognized.test.js`
Expected: FAIL — `getClosedEntriesSelect is not a function`.

- [ ] **Step 3: Implement the select constant and extract the reducer**

In `backend/src/workers/proactiveAlertWorker.js`, add the require:

```javascript
const {
  isWorkedMinutesAuthoritative,
  RECOGNIZED_MINUTES_SELECT,
  assertOvertimeStatusSelected,
} = require('../utils/recognizedMinutes');
```

Add the constant and the extracted reducer:

```javascript
// Sem overtimeStatus aqui o reducer abaixo tratava o 0 gravado como "nao
// calculado" e recalculava a duracao cheia, disparando o alerta de limite de
// HE por horas que o proprio gestor ja tinha negado.
const CLOSED_ENTRIES_SELECT = {
  userId: true,
  clockIn: true,
  clockOut: true,
  ...RECOGNIZED_MINUTES_SELECT,
};

const getClosedEntriesSelect = () => CLOSED_ENTRIES_SELECT;

// Extraido para poder testar sem subir a fila do BullMQ.
const sumRecognizedMinutesByUser = (entries) =>
  entries.reduce((acc, entry) => {
    assertOvertimeStatusSelected(entry, 'proactiveAlert.scan');

    const stored = Number(entry.workedMinutes);
    let value;

    if (Number.isFinite(stored) && stored > 0) {
      value = Math.floor(stored);
    } else if (isWorkedMinutesAuthoritative(entry)) {
      // 0 reconhecido de proposito: HE negada de ponta a ponta.
      value = 0;
    } else {
      value = Math.max(0, Math.floor((new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000));
    }

    acc[entry.userId] = (acc[entry.userId] || 0) + value;
    return acc;
  }, {});
```

Replace the `closedEntriesToday` inline `select` with `select: CLOSED_ENTRIES_SELECT`, replace the inline `workedMinutesByUser` reduce with `const workedMinutesByUser = sumRecognizedMinutesByUser(closedEntriesToday);`, and add both new functions to `module.exports`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest tests/workers/proactiveAlertRecognized.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/workers/proactiveAlertWorker.js backend/tests/workers/proactiveAlertRecognized.test.js
git commit -m "Stop the proactive alert from firing on denied overtime

closedEntriesToday omitted overtimeStatus and the reducer treated a stored 0
as 'not computed', re-deriving full duration. The near-limit alert reached the
manager over hours that manager had already denied."
```

---

### Task 6: Give the single reject the predicate the bulk path already has, and report the real count

**Files:**
- Modify: `backend/src/controllers/supervisor.controller.js` (`rejectOvertime` ~line 1814, `rejectEntriesBulk` response ~line 1603)
- Test: `backend/tests/controllers/supervisor.controller.test.js` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `rejectOvertime` returning 409 `OVERTIME_NOT_PENDING` when it loses a race; `overtimeRejectedCount` reflecting rows actually written.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/controllers/supervisor.controller.test.js`:

```javascript
describe('rejectOvertime e a corrida', () => {
  it('leva o predicado de estado no proprio UPDATE', async () => {
    const { getRejectOvertimeWhere } = require('../../src/controllers/supervisor.controller');

    // Convencao do projeto: a concorrencia vive no predicado do UPDATE, nao
    // numa leitura anterior. O caminho em lote logo acima ja fazia isso; o
    // caminho de uma entrada so nao fazia.
    expect(getRejectOvertimeWhere('entry-1')).toEqual({
      id: 'entry-1',
      overtimeStatus: 'PENDING',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/controllers/supervisor.controller.test.js -t "predicado de estado"`
Expected: FAIL — `getRejectOvertimeWhere is not a function`.

- [ ] **Step 3: Switch the single reject to a predicated write**

In `rejectOvertime`, add near the module constants:

```javascript
// Mesma convencao do lote: o estado esperado vai no predicado do UPDATE, para
// que o perdedor de uma corrida continue perdendo. A leitura em
// loadEntryForOvertimeDecision confere antes, mas entre a leitura e a escrita
// cabe outra decisao.
const getRejectOvertimeWhere = (id) => ({ id, overtimeStatus: 'PENDING' });
```

Replace the `prisma.timeEntry.update` inside the `$transaction` with an `updateMany` carrying the predicate, then re-read for the response payload:

```javascript
    const [rejectResult, approvalLog] = await prisma.$transaction([
      prisma.timeEntry.updateMany({
        where: getRejectOvertimeWhere(id),
        data: {
          overtimeStatus: 'REJECTED',
          workedMinutes: recognizedMinutes,
          overtimeMinutes: 0,
          overtimeMinutes50: 0,
          overtimeMinutes100: 0,
          overtimePercent: 0,
          bankHoursAccruedMinutes: 0,
        },
      }),
      prisma.approvalLog.create({ data: approvalLogData }),
    ]);

    if (rejectResult.count === 0) {
      return res.status(409).json({
        error: 'Conflict',
        code: 'OVERTIME_NOT_PENDING',
        message: 'Esta hora extra ja foi decidida por outra pessoa. Atualize a lista.',
      });
    }

    const updatedEntry = await prisma.timeEntry.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
```

Keep `approvalLogData` as the object literal that the existing `approvalLog.create` already builds. Export `getRejectOvertimeWhere`.

- [ ] **Step 4: Report the count the database actually wrote**

In `rejectEntriesBulk`, the per-row overtime updates occupy indices `0..overtimeIds.length - 1`. Replace the response's `overtimeRejectedCount: overtimeIds.length` with:

```javascript
    // Cada updateMany por linha devolve o proprio count, entao o numero real
    // esta disponivel. Reportar overtimeIds.length dizia a quem perdeu uma
    // corrida que as rejeicoes dele entraram.
    const overtimeRejectedCount = overtimeIds.length
      ? rejectResults
          .slice(0, overtimeIds.length)
          .reduce((sum, result) => sum + (result?.count ?? 0), 0)
      : 0;
```

- [ ] **Step 5: Run the suite to verify it passes**

Run: `cd backend && npx jest tests/controllers/supervisor.controller.test.js`
Expected: PASS.

- [ ] **Step 6: Re-prove the bulk path against real Postgres**

Run: `cd backend && node verify-overtime-local.js`
Expected: `16/16 checagens passaram.` (`bulk overtimeRejectedCount` is asserted as `2` there, so a regression in Step 4 fails this.)

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/supervisor.controller.js backend/tests/controllers/supervisor.controller.test.js
git commit -m "Predicate the single overtime reject, and report the real reject count

The bulk path carries overtimeStatus: 'PENDING' in its UPDATE; the
single-entry path checked on read and wrote unguarded. It also reported the
pre-read overtime count, telling the loser of a race that their rejections
landed."
```

---

### Task 7: Bring the threshold cap in line with CLT, and record who set it

A 120-minute "short overtime" cut can erase two hours of worked time per person per day. CLT art. 58 §1º tolerates roughly 5 minutes per punch and 10 minutes per day. The setting is tenant-wide and currently leaves no record of who changed it.

**Files:**
- Modify: `backend/prisma/schema.prisma` (`User` model)
- Modify: `backend/src/controllers/admin.controller.js` (`MAX_OVERTIME_MIN_MINUTES`, `updateOvertimeSettings`, `overtimeSettingsPayload`)
- Modify: `frontend/src/pages/AdminBankHoursPage.tsx` (legal note in the copy)
- Test: `backend/tests/controllers/adminOvertimeSettings.test.js`

**Interfaces:**
- Consumes: `resolveTenantOwnerId` (already in `admin.controller.js`).
- Produces: `MAX_OVERTIME_MIN_MINUTES = 10`; `User.overtimeMinMinutesUpdatedAt: DateTime?`, `User.overtimeMinMinutesUpdatedById: String?`; payload gains `updatedAt` and `updatedById`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/controllers/adminOvertimeSettings.test.js`:

```javascript
const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const { updateOvertimeSettings } = require('../../src/controllers/admin.controller');

const fakeRes = () => {
  const res = { statusCode: 200, payload: null };
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => ((res.payload = body), res);
  return res;
};

const actor = { id: 'admin-1', email: 'a@x.test', role: 'ADMIN' };

describe('limite do limiar de HE curta', () => {
  beforeEach(() => jest.clearAllMocks());

  it('recusa acima de 10 minutos (tolerancia diaria do art. 58 §1º da CLT)', async () => {
    const res = fakeRes();
    await updateOvertimeSettings({ user: actor, body: { overtimeMinMinutes: 11 } }, res);

    expect(res.statusCode).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('aceita 10 e grava quem mudou', async () => {
    mockPrisma.user.update.mockResolvedValue({
      overtimeMinMinutes: 10,
      overtimeMinMinutesUpdatedAt: new Date('2026-09-08T12:00:00Z'),
      overtimeMinMinutesUpdatedById: 'admin-1',
    });

    const res = fakeRes();
    await updateOvertimeSettings({ user: actor, body: { overtimeMinMinutes: 10 } }, res);

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          overtimeMinMinutes: 10,
          overtimeMinMinutesUpdatedById: 'admin-1',
        }),
      })
    );
    expect(res.payload.updatedById).toBe('admin-1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/controllers/adminOvertimeSettings.test.js`
Expected: FAIL — 16 is accepted, because the cap is still 120.

- [ ] **Step 3: Add the provenance columns**

In `backend/prisma/schema.prisma`, beside `overtimeMinMinutes` in `model User`:

```prisma
  // Quem mudou o limiar e quando. A configuracao e do TENANT e REDUZ tempo
  // reconhecido de todos os colaboradores: sem procedencia nao ha como
  // responder "quem ligou isso e desde quando" numa contestacao trabalhista.
  overtimeMinMinutesUpdatedAt   DateTime?
  overtimeMinMinutesUpdatedById String?
```

Run: `cd backend && npx prisma db push && npx prisma generate`
Expected: the column is added. Verify:
```bash
docker exec omnipunt-local-postgres psql -U omnipunt -d omnipunt_local -tAc "select column_name from information_schema.columns where table_schema='schema_automation' and table_name='User' and column_name ilike 'overtimeMin%';"
```
Expected: three rows.

- [ ] **Step 4: Lower the cap and persist provenance**

In `backend/src/controllers/admin.controller.js`:

```javascript
// Teto do limiar de HE curta. 10 minutos, nao 120: a CLT (art. 58 §1º) tolera
// ~5min por marcacao e ~10min no dia, e 10 e tambem a regra que o produto
// pediu ("menos de 10 minutos nao e hora extra"). Um corte de 2h transformaria
// trabalho real em "sem hora extra" para a conta inteira, o que e supressao
// salarial — e o painel nao tem como avisar disso depois do fato.
const MAX_OVERTIME_MIN_MINUTES = 10;
```

Extend the payload helper:

```javascript
const overtimeSettingsPayload = (owner) => ({
  overtimeMinMinutes: owner?.overtimeMinMinutes ?? null,
  enabled: Number(owner?.overtimeMinMinutes) > 0,
  maxMinutes: MAX_OVERTIME_MIN_MINUTES,
  updatedAt: owner?.overtimeMinMinutesUpdatedAt ?? null,
  updatedById: owner?.overtimeMinMinutesUpdatedById ?? null,
});
```

Update both handlers to select the two new columns, and in `updateOvertimeSettings` write them:

```javascript
    const updated = await prisma.user.update({
      where: { id: ownerId },
      data: {
        overtimeMinMinutes: value,
        overtimeMinMinutesUpdatedAt: new Date(),
        overtimeMinMinutesUpdatedById: req.user.id,
      },
      select: {
        overtimeMinMinutes: true,
        overtimeMinMinutesUpdatedAt: true,
        overtimeMinMinutesUpdatedById: true,
      },
    });
```

Both call sites of `overtimeSettingsPayload` now pass the row, not the scalar.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx jest tests/controllers/adminOvertimeSettings.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 6: Put the legal basis in the panel copy**

In `frontend/src/pages/AdminBankHoursPage.tsx`, under the existing description paragraph of the "Short overtime" card:

```tsx
        {/* O numero tem base legal, e quem configura precisa ver isso na tela:
            sem a nota, 15 parece um limite arbitrario do produto. */}
        <p className="mt-2 text-xs text-slate-500">
          {t(
            'Capped at 10 minutes: CLT art. 58 §1º tolerates about 5 minutes per punch and 10 minutes a day. Anything above that is worked time and must be paid.',
            'Limitado a 10 minutos: a CLT (art. 58 §1º) tolera cerca de 5 minutos por marcacao e 10 minutos no dia. Acima disso e tempo trabalhado e deve ser pago.'
          )}
        </p>
```

- [ ] **Step 7: Typecheck the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/src/controllers/admin.controller.js frontend/src/pages/AdminBankHoursPage.tsx backend/tests/controllers/adminOvertimeSettings.test.js
git commit -m "Cap the short-overtime threshold at 10 minutes and record who set it

120 minutes let one tenant-wide setting erase two hours of worked time per
person per day, with only a console.log to show who did it. CLT art. 58 §1º
tolerates ~10 min a day, which is also the product rule; the panel now says so."
```

---

### Task 8: Make the INTEGRATOR grant reachable

**Files:**
- Modify: `frontend/src/App.tsx:315`

**Interfaces:**
- Consumes: the `['ADMIN', 'INTEGRATOR']` grant on `/admin/overtime-settings`.
- Produces: `/app/admin/bank-hours` reachable by INTEGRATOR.

- [ ] **Step 1: Confirm the mismatch**

Run:
```bash
grep -n "overtime-settings" backend/src/routes/admin.routes.js
grep -n "AdminBankHoursPage" -B 3 frontend/src/App.tsx
```
Expected: the routes grant `['ADMIN', 'INTEGRATOR']`; the page allows `['ADMIN']` only.

- [ ] **Step 2: Widen the route to match the backend grant**

In `frontend/src/App.tsx`, on the `/app/admin/bank-hours` route:

```tsx
                    {/* INTEGRATOR entra porque o limiar de HE curta vive nesta
                        tela e /admin/overtime-settings concede a ele de
                        proposito. Sem isto o INTEGRATOR tinha a permissao e
                        nenhuma forma de usa-la. As outras acoes desta tela
                        seguem barradas no backend por roleCheck(['ADMIN']). */}
                    <ProtectedRoute allowedRoles={['ADMIN', 'INTEGRATOR']}>
```

- [ ] **Step 3: Verify the rest of the page degrades safely for INTEGRATOR**

Run:
```bash
grep -n "apiFetch" frontend/src/pages/AdminBankHoursPage.tsx
```
For each endpoint listed other than `/admin/overtime-settings`, confirm in `backend/src/routes/admin.routes.js` that it sits **below** `router.use(roleCheck(['ADMIN']))`. Those calls will 403 for an INTEGRATOR, and `apiFetch` toasts the failure. Confirm the page still renders its overtime card when those loads fail — the overtime state is loaded by its own `loadOvertimeSettings` in a separate `useEffect` with its own `try/catch`, so a failing `loadData` must not blank the card.

If the KPI error state hides the whole page, move the overtime card above the error return so it renders regardless.

- [ ] **Step 4: Add the nav entry for INTEGRATOR**

In `frontend/src/components/ShellLayout.tsx`, confirm the `/app/admin/bank-hours` nav item is gated on a role list; if it is ADMIN-only, add INTEGRATOR so the page is discoverable rather than only reachable by URL.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/ShellLayout.tsx frontend/src/pages/AdminBankHoursPage.tsx
git commit -m "Let INTEGRATOR reach the overtime threshold it is granted

/admin/overtime-settings deliberately grants ADMIN and INTEGRATOR, but the
only UI sat behind an ADMIN-only route, so an INTEGRATOR held a permission
with no way to exercise it."
```

---

### Task 9: Page the overtime queue instead of silently truncating it

**Files:**
- Modify: `frontend/src/pages/SupervisorOvertimePage.tsx`

**Interfaces:**
- Consumes: `GET /supervisor/entries` response `{ entries, subordinates, pagination: { total, limit, offset } }`.
- Produces: a page that shows the true pending total and loads beyond the first page.

- [ ] **Step 1: Confirm the response actually carries pagination**

Run:
```bash
grep -n "pagination" backend/src/controllers/supervisor.controller.js | head -5
grep -n "periodTotal\|pagination" frontend/src/pages/SupervisorPendingItemsPage.tsx | head -5
```
Expected: the controller returns a `pagination` object and the pendings page already reads `pagination.total`. Use the same field names.

- [ ] **Step 2: Track the server total and load more**

In `SupervisorOvertimePage.tsx`, add state beside `entries`:

```tsx
  // limit=500 sem paginacao fazia uma fila truncada parecer uma fila
  // terminada: os itens alem do teto nunca chegavam a `entries`, e os
  // contadores "Pendentes N" e "HE pendente Xh" tambem subcontavam.
  const [serverTotal, setServerTotal] = useState(0)
  const PAGE_SIZE = 200
```

Change the query to page, and accumulate:

```tsx
  const loadData = async (offset = 0) => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const query = new URLSearchParams()
      query.set('status', 'ALL')
      if (userId) query.set('userId', userId)
      query.set('startDate', startDate)
      query.set('endDate', endDate)
      query.set('limit', String(PAGE_SIZE))
      query.set('offset', String(offset))

      const response = await apiFetch<{
        entries: OvertimeEntry[]
        subordinates: Subordinate[]
        pagination?: { total?: number }
      }>(`/supervisor/entries?${query.toString()}`, { token })

      setEntries((prev) => (offset === 0 ? response.entries || [] : [...prev, ...(response.entries || [])]))
      setSubordinates(response.subordinates || [])
      setServerTotal(response.pagination?.total ?? 0)
    } catch (err) {
      if (offset === 0) setEntries([])
      setError(
        err instanceof Error ? err.message : t('Could not load overtime.', 'Erro ao carregar horas extras')
      )
    } finally {
      setLoading(false)
    }
  }
```

Every existing call becomes `loadData(0)`, including the one after a decision.

- [ ] **Step 3: Say out loud when the list is partial**

Below the counter chips:

```tsx
        {entries.length < serverTotal ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-xs text-amber-700">
              {t(
                `Showing ${entries.length} of ${serverTotal} entries in this period.`,
                `Mostrando ${entries.length} de ${serverTotal} marcacoes no periodo.`
              )}
            </p>
            <button
              type="button"
              onClick={() => loadData(entries.length)}
              disabled={loading}
              className="min-h-[44px] rounded-full border border-slate-200 bg-white px-4 text-xs font-medium text-slate-700 disabled:opacity-50 md:min-h-0 md:py-2"
            >
              {t('Load more', 'Carregar mais')}
            </button>
          </div>
        ) : null}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SupervisorOvertimePage.tsx
git commit -m "Page the overtime queue so a truncated list cannot read as finished

limit=500 with no pagination and no use of pagination.total meant a large
team's queue silently cut off, understating both the list and the pending
counters."
```

---

### Task 10: `GET /reports/weekly-timesheet` — one source of truth for the live report

Serves the weekly timesheet synchronously, with no queue in the read path, honouring the recognized-minutes rule and the tenant threshold. Both the web panel (Task 12) and the MCP tool (Task 11) consume this.

**Files:**
- Create: `backend/src/utils/weeklyTimesheet.js`
- Create: `backend/tests/utils/weeklyTimesheet.test.js`
- Modify: `backend/src/controllers/report.controller.js`
- Modify: `backend/src/routes/report.routes.js`

**Interfaces:**
- Consumes: `RECOGNIZED_MINUTES_SELECT`, `isWorkedMinutesAuthoritative`, `assertOvertimeStatusSelected` (Task 2); `resolveVisibleUserIds` (existing); `applyMinOvertimeMinutes` (existing, from `utils/overtime.js`).
- Produces:
  - `buildWeeklyTimesheet({ entries, weekStart, timeZone, contractDailyMinutes, minOvertimeMinutes })` → `{ days: Array<{ dateKey, entries, workedMinutes, overtimeMinutes, isOpen }>, totalWorkedMinutes, totalOvertimeMinutes, hasOpenEntry }`
  - `GET /reports/weekly-timesheet?weekStart=YYYY-MM-DD&userId=&timeZone=` → `{ weekStart, weekEnd, timeZone, user, days, totalWorkedMinutes, totalOvertimeMinutes, hasOpenEntry, generatedAt }`

- [ ] **Step 1: Write the failing test for the shaping function**

Create `backend/tests/utils/weeklyTimesheet.test.js`:

```javascript
const { buildWeeklyTimesheet } = require('../../src/utils/weeklyTimesheet');

const entry = (over) => ({
  id: 'e',
  clockIn: new Date('2026-08-31T12:00:00Z'),
  clockOut: new Date('2026-08-31T20:00:00Z'),
  workedMinutes: 480,
  overtimeMinutes: 0,
  overtimeStatus: null,
  breakMinutes: 0,
  ...over,
});

describe('buildWeeklyTimesheet', () => {
  const base = {
    weekStart: '2026-08-31',
    timeZone: 'UTC',
    contractDailyMinutes: 480,
    minOvertimeMinutes: null,
  };

  it('devolve sete dias, mesmo os sem marcacao', () => {
    const result = buildWeeklyTimesheet({ ...base, entries: [] });

    expect(result.days).toHaveLength(7);
    expect(result.days[0].dateKey).toBe('2026-08-31');
    expect(result.days[6].dateKey).toBe('2026-09-06');
    expect(result.totalWorkedMinutes).toBe(0);
  });

  it('soma o tempo reconhecido do dia', () => {
    const result = buildWeeklyTimesheet({ ...base, entries: [entry()] });

    expect(result.days[0].workedMinutes).toBe(480);
    expect(result.totalWorkedMinutes).toBe(480);
  });

  it('nao ressuscita os minutos de uma HE negada', () => {
    // Turno extra colado no dia: reconhecido 0 DE PROPOSITO.
    const denied = entry({
      id: 'e2',
      clockIn: new Date('2026-08-31T21:00:00Z'),
      clockOut: new Date('2026-08-31T22:00:00Z'),
      workedMinutes: 0,
      overtimeStatus: 'REJECTED',
    });

    const result = buildWeeklyTimesheet({ ...base, entries: [entry(), denied] });

    expect(result.days[0].workedMinutes).toBe(480);
    expect(result.totalWorkedMinutes).toBe(480);
  });

  it('ainda cura registro legado sem calculo', () => {
    const legacy = entry({ workedMinutes: 0, overtimeStatus: null });
    const result = buildWeeklyTimesheet({ ...base, entries: [legacy] });

    expect(result.days[0].workedMinutes).toBe(480);
  });

  it('aplica o limiar de HE curta ao total do DIA', () => {
    const short = entry({ workedMinutes: 486, overtimeMinutes: 6 });
    const result = buildWeeklyTimesheet({ ...base, minOvertimeMinutes: 10, entries: [short] });

    expect(result.days[0].overtimeMinutes).toBe(0);
    // O tempo trabalhado e fato e nao muda por causa de uma regra de HE.
    expect(result.days[0].workedMinutes).toBe(486);
  });

  it('marca o dia com marcacao aberta', () => {
    const open = entry({ clockOut: null, workedMinutes: 0 });
    const result = buildWeeklyTimesheet({ ...base, entries: [open] });

    expect(result.days[0].isOpen).toBe(true);
    expect(result.hasOpenEntry).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest tests/utils/weeklyTimesheet.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/weeklyTimesheet'`.

- [ ] **Step 3: Implement the shaping function**

Create `backend/src/utils/weeklyTimesheet.js`:

```javascript
const { applyMinOvertimeMinutes } = require('./overtime');
const {
  isWorkedMinutesAuthoritative,
  assertOvertimeStatusSelected,
} = require('./recognizedMinutes');
const { resolveTimeZone } = require('./dateFilters');

// O backend NAO tem um getDateKeyWithTimeZone — esse helper e do frontend
// (frontend/src/lib). Aqui a chave do dia sai de Intl com locale en-CA, que
// formata YYYY-MM-DD nativamente, no mesmo idioma de formatToParts que
// dateFilters.js ja usa. Sem o corte por fuso, um clock-in de 21h em
// Sao Paulo cairia no dia seguinte em UTC e o dia do timesheet sairia errado.
const dayKeyInTimeZone = (value, timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

// Aritmetica pura, sem Prisma: e o que deixa o relatorio ao vivo e a planilha
// concordarem sem que este arquivo saiba de onde vieram as linhas.
//
// A HE e recalculada por DIA a partir do total do dia, e nao somada por
// marcacao: o limiar e um conceito diario, e somar HE por marcacao deixaria
// duas fatias de 6min virarem zero cada uma.
const DAYS_IN_WEEK = 7;

const addDays = (ymd, days) => {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

const recognizedMinutes = (entry) => {
  assertOvertimeStatusSelected(entry, 'weeklyTimesheet');

  const stored = Number(entry.workedMinutes);
  if (Number.isFinite(stored) && stored > 0) return Math.floor(stored);
  if (isWorkedMinutesAuthoritative(entry)) return 0;
  if (!entry.clockIn || !entry.clockOut) return 0;

  return Math.max(0, Math.floor((new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000));
};

const buildWeeklyTimesheet = ({
  entries,
  weekStart,
  timeZone,
  contractDailyMinutes,
  minOvertimeMinutes,
}) => {
  const contract = Number(contractDailyMinutes) || 480;
  const rows = Array.isArray(entries) ? entries : [];
  const zone = resolveTimeZone(timeZone);

  const days = Array.from({ length: DAYS_IN_WEEK }, (_, index) => {
    const dateKey = addDays(weekStart, index);
    const dayEntries = rows.filter((entry) => dayKeyInTimeZone(entry.clockIn, zone) === dateKey);

    const workedMinutes = dayEntries.reduce((sum, entry) => sum + recognizedMinutes(entry), 0);

    // Do total do dia, com o limiar aplicado uma vez — nunca por marcacao.
    const overtimeMinutes = applyMinOvertimeMinutes(workedMinutes - contract, minOvertimeMinutes);

    return {
      dateKey,
      entries: dayEntries,
      workedMinutes,
      overtimeMinutes,
      isOpen: dayEntries.some((entry) => !entry.clockOut),
    };
  });

  return {
    days,
    totalWorkedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
    totalOvertimeMinutes: days.reduce((sum, day) => sum + day.overtimeMinutes, 0),
    hasOpenEntry: days.some((day) => day.isOpen),
  };
};

module.exports = { buildWeeklyTimesheet };
```

- [ ] **Step 4: Confirm `resolveTimeZone` is the right import and `en-CA` really yields YYYY-MM-DD**

Run:
```bash
grep -n "resolveTimeZone" backend/src/utils/dateFilters.js
cd backend && node -e "console.log(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date('2026-08-31T23:30:00Z')))"
```
Expected: `resolveTimeZone` is exported, and the node command prints `2026-08-31` — proving the timezone cut lands on the local day, not the UTC one.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx jest tests/utils/weeklyTimesheet.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 6: Add the endpoint**

In `backend/src/controllers/report.controller.js`:

```javascript
const { buildWeeklyTimesheet } = require('../utils/weeklyTimesheet');
const { RECOGNIZED_MINUTES_SELECT } = require('../utils/recognizedMinutes');
const {
  TENANT_OVERTIME_POLICY_SELECT,
  resolveMinOvertimeMinutes,
} = require('../utils/tenantOvertimePolicy');
const { resolveVisibleUserIds } = require('../utils/visibleUsers');

/**
 * GET /reports/weekly-timesheet
 * Timesheet da semana JA CALCULADO, sem fila: e o caminho ao vivo. A geracao
 * assincrona de planilha continua em /reports/export.
 */
const getWeeklyTimesheet = async (req, res) => {
  try {
    const { weekStart, userId, timeZone } = req.query;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || ''))) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Informe weekStart no formato YYYY-MM-DD.',
      });
    }

    // Escopo de visibilidade: listagem e filtrada em silencio, nunca com 403.
    const targetUserId = userId || req.user.id;
    if (targetUserId !== req.user.id) {
      const visibleUserIds = await resolveVisibleUserIds(req.user);
      if (!visibleUserIds.includes(targetUserId)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Voce nao tem acesso a este colaborador.',
        });
      }
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        email: true,
        contractDailyMinutes: true,
        timeZone: true,
        ...TENANT_OVERTIME_POLICY_SELECT,
      },
    });

    if (!target) {
      return res.status(404).json({ error: 'Not Found', message: 'Colaborador nao encontrado.' });
    }

    const effectiveTimeZone = timeZone || target.timeZone || 'America/Sao_Paulo';
    const weekEnd = new Date(`${weekStart}T00:00:00.000Z`);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const entries = await prisma.timeEntry.findMany({
      where: {
        userId: targetUserId,
        clockIn: { gte: new Date(`${weekStart}T00:00:00.000Z`), lt: weekEnd },
      },
      select: {
        id: true,
        clockIn: true,
        clockOut: true,
        breakMinutes: true,
        overtimeMinutes: true,
        status: true,
        ...RECOGNIZED_MINUTES_SELECT,
      },
      orderBy: { clockIn: 'asc' },
    });

    const timesheet = buildWeeklyTimesheet({
      entries,
      weekStart: String(weekStart),
      timeZone: effectiveTimeZone,
      contractDailyMinutes: target.contractDailyMinutes,
      minOvertimeMinutes: resolveMinOvertimeMinutes(target),
    });

    res.json({
      weekStart: String(weekStart),
      weekEnd: weekEnd.toISOString().slice(0, 10),
      timeZone: effectiveTimeZone,
      user: { id: target.id, name: target.name, email: target.email },
      ...timesheet,
      // Quem consome mostra "atualizado as ...", e o MCP precisa saber que a
      // resposta e um retrato de agora e nao um arquivo estavel.
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erro ao montar timesheet semanal:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao montar o timesheet da semana',
    });
  }
};
```

Add `getWeeklyTimesheet` to `module.exports`.

In `backend/src/routes/report.routes.js`, register it beside the existing report routes, keeping whatever auth middleware the neighbouring routes use:

```javascript
/** GET /reports/weekly-timesheet — timesheet da semana ao vivo, sem fila. */
router.get('/weekly-timesheet', getWeeklyTimesheet);
```

- [ ] **Step 7: Verify it responds against the local stack**

Run:
```bash
docker compose -f docker-compose.local.yml restart backend
curl -s "http://localhost:3001/api/v1/reports/weekly-timesheet?weekStart=2026-08-31" | head -c 400
```
Expected: a `401` without a token (proving the guard is inherited), not a 404 — a 404 means the route is not registered.

- [ ] **Step 8: Run the green subset**

Run:
```bash
cd backend && npx jest --testPathIgnorePatterns tests/routes/routes.integration.test.js tests/controllers/admin.controller.test.js tests/controllers/finance.controller.test.js tests/controllers/user.controller.test.js tests/controllers/vacation.controller.test.js
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/utils/weeklyTimesheet.js backend/tests/utils/weeklyTimesheet.test.js backend/src/controllers/report.controller.js backend/src/routes/report.routes.js
git commit -m "Add GET /reports/weekly-timesheet, the live report path

Computes the week synchronously with no queue, honouring the recognized-
minutes rule and the tenant overtime threshold. One endpoint so the web panel
and the MCP tool cannot disagree about the numbers."
```

---

### Task 11: Expose the live timesheet on the omni MCP connection

The catalog is declarative and the bridge is loopback REST, so the tool inherits the endpoint's guards and the visibility scope automatically.

**Files:**
- Modify: `backend/src/mcp/catalog/reports.js`

**Interfaces:**
- Consumes: `GET /reports/weekly-timesheet` (Task 10); `str`, `obj`, `date`, `ALL_ROLES`, `SCOPE_NOTE` from `./_shared`.
- Produces: MCP tool `reports_weekly_timesheet`.

- [ ] **Step 1: Read the shape of an existing read tool**

Run:
```bash
sed -n '36,68p' backend/src/mcp/catalog/reports.js
```
Note the exact keys used by `reports_get_status`: `name`, `title`, `titleEn`, `group`, `access`, `roles`, `plans`, `method`, `path`, `description`, `inputSchema`, `annotations`.

- [ ] **Step 2: Add the catalog entry**

Append to the array in `backend/src/mcp/catalog/reports.js`:

```javascript
  {
    name: 'reports_weekly_timesheet',
    title: 'Timesheet da semana',
    titleEn: 'Weekly timesheet',
    group: 'reports',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/reports/weekly-timesheet',
    description:
      'Timesheet da semana JA CALCULADO, direto na resposta: sete dias com tempo reconhecido e ' +
      'hora extra, mais os totais. E o caminho AO VIVO — nao enfileira nada e nao devolve ' +
      'jobId, ao contrario de reports_export, que gera arquivo de forma assincrona. Use este ' +
      'para responder "quanto foi trabalhado nesta semana"; use reports_export apenas quando a ' +
      'pessoa quiser o arquivo xlsx/csv. O tempo de hora extra negada NAO entra no total. ' +
      `${SCOPE_NOTE}`,
    inputSchema: obj(
      {
        weekStart: date('Segunda-feira da semana desejada, YYYY-MM-DD.'),
        userId: str('Colaborador (uuid). Ausente, devolve o da propria pessoa autenticada.'),
        timeZone: str('Fuso IANA para o corte dos dias, ex.: America/Sao_Paulo.'),
      },
      ['weekStart']
    ),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
```

- [ ] **Step 3: Verify the catalog still loads and the tool is registered**

Run:
```bash
cd backend && node -e "const c=require('./src/mcp/catalog'); const all=[].concat(...Object.values(c).filter(Array.isArray)); const t=all.find(x=>x&&x.name==='reports_weekly_timesheet'); console.log(t? 'registered: '+t.method+' '+t.path : 'NOT REGISTERED'); console.log('total tools:', all.length);"
```
Expected: `registered: GET /reports/weekly-timesheet`. If the catalog `index.js` exports a different shape, adapt the one-liner — the point is to prove the entry is picked up and the module still parses.

- [ ] **Step 4: Check the tool ceiling**

Run:
```bash
grep -rn "ceiling\|MAX_TOOLS\|limit" backend/src/mcp/server.js backend/src/mcp/catalog/index.js | head -10
```
This project has a documented tool ceiling. Confirm adding one tool does not cross it. If it does, stop and report rather than silently dropping another tool.

- [ ] **Step 5: Commit**

```bash
git add backend/src/mcp/catalog/reports.js
git commit -m "Expose the live weekly timesheet as an MCP tool

reports_export is asynchronous and needs three round-trips to answer 'how
many hours this week'. This returns the computed week in one read-only call,
inheriting the endpoint's guards through the loopback bridge."
```

---

### Task 12: Live weekly timesheet panel in the web app

**Files:**
- Modify: `frontend/src/pages/Reports.tsx`

**Interfaces:**
- Consumes: `GET /reports/weekly-timesheet` (Task 10).
- Produces: a panel showing per-day recognized minutes and overtime, refreshing while a shift is open.

- [ ] **Step 1: Add the types and the fetch**

In `frontend/src/pages/Reports.tsx`:

```tsx
type WeeklyTimesheetDay = {
  dateKey: string
  workedMinutes: number
  overtimeMinutes: number
  isOpen: boolean
}

type WeeklyTimesheet = {
  weekStart: string
  weekEnd: string
  days: WeeklyTimesheetDay[]
  totalWorkedMinutes: number
  totalOvertimeMinutes: number
  hasOpenEntry: boolean
  generatedAt: string
}
```

Add state and the loader:

```tsx
  const [timesheet, setTimesheet] = useState<WeeklyTimesheet | null>(null)

  const loadTimesheet = async () => {
    if (!token) return
    try {
      const data = await apiFetch<WeeklyTimesheet>(
        `/reports/weekly-timesheet?weekStart=${weekStartKey}&timeZone=${encodeURIComponent(viewTimeZone)}`,
        { token }
      )
      setTimesheet(data)
    } catch {
      // apiFetch ja avisou o usuario. O painel ao vivo e complementar: some
      // sem derrubar o resto da tela de relatorios.
      setTimesheet(null)
    }
  }
```

- [ ] **Step 2: Refresh only while it can change**

```tsx
  useEffect(() => {
    loadTimesheet().catch(() => undefined)
  }, [token, weekStartKey, viewTimeZone])

  // Polling SO enquanto ha marcacao aberta: numa semana fechada o numero nao
  // muda, e um intervalo rodando sem motivo custa bateria no celular.
  useEffect(() => {
    if (!timesheet?.hasOpenEntry) return

    const id = window.setInterval(() => {
      loadTimesheet().catch(() => undefined)
    }, 60000)

    return () => window.clearInterval(id)
  }, [timesheet?.hasOpenEntry, token, weekStartKey, viewTimeZone])
```

- [ ] **Step 3: Render the panel**

Place it above the existing export card, so the live numbers are what the reader sees first:

```tsx
      {timesheet ? (
        <div className="rounded-3xl border border-white/80 bg-white/80 p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">
              {t('This week, live', 'Esta semana, ao vivo')}
            </h3>
            {timesheet.hasOpenEntry ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-emerald-700">
                {t('Shift open', 'Turno aberto')}
              </span>
            ) : null}
          </div>

          <ul className="mt-4 divide-y divide-slate-100">
            {timesheet.days.map((day) => (
              <li key={day.dateKey} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-600">
                  {formatDateWithTimeZone(day.dateKey, viewTimeZone)}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium text-slate-800">
                    {`${Math.floor(day.workedMinutes / 60)}h ${String(day.workedMinutes % 60).padStart(2, '0')}m`}
                  </span>
                  {day.overtimeMinutes > 0 ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                      {t('OT', 'HE')} {`${Math.floor(day.overtimeMinutes / 60)}h ${String(day.overtimeMinutes % 60).padStart(2, '0')}m`}
                    </span>
                  ) : null}
                  {day.isOpen ? <span className="text-xs text-emerald-600">●</span> : null}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm">
            <span className="font-semibold text-slate-900">
              {t('Total', 'Total')}{' '}
              {`${Math.floor(timesheet.totalWorkedMinutes / 60)}h ${String(timesheet.totalWorkedMinutes % 60).padStart(2, '0')}m`}
            </span>
            <span className="text-xs text-slate-500">
              {t('Updated at', 'Atualizado as')}{' '}
              {new Date(timesheet.generatedAt).toLocaleTimeString(
                viewTimeZone ? undefined : undefined,
                { hour: '2-digit', minute: '2-digit' }
              )}
            </span>
          </div>

          {/* Diz que HE negada nao entra: sem isto o total parece errado para
              quem lembra de ter trabalhado aquelas horas. */}
          <p className="mt-2 text-xs text-slate-500">
            {t(
              'Denied overtime is not included in these totals.',
              'Hora extra negada nao entra nestes totais.'
            )}
          </p>
        </div>
      ) : null}
```

- [ ] **Step 4: Typecheck and build**

Run:
```bash
cd frontend && npx tsc --noEmit && npm run build
```
Expected: both succeed. `npm run build` is what CI runs, so it must pass.

- [ ] **Step 5: See it in the running app**

With the local stack up, open `http://localhost:8080/app/reports`, sign in, and confirm:
- the seven-day list renders with totals;
- clocking in makes "Turno aberto" appear and the day's minutes climb on the next refresh;
- a day whose overtime was denied does **not** count those minutes in the total.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Reports.tsx
git commit -m "Show the live weekly timesheet on the reports page

The page previously only offered a background XLSX export, so answering 'how
many hours this week' meant waiting for a job. The panel reads the new
endpoint, polls only while a shift is open, and states that denied overtime
is excluded."
```

---

## Verification Before Calling This Done

Run all of it, and paste the output rather than summarising it.

- [ ] `cd backend && npx jest --testPathIgnorePatterns tests/routes/routes.integration.test.js tests/controllers/admin.controller.test.js tests/controllers/finance.controller.test.js tests/controllers/user.controller.test.js tests/controllers/vacation.controller.test.js` — all green.
- [ ] `cd backend && npx jest` — exactly the five quarantined suites fail, no others. If a sixth fails, this plan broke it.
- [ ] `cd backend && node verify-overtime-local.js` — `16/16 checagens passaram.`
- [ ] `cd frontend && npx tsc --noEmit` — exit 0.
- [ ] `cd frontend && npm run build` — succeeds (this is CI's gate).
- [ ] `cd frontend && npx vitest run` — 56+ pass.
- [ ] `git status --porcelain` — no `.env*`, no `docker-compose.local.yml`, no `*-local.js` staged or untracked-and-stageable.
- [ ] `git check-ignore backend/tests/utils/overtimeThreshold.test.js; echo $?` — exits 1 (tests are versioned).
- [ ] Runtime check of finding 1: an 8h06 day under a 10-minute threshold writes `overtimeMinutes: 0` and `overtimeStatus: null` at clock-out.

## Self-Review Notes

- **Spec coverage.** Task 1 of the original request (overtime in its own window, normal work in a tab) shipped already and is verified working; no task here. Task 2 (denying overtime removes the time) shipped, and Tasks 3–5 close the four read paths that still resurrected the removed minutes. Task 3 (small overtime is not overtime) shipped for the live panel and recalc; Task 3 of this plan closes the persisted path. Task 4 (live report) is Tasks 10–12.
- **Type consistency.** `resolveMinOvertimeMinutes` takes a *user row* everywhere (Tasks 2, 3, 10); the arithmetic helper `applyMinOvertimeMinutes(dayOvertimeMinutes, minOvertimeMinutes)` in `utils/overtime.js` keeps its existing two-scalar signature and is not renamed. `RECOGNIZED_MINUTES_SELECT` is spread, never nested.
- **Known residual risk, deliberately not in scope.** `rejectEntriesBulk` runs `reverseEntryBankHours` sequentially *outside* the transaction, and the transaction now carries N+3 statements instead of 3. If it fails midway the bank credit is already gone while entries stay PENDING. Widening that window is pre-existing and fixing it means restructuring bank-hours reversal into the transaction — a separate plan, not a step smuggled into this one.
- **Not attempted.** Brazilian compliance (AFD, AFDT/ACJEF, REP-C, LGPD) stays unstarted; Task 7 only stops this feature from making a CLT problem worse.
