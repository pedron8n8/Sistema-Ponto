# Buffer de hora extra e nota opcional na negacao — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada empresa uma tolerancia (buffer) de minutos abaixo da qual o dia nao gera hora extra, gravada no proprio registro para o passado nao se mexer, e tornar opcional o comentario ao negar hora extra (individual e em lote).

**Architecture:** O buffer vive em `AppSetting` sob a chave `overtimeBuffer:<organizationAdminId>` (mesmo mecanismo da geofence, sem tabela nova e sem cache de processo). Um modulo novo `utils/overtimeBuffer.js` le e normaliza esse valor; `utils/overtime.js` continua puro e passa a aceitar `bufferMinutes` como parametro. O valor usado e gravado em `TimeEntry.overtimeBufferMinutes` no fechamento do registro, e o recalculo do dia le o snapshot do registro — nunca a configuracao atual. A parte de negacao e independente: remove uma validacao de 5 caracteres do caminho de hora extra e adiciona um endpoint de negacao de HE em lote.

**Tech Stack:** Node 20, Express 5, Prisma 7 (`db push`, nao `migrate`), Jest (backend), React + Vite + TypeScript + Tailwind (frontend), Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-09-11-overtime-buffer-and-optional-reject-note-design.md`

## Global Constraints

- **Semantica do buffer: gatilho, nao desconto.** Dentro do buffer, zero. Acima, o excedente inteiro. Com buffer 10, 25 min extras geram 25 min de hora extra, nao 15.
- **O buffer se aplica ao total acumulado do dia**, nunca ao registro isolado.
- **Escopo:** por empresa (`organizationAdminId`). Chave `overtimeBuffer:<organizationAdminId>`, valor `{ "bufferMinutes": 10 }`. Ausente = 0.
- **Default sem configuracao: 0 minutos.** O deploy nao pode alterar folha de pagamento de nenhuma empresa sem alguem pedir.
- **Limites:** `bufferMinutes` inteiro de 0 a 120. Na LEITURA normaliza em silencio (nunca lanca, falha vira 0). Na ESCRITA fora da faixa devolve 400 em vez de truncar.
- **Sem gate de plano** nestes endpoints. Diferente de `location-settings`, que exige GROWTH/PRO.
- **Snapshot:** o recalculo usa `entry.overtimeBufferMinutes` ou 0 na ausencia, **nunca** a configuracao atual. Registro anterior a esta feature tem `null` e vale 0.
- **Nota na negacao:** opcional para hora extra; **obrigatoria (>= 5 caracteres) para a rejeicao da marcacao**, inclusive em lote. `rejectEntriesBulk` nao muda.
- **Sem tool MCP para o lote novo.** A exposicao MCP ja opera perto do teto de tools.
- **Banco:** a coluna nova exige `prisma db push` (Task 12), e o `DATABASE_URL` de `backend/.env` aponta para **producao** por tunel SSH. Nenhuma tarefa antes da 12 toca o banco; os testes usam o mock de Prisma.
- **Mensagens de commit:** estilo do repositorio — frase imperativa em portugues sem acentos, sem prefixo `feat:`/`fix:`. Toda mensagem termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Comandos:** rode os comandos de backend a partir de `backend/` e os de frontend a partir de `frontend/`. No PowerShell do Windows `&&` nao existe; use a ferramenta Bash ou comandos separados.
- **i18n do frontend:** copy fica inline via `t('EN', 'PT')`, nao em arquivo de locale. O PT do repositorio e escrito sem acentos.

---

## File Structure

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `backend/src/utils/overtimeBuffer.js` (novo) | Resolver a empresa do usuario e ler/normalizar o buffer do `AppSetting`. Unico lugar que conhece a chave. | 1 |
| `backend/tests/mocks/prisma.mock.js` | Ganha o model `appSetting` (nenhum teste mockava essa tabela ainda). | 1 |
| `backend/tests/utils/overtimeBuffer.test.js` (novo) | Resolucao da empresa, ausencia de linha, normalizacao. | 1 |
| `backend/src/utils/overtime.js` | Aritmetica pura; passa a aceitar `bufferMinutes`. Continua sem importar Prisma. | 2 |
| `backend/tests/utils/overtime.test.js` (novo) | Tabela de bordas do buffer + o que ja existia e nunca teve teste (split 50/100, feriado, contrato). | 2 |
| `backend/prisma/schema.prisma` | Coluna `TimeEntry.overtimeBufferMinutes Int?`. | 3 |
| `backend/src/utils/recalcDay.js` | Le o snapshot do registro no recalculo. | 3 |
| `backend/tests/utils/recalcDay.test.js` | Ganha os casos de snapshot. | 3 |
| `backend/src/controllers/time.controller.js` | Clock-out grava o snapshot; painel ao vivo usa o buffer vigente. | 4 |
| `backend/tests/controllers/timeClockOutOvertimeBuffer.test.js` (novo) | Fechamento com e sem buffer. | 4 |
| `backend/src/controllers/hr.controller.js` | Registro criado pelo RH nasce com snapshot; registro aberto fechado pelo RH tambem. | 5 |
| `backend/tests/controllers/hrEntryOvertimeBuffer.test.js` (novo) | Snapshot na criacao e no primeiro fechamento; edicao de registro antigo nao re-carimba. | 5 |
| `backend/src/controllers/admin.controller.js` | `getOvertimeSettings` / `updateOvertimeSettings`. | 6 |
| `backend/src/routes/admin.routes.js` | `GET`/`PATCH /admin/overtime-settings`, sem `requirePlan`. | 6 |
| `backend/tests/controllers/adminOvertimeSettings.test.js` (novo) | Leitura, escrita, faixa 0..120, escopo por empresa. Arquivo novo de proposito: `admin.controller.test.js` esta em quarentena no CI. | 6 |
| `backend/src/controllers/supervisor.controller.js` | Nota opcional em `rejectOvertime`; `rejectOvertimeBulk` novo. | 7, 8 |
| `backend/src/routes/supervisor.routes.js` | Comentario da rota corrigido; `POST /supervisor/overtime/bulk/reject`. | 7, 8 |
| `backend/src/mcp/catalog/approvals.js` | `comment` sai de `required` em `approvals_reject_overtime`. | 7 |
| `backend/tests/controllers/supervisor.controller.test.js` | Nota opcional na HE, obrigatoria na marcacao, e o lote novo. | 7, 8 |
| `frontend/src/pages/AdminDashboard.tsx` | Campo numerico do buffer, com a explicacao "gatilho, nao desconto". | 9 |
| `frontend/src/pages/SupervisorDashboard.tsx` | Sai a validacao de 5 caracteres da HE e o aviso correspondente. | 10 |
| `frontend/src/pages/SupervisorPendingItemsPage.tsx` | Sai a validacao de 5 caracteres da HE; entra o botao de negar HE em lote. | 10, 11 |
| `frontend/src/pages/AdminPendingApprovalsPage.tsx` | Sai a validacao de 5 caracteres da HE. | 10 |

### Duas decisoes que a spec deixou em aberto

1. **`hr.controller.js:347` (edicao pelo RH).** A spec lista os dois `recalculateUserDay` do HR como pontos onde o buffer vigente e gravado. Gravar na EDICAO reintroduziria exatamente o problema que o snapshot existe para evitar: um ADMIN sobe o buffer, o RH corrige um dia antigo e a hora extra ja aprovada muda. Decisao deste plano: na edicao, o snapshot so e gravado quando o registro estava ABERTO e esta sendo fechado agora (`entry.clockOut === null && nextClockOut`) — o espelho exato do clock-out. Registro ja fechado mantem o que tem, e registro anterior a feature continua em `null` (= 0), como a propria spec exige na tabela da secao 3.
2. **SUPERADMIN no endpoint de escrita.** `roleCheck` deixa SUPERADMIN passar por qualquer rota `/admin`, e ele nao pertence a nenhuma empresa: `resolveOrganizationAdminId` devolveria o id dele proprio e a configuracao cairia numa chave que ninguem le. `updateOvertimeSettings` devolve 400 nesse caso, em vez de gravar em silencio. Adicao ao que a spec descreve, registrada aqui de proposito.

### Observacao fora de escopo (nao corrigir neste plano)

`handleSaveLocationSettings` (`frontend/src/pages/AdminDashboard.tsx:971`) nao passa `skipIdempotency`. Salvar o mesmo valor duas vezes no mesmo dia devolve 202 sem corpo util e a tela quebra ao ler `response.locationSettings`. Bug pre-existente de outro caminho. As chamadas NOVAS deste plano (Tasks 9 e 11) passam `skipIdempotency: true` justamente por isso.

---

### Task 1: Modulo de leitura do buffer por empresa

**Files:**
- Create: `backend/src/utils/overtimeBuffer.js`
- Modify: `backend/tests/mocks/prisma.mock.js` (adiciona o model `appSetting`)
- Test: `backend/tests/utils/overtimeBuffer.test.js` (novo)

**Interfaces:**
- Consumes: `prisma` de `../config/database`; o model `AppSetting` (`key` String @id, `value` Json), que ja existe em `backend/prisma/schema.prisma:257`.
- Produces:
  - `OVERTIME_BUFFER_KEY_PREFIX: string` = `'overtimeBuffer:'`
  - `MAX_OVERTIME_BUFFER_MINUTES: number` = `120`
  - `resolveOrganizationAdminId(user: { id?: string, organizationAdminId?: string|null } | null): string | null`
  - `normalizeBufferMinutes(value: unknown): number` — 0..120, sincrona
  - `buildOvertimeBufferKey(organizationAdminId: string): string`
  - `getOvertimeBufferMinutes(organizationAdminId: string | null): Promise<number>` — nunca lanca

- [ ] **Step 1: Escreva o teste que falha**

Crie `backend/tests/utils/overtimeBuffer.test.js`:

```js
// O buffer decide folha de pagamento, entao a LEITURA nunca pode falhar: sem
// linha, com lixo gravado ou com o banco fora do ar, o valor e 0 — que e o
// comportamento que o sistema tinha antes desta feature.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const {
  OVERTIME_BUFFER_KEY_PREFIX,
  MAX_OVERTIME_BUFFER_MINUTES,
  resolveOrganizationAdminId,
  normalizeBufferMinutes,
  getOvertimeBufferMinutes,
} = require('../../src/utils/overtimeBuffer');

describe('resolveOrganizationAdminId', () => {
  it('usa o organizationAdminId do colaborador', () => {
    expect(resolveOrganizationAdminId({ id: 'member-1', organizationAdminId: 'admin-1' })).toBe('admin-1');
  });

  it('cai no proprio id quando nao ha organizationAdminId (o ADMIN e a empresa)', () => {
    expect(resolveOrganizationAdminId({ id: 'admin-1', organizationAdminId: null })).toBe('admin-1');
  });

  it('devolve null quando nao da para resolver', () => {
    expect(resolveOrganizationAdminId(null)).toBeNull();
    expect(resolveOrganizationAdminId({})).toBeNull();
  });
});

describe('normalizeBufferMinutes', () => {
  it('trunca para inteiro', () => {
    expect(normalizeBufferMinutes(10.9)).toBe(10);
  });

  it('limita no teto de 120 minutos', () => {
    expect(normalizeBufferMinutes(500)).toBe(MAX_OVERTIME_BUFFER_MINUTES);
    expect(MAX_OVERTIME_BUFFER_MINUTES).toBe(120);
  });

  it('trata negativo, NaN, string e ausencia como 0', () => {
    expect(normalizeBufferMinutes(-5)).toBe(0);
    expect(normalizeBufferMinutes(NaN)).toBe(0);
    expect(normalizeBufferMinutes('10')).toBe(0);
    expect(normalizeBufferMinutes(undefined)).toBe(0);
    expect(normalizeBufferMinutes(null)).toBe(0);
  });
});

describe('getOvertimeBufferMinutes', () => {
  it('le a linha da empresa pela chave com prefixo', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 10 } });

    await expect(getOvertimeBufferMinutes('admin-1')).resolves.toBe(10);
    expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
      where: { key: `${OVERTIME_BUFFER_KEY_PREFIX}admin-1` },
    });
  });

  it('devolve 0 quando a empresa nunca configurou', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    await expect(getOvertimeBufferMinutes('admin-1')).resolves.toBe(0);
  });

  it('devolve 0 sem consultar o banco quando nao ha empresa', async () => {
    await expect(getOvertimeBufferMinutes(null)).resolves.toBe(0);
    expect(mockPrisma.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it('devolve 0 quando o valor gravado e lixo', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 'dez' } });

    await expect(getOvertimeBufferMinutes('admin-1')).resolves.toBe(0);
  });

  // Erro de configuracao nao pode impedir alguem de bater ponto.
  it('devolve 0 quando a leitura estoura, sem propagar', async () => {
    mockPrisma.appSetting.findUnique.mockRejectedValue(new Error('connection refused'));

    await expect(getOvertimeBufferMinutes('admin-1')).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run (a partir de `backend/`): `npx jest tests/utils/overtimeBuffer.test.js`
Expected: FAIL — `Cannot find module '../../src/utils/overtimeBuffer'`.

- [ ] **Step 3: Adicione o model `appSetting` ao mock de Prisma**

Em `backend/tests/mocks/prisma.mock.js`, logo depois do bloco `approvalLog` e antes de `bankHoursEntry`, insira:

```js
  appSetting: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  },
```

- [ ] **Step 4: Escreva o modulo**

Crie `backend/src/utils/overtimeBuffer.js`:

```js
const { prisma } = require('../config/database');

// A chave carrega o escopo: nao ha tabela nova, e o mesmo mecanismo da geofence
// (utils/geofence.js) com um sufixo por empresa. Ao contrario da geofence, NAO
// ha cache em singleton de processo: aquele padrao assume um valor global e
// aqui o valor e por tenant.
const OVERTIME_BUFFER_KEY_PREFIX = 'overtimeBuffer:';

// Acima disto deixa de ser tolerancia de relogio e vira jornada nao remunerada.
const MAX_OVERTIME_BUFFER_MINUTES = 120;

/** A empresa de um usuario: um ADMIN e a propria empresa, e seus colaboradores apontam para ele. */
const resolveOrganizationAdminId = (user) => {
  if (!user) return null;
  return user.organizationAdminId || user.id || null;
};

/**
 * Inteiro truncado, limitado a 0..120. Nao numero, negativo ou NaN viram 0.
 * Usado na LEITURA, onde o dado ja esta gravado e o calculo nao pode falhar.
 * A ESCRITA (admin.controller) recusa fora da faixa em vez de truncar.
 */
const normalizeBufferMinutes = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_OVERTIME_BUFFER_MINUTES, Math.floor(value));
};

const buildOvertimeBufferKey = (organizationAdminId) =>
  `${OVERTIME_BUFFER_KEY_PREFIX}${organizationAdminId}`;

/**
 * Buffer vigente da empresa, em minutos. Nunca lanca: ausencia, valor invalido
 * ou falha de leitura viram 0, porque um erro de configuracao nao pode impedir
 * alguem de bater ponto.
 */
const getOvertimeBufferMinutes = async (organizationAdminId) => {
  if (!organizationAdminId) return 0;

  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: buildOvertimeBufferKey(organizationAdminId) },
    });

    return normalizeBufferMinutes(row?.value?.bufferMinutes);
  } catch (error) {
    console.warn('[overtimeBuffer] Nao foi possivel ler o buffer da empresa:', error.message);
    return 0;
  }
};

module.exports = {
  OVERTIME_BUFFER_KEY_PREFIX,
  MAX_OVERTIME_BUFFER_MINUTES,
  resolveOrganizationAdminId,
  normalizeBufferMinutes,
  buildOvertimeBufferKey,
  getOvertimeBufferMinutes,
};
```

- [ ] **Step 5: Rode e confirme que passa**

Run (a partir de `backend/`): `npx jest tests/utils/overtimeBuffer.test.js`
Expected: PASS — 11 testes.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/overtimeBuffer.js backend/tests/utils/overtimeBuffer.test.js backend/tests/mocks/prisma.mock.js
git commit -m "Ler o buffer de hora extra de cada empresa sem nunca poder falhar" -m "A leitura roda no caminho do ponto e decide folha de pagamento: ausencia de
linha, valor invalido e banco fora do ar viram 0, que e o comportamento que o
sistema ja tinha. A chave carrega o escopo da empresa, como a geofence, mas sem
o cache em singleton — aquele padrao assume um valor global.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Buffer na aritmetica de hora extra

**Files:**
- Modify: `backend/src/utils/overtime.js:89-179`
- Test: `backend/tests/utils/overtime.test.js` (novo)

**Interfaces:**
- Consumes: nada das tarefas anteriores. `overtime.js` continua **puro** — nao importa Prisma nem `overtimeBuffer.js`; quem le a configuracao passa o numero por parametro.
- Produces:
  - `calculateIncrementalOvertimeSummary({ clockIn, clockOut, contractDailyMinutes, workedMinutesBeforeEntry, breakMinutes?, bufferMinutes? })` — `bufferMinutes` default `0`, todo chamador existente mantem o comportamento atual.
  - `calculateCurrentDailyProgress({ clockIn, now, contractDailyMinutes, workedMinutesBeforeEntry, breakMinutes?, bufferMinutes? })` — idem.

- [ ] **Step 1: Escreva o teste que falha**

Crie `backend/tests/utils/overtime.test.js`:

```js
// Este modulo decide folha de pagamento e nunca teve teste unitario — nem do
// split 50/100, nem de feriado, nem do contrato default. Como ele passa a ter
// mais um parametro, o arquivo cobre o que ja existia junto com o buffer.
//
// A regra do buffer e GATILHO, NAO DESCONTO: dentro do buffer, zero; acima, o
// excedente inteiro. Com buffer 10, 25 minutos extras valem 25, nao 15.

const {
  calculateIncrementalOvertimeSummary,
  calculateCurrentDailyProgress,
  resolveContractDailyMinutes,
} = require('../../src/utils/overtime');

const MINUTE = 60 * 1000;
// Uma quarta-feira: dia util, para o split cair em 50%.
const WEEKDAY_START = new Date('2026-08-26T08:00:00.000Z');

const entryOf = (workedMinutes, over = {}) => ({
  clockIn: WEEKDAY_START,
  clockOut: new Date(WEEKDAY_START.getTime() + workedMinutes * MINUTE),
  contractDailyMinutes: 480,
  workedMinutesBeforeEntry: 0,
  ...over,
});

describe('calculateIncrementalOvertimeSummary com buffer', () => {
  // Tabela normativa da spec: contrato 480, buffer 10.
  it.each([
    ['exatamente o contrato', 480, 0],
    ['exatamente no buffer', 490, 0],
    ['um minuto acima do buffer', 491, 11],
    ['bem acima do buffer', 505, 25],
  ])('%s: %i minutos trabalhados geram %i de hora extra', (_label, worked, expected) => {
    const result = calculateIncrementalOvertimeSummary(entryOf(worked, { bufferMinutes: 10 }));

    expect(result.overtimeMinutes).toBe(expected);
  });

  // Por que ao total do dia e nao por registro: dois registros de 6 minutos
  // acima passariam CADA UM por baixo de uma tolerancia de 10, e o dia fecharia
  // com 12 minutos de hora extra que nunca foram registrados.
  it('aplica o buffer ao total acumulado do dia, nao ao registro isolado', () => {
    const first = calculateIncrementalOvertimeSummary(entryOf(486, { bufferMinutes: 10 }));
    expect(first.overtimeMinutes).toBe(0);

    const second = calculateIncrementalOvertimeSummary(
      entryOf(6, { bufferMinutes: 10, workedMinutesBeforeEntry: 486 })
    );
    expect(second.overtimeMinutes).toBe(12);
  });

  it('com buffer 0 reproduz exatamente o comportamento de hoje', () => {
    const semParametro = calculateIncrementalOvertimeSummary(entryOf(481));
    const comZero = calculateIncrementalOvertimeSummary(entryOf(481, { bufferMinutes: 0 }));

    expect(semParametro.overtimeMinutes).toBe(1);
    expect(comZero.overtimeMinutes).toBe(1);
  });

  it('ignora buffer invalido em vez de quebrar o calculo', () => {
    expect(calculateIncrementalOvertimeSummary(entryOf(505, { bufferMinutes: -10 })).overtimeMinutes).toBe(25);
    expect(calculateIncrementalOvertimeSummary(entryOf(505, { bufferMinutes: NaN })).overtimeMinutes).toBe(25);
  });

  it('zera overtimePercent quando o buffer engole a hora extra', () => {
    const result = calculateIncrementalOvertimeSummary(entryOf(490, { bufferMinutes: 10 }));

    expect(result.overtimeMinutes).toBe(0);
    expect(result.overtimeMinutes50).toBe(0);
    expect(result.overtimeMinutes100).toBe(0);
    // Sem hora extra, o clock-out grava overtimeStatus null e o gate
    // OVERTIME_PENDING nao dispara. Os guards de aprovacao somem sozinhos.
    expect(result.overtimePercent).toBe(0);
  });
});

describe('calculateIncrementalOvertimeSummary: split e dia especial', () => {
  it('manda a hora extra de dia util para 50%', () => {
    const result = calculateIncrementalOvertimeSummary(entryOf(540));

    expect(result.dayType).toBe('WEEKDAY');
    expect(result.overtimeMinutes50).toBe(60);
    expect(result.overtimeMinutes100).toBe(0);
    expect(result.overtimePercent).toBe(50);
  });

  it('manda a hora extra de domingo para 100%', () => {
    // 2026-08-30 e domingo no fuso local do processo.
    const sunday = new Date('2026-08-30T12:00:00.000Z');
    const result = calculateIncrementalOvertimeSummary(
      entryOf(540, { clockIn: sunday, clockOut: new Date(sunday.getTime() + 540 * MINUTE) })
    );

    expect(result.dayType).toBe('SUNDAY');
    expect(result.overtimeMinutes100).toBe(60);
    expect(result.overtimeMinutes50).toBe(0);
    expect(result.overtimePercent).toBe(100);
  });

  // O split atua sobre o valor JA filtrado pelo buffer.
  it('nao gera split quando o buffer ja zerou a hora extra num domingo', () => {
    const sunday = new Date('2026-08-30T12:00:00.000Z');
    const result = calculateIncrementalOvertimeSummary(
      entryOf(485, {
        clockIn: sunday,
        clockOut: new Date(sunday.getTime() + 485 * MINUTE),
        bufferMinutes: 10,
      })
    );

    expect(result.overtimeMinutes).toBe(0);
    expect(result.overtimeMinutes100).toBe(0);
    expect(result.overtimePercent).toBe(0);
  });

  it('trata feriado configurado como dia de 100%', () => {
    const original = process.env.OVERTIME_HOLIDAYS;
    const holiday = new Date('2026-09-07T12:00:00.000Z');
    const year = holiday.getFullYear();
    const month = String(holiday.getMonth() + 1).padStart(2, '0');
    const day = String(holiday.getDate()).padStart(2, '0');
    process.env.OVERTIME_HOLIDAYS = `${year}-${month}-${day}`;

    try {
      const result = calculateIncrementalOvertimeSummary(
        entryOf(540, { clockIn: holiday, clockOut: new Date(holiday.getTime() + 540 * MINUTE) })
      );

      expect(result.dayType).toBe('HOLIDAY');
      expect(result.overtimeMinutes100).toBe(60);
    } finally {
      process.env.OVERTIME_HOLIDAYS = original;
    }
  });

  it('desconta o intervalo antes de comparar com o contrato', () => {
    const result = calculateIncrementalOvertimeSummary(entryOf(540, { breakMinutes: 60 }));

    expect(result.workedMinutes).toBe(480);
    expect(result.overtimeMinutes).toBe(0);
  });

  it('devolve tudo zerado quando a saida nao e posterior a entrada', () => {
    const result = calculateIncrementalOvertimeSummary(
      entryOf(0, { clockOut: WEEKDAY_START, workedMinutesBeforeEntry: 100 })
    );

    expect(result.workedMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.workedMinutesAfterEntry).toBe(100);
  });
});

describe('resolveContractDailyMinutes', () => {
  it('usa o contrato do colaborador quando ele e valido', () => {
    expect(resolveContractDailyMinutes(360)).toBe(360);
    expect(resolveContractDailyMinutes(360.9)).toBe(360);
  });

  it('cai no default de 480 quando ausente, zero ou invalido', () => {
    expect(resolveContractDailyMinutes(undefined)).toBe(480);
    expect(resolveContractDailyMinutes(null)).toBe(480);
    expect(resolveContractDailyMinutes(0)).toBe(480);
    expect(resolveContractDailyMinutes(-30)).toBe(480);
    expect(resolveContractDailyMinutes('abc')).toBe(480);
  });
});

describe('calculateCurrentDailyProgress com buffer', () => {
  // Sem o buffer aqui, a tela mostra hora extra acumulando durante o dia e o
  // fechamento entrega zero.
  it('nao mostra hora extra enquanto o dia esta dentro do buffer', () => {
    const result = calculateCurrentDailyProgress({
      clockIn: WEEKDAY_START,
      now: new Date(WEEKDAY_START.getTime() + 488 * MINUTE),
      contractDailyMinutes: 480,
      workedMinutesBeforeEntry: 0,
      bufferMinutes: 10,
    });

    expect(result.totalWorkedMinutes).toBe(488);
    expect(result.hasReachedDailyTarget).toBe(true);
    expect(result.overtimeMinutesSoFar).toBe(0);
  });

  it('mostra o excedente inteiro assim que o dia passa do buffer', () => {
    const result = calculateCurrentDailyProgress({
      clockIn: WEEKDAY_START,
      now: new Date(WEEKDAY_START.getTime() + 505 * MINUTE),
      contractDailyMinutes: 480,
      workedMinutesBeforeEntry: 0,
      bufferMinutes: 10,
    });

    expect(result.overtimeMinutesSoFar).toBe(25);
  });

  it('com buffer 0 reproduz o comportamento de hoje', () => {
    const result = calculateCurrentDailyProgress({
      clockIn: WEEKDAY_START,
      now: new Date(WEEKDAY_START.getTime() + 481 * MINUTE),
      contractDailyMinutes: 480,
      workedMinutesBeforeEntry: 0,
    });

    expect(result.overtimeMinutesSoFar).toBe(1);
  });

  // O buffer decide hora extra, nao jornada: a hora em que o contrato fechou
  // continua sendo a mesma.
  it('nao mexe em reachedDailyTargetAt', () => {
    const result = calculateCurrentDailyProgress({
      clockIn: WEEKDAY_START,
      now: new Date(WEEKDAY_START.getTime() + 488 * MINUTE),
      contractDailyMinutes: 480,
      workedMinutesBeforeEntry: 0,
      bufferMinutes: 10,
    });

    expect(result.reachedDailyTargetAt.getTime()).toBe(WEEKDAY_START.getTime() + 480 * MINUTE);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run (a partir de `backend/`): `npx jest tests/utils/overtime.test.js`
Expected: FAIL — os casos com `bufferMinutes` devolvem o excedente cru (`490` vira `10` em vez de `0`, `488` na tela vira `8` em vez de `0`). Os casos de split, feriado e contrato ja passam: sao o comportamento existente, capturado agora.

- [ ] **Step 3: Aplique o buffer no modulo**

Em `backend/src/utils/overtime.js`, depois de `resolveBreakMinutes` (linha 40), adicione os dois helpers:

```js
// O buffer chega como parametro e nao lido de configuracao: este modulo e puro
// e nao conhece Prisma. Quem le a empresa e utils/overtimeBuffer.js.
const resolveBufferMinutes = (bufferMinutes) => {
  const parsed = Number(bufferMinutes);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
};

// GATILHO, NAO DESCONTO: dentro do buffer, zero; acima, o excedente inteiro.
// Com buffer 10, 25 minutos extras valem 25, nao 15.
const applyOvertimeBuffer = (overtimeMinutes, bufferMinutes) =>
  overtimeMinutes <= bufferMinutes ? 0 : overtimeMinutes;
```

Em `calculateIncrementalOvertimeSummary`, aceite o parametro novo na desestruturacao (linha 89-95):

```js
const calculateIncrementalOvertimeSummary = ({
  clockIn,
  clockOut,
  contractDailyMinutes,
  workedMinutesBeforeEntry,
  breakMinutes = 0,
  bufferMinutes = 0,
}) => {
```

e troque o trio de linhas 121-123 por:

```js
  // O buffer se aplica ao TOTAL acumulado do dia, nunca ao registro isolado:
  // por registro, dois pontos de 6 minutos passariam cada um por baixo de uma
  // tolerancia de 10 e o dia somaria 12 minutos de hora extra invisivel.
  const buffer = resolveBufferMinutes(bufferMinutes);
  const overtimeBefore = applyOvertimeBuffer(
    Math.max(0, minutesBefore - effectiveContractMinutes),
    buffer
  );
  const overtimeAfter = applyOvertimeBuffer(
    Math.max(0, totalAfterEntry - effectiveContractMinutes),
    buffer
  );
  const overtimeMinutes = Math.max(0, overtimeAfter - overtimeBefore);
```

Em `calculateCurrentDailyProgress`, aceite o parametro (linha 139-145):

```js
const calculateCurrentDailyProgress = ({
  clockIn,
  now,
  contractDailyMinutes,
  workedMinutesBeforeEntry,
  breakMinutes = 0,
  bufferMinutes = 0,
}) => {
```

e troque a linha 157 por:

```js
  // Mesmo buffer do fechamento: sem isto a tela mostra hora extra acumulando
  // durante o dia e o clock-out entrega zero. hasReachedDailyTarget e
  // reachedDailyTargetAt nao mudam — sao jornada, nao hora extra.
  const overtimeMinutesSoFar = applyOvertimeBuffer(
    Math.max(0, totalWorkedMinutes - effectiveContractMinutes),
    resolveBufferMinutes(bufferMinutes)
  );
```

- [ ] **Step 4: Rode e confirme que passa**

Run (a partir de `backend/`): `npx jest tests/utils/overtime.test.js`
Expected: PASS — 20 testes.

- [ ] **Step 5: Confirme que nenhum chamador existente mudou de comportamento**

Run (a partir de `backend/`): `npx jest tests/utils tests/controllers`
Expected: PASS nas suites verdes (as quatro suites de controller em quarentena no CI — `admin`, `finance`, `user`, `vacation` — podem continuar vermelhas; compare com o estado ANTES da sua mudanca se alguma falhar).

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/overtime.js backend/tests/utils/overtime.test.js
git commit -m "Dar a hora extra uma tolerancia que e gatilho, nao desconto" -m "Dentro da tolerancia o dia nao gera hora extra; acima dela o excedente vale
inteiro. Aplicada ao total do dia e nao ao registro: por registro, dois pontos
de 6 minutos passariam cada um por baixo de uma tolerancia de 10 e o dia somaria
12 minutos de hora extra invisivel.

O modulo continua puro — recebe os minutos por parametro, com default 0, e todo
chamador existente mantem o comportamento atual. O arquivo de teste tambem cobre
o split 50/100, feriado e contrato default, que nunca tiveram teste.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Snapshot no registro e recalculo que ignora a configuracao atual

**Files:**
- Modify: `backend/prisma/schema.prisma:157-186` (model `TimeEntry`)
- Modify: `backend/src/utils/recalcDay.js:65-88`
- Test: `backend/tests/utils/recalcDay.test.js` (arquivo existente, casos novos)

**Interfaces:**
- Consumes: `calculateIncrementalOvertimeSummary({ ..., bufferMinutes })` da Task 2.
- Produces: a coluna `TimeEntry.overtimeBufferMinutes: number | null`, lida por Tasks 4 e 5 e gravada por elas.

**Nada aqui toca o banco de dados.** `prisma db push` e a Task 12, com o dono do projeto presente. `npx prisma generate` e local e seguro.

- [ ] **Step 1: Escreva o teste que falha**

Em `backend/tests/utils/recalcDay.test.js`, dentro do `describe('recalculateUserDay', ...)`, depois do ultimo `it(...)` existente, adicione:

```js
  // O snapshot e o que torna o numero auditavel. Sem ele, um ADMIN que sobe o
  // buffer de 10 para 20 faz a proxima correcao do RH num dia antigo zerar uma
  // hora extra JA APROVADA e reverter o credito de banco de horas, sem erro em
  // tela nenhum: recalculateUserDay reprocessa o dia inteiro e re-credita.
  describe('buffer de hora extra', () => {
    // 8h20 de turno numa jornada de 8h => 20 minutos acima do contrato.
    const shortOvertimeShift = (over = {}) => ({
      id: 'entry-1',
      userId: 'user-123',
      clockIn: new Date(DAY.getTime() - 500 * 60 * 1000),
      clockOut: new Date(DAY.getTime()),
      breakMinutes: 0,
      status: 'PENDING',
      overtimeStatus: 'PENDING',
      location: null,
      overtimeBufferMinutes: null,
      ...over,
    });

    it('usa o buffer gravado no registro para zerar a hora extra do dia', async () => {
      const stored = arrangeEntry(shortOvertimeShift({ overtimeBufferMinutes: 30 }));

      const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

      expect(result.overtimeMinutes).toBe(0);
      // Sem hora extra, a pendencia some e o ponto volta a ser aprovavel.
      expect(stored.overtimeStatus).toBeNull();
      expect(result.bankHoursAccruedMinutes).toBe(0);
    });

    it('paga o excedente inteiro quando o dia passa do buffer gravado', async () => {
      const stored = arrangeEntry(shortOvertimeShift({ overtimeBufferMinutes: 10 }));

      const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

      // Gatilho, nao desconto: 20 minutos acima com buffer 10 valem 20, nao 10.
      expect(result.overtimeMinutes).toBe(20);
      expect(stored.overtimeStatus).toBe('PENDING');
    });

    it('trata registro anterior a feature (sem snapshot) como buffer 0', async () => {
      arrangeEntry(shortOvertimeShift({ overtimeBufferMinutes: null }));

      const [result] = await recalculateUserDay({ userId: 'user-123', date: DAY });

      expect(result.overtimeMinutes).toBe(20);
    });

    // O guard que impede a regressao inteira: o recalculo NAO pode consultar a
    // configuracao vigente da empresa.
    it('nunca le a configuracao atual da empresa', async () => {
      arrangeEntry(shortOvertimeShift({ overtimeBufferMinutes: 30 }));

      await recalculateUserDay({ userId: 'user-123', date: DAY });

      expect(mockPrisma.appSetting.findUnique).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Rode e confirme que falha**

Run (a partir de `backend/`): `npx jest tests/utils/recalcDay.test.js`
Expected: FAIL nos dois primeiros casos novos — `expect(received).toBe(0)` recebendo `20`, porque o recalculo ainda ignora o snapshot. O caso "nunca le a configuracao atual" ja passa (guard de regressao) e o "sem snapshot" tambem.

- [ ] **Step 3: Adicione a coluna no schema**

Em `backend/prisma/schema.prisma`, no model `TimeEntry`, logo depois de `overtimePercent Int       @default(0)`:

```prisma
  // Parametro com que a hora extra deste registro foi calculada, pelo mesmo
  // motivo de overtimePercent: o recalculo do dia nao pode reler a configuracao
  // atual da empresa e mudar hora extra ja aprovada. null = registro anterior a
  // esta feature, tratado como 0.
  overtimeBufferMinutes Int?
```

- [ ] **Step 4: Regenere o client Prisma (local, nao toca o banco)**

Run (a partir de `backend/`): `npx prisma generate`
Expected: `Generated Prisma Client`. **Nao rode `prisma db push` nem `prisma migrate` aqui** — ver Task 12.

- [ ] **Step 5: Leia o snapshot no recalculo**

Em `backend/src/utils/recalcDay.js`, no `select` do `findMany` (linha 72), adicione o campo:

```js
    select: {
      id: true,
      clockIn: true,
      clockOut: true,
      breakMinutes: true,
      status: true,
      overtimeStatus: true,
      overtimeBufferMinutes: true,
    },
```

e na chamada do calculo (linha 82-88):

```js
    const overtime = calculateIncrementalOvertimeSummary({
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      contractDailyMinutes: userConfig?.contractDailyMinutes,
      workedMinutesBeforeEntry,
      breakMinutes: entry.breakMinutes,
      // O buffer do REGISTRO, nunca o vigente na empresa. Reler a configuracao
      // atual faria uma correcao do RH num dia antigo zerar hora extra ja
      // aprovada e reverter o banco de horas, sem erro em tela.
      bufferMinutes: entry.overtimeBufferMinutes ?? 0,
    });
```

- [ ] **Step 6: Rode e confirme que passa**

Run (a partir de `backend/`): `npx jest tests/utils/recalcDay.test.js`
Expected: PASS — os casos existentes mais os 4 novos.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/src/utils/recalcDay.js backend/tests/utils/recalcDay.test.js
git commit -m "Guardar no registro a tolerancia com que ele foi calculado" -m "O recalculo do dia passa a usar o valor gravado no proprio registro, e nao a
configuracao vigente. Sem isso, um ADMIN que sobe a tolerancia faz a proxima
correcao do RH num dia antigo zerar hora extra ja aprovada e reverter o credito
de banco de horas, sem erro em tela: recalculateUserDay reprocessa o dia inteiro
e re-credita. O TimeEntry ja guarda overtimePercent pela mesma razao.

Registro anterior a esta feature fica em null e vale 0 — o comportamento que ele
ja tinha. A coluna ainda nao existe no banco: o db push e um passo separado.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Clock-out grava o snapshot e o painel ao vivo respeita o buffer

**Files:**
- Modify: `backend/src/controllers/time.controller.js:966-1040` (clock-out) e `:1486-1529` (painel ao vivo)
- Test: `backend/tests/controllers/timeClockOutOvertimeBuffer.test.js` (novo)

**Interfaces:**
- Consumes: `getOvertimeBufferMinutes`, `resolveOrganizationAdminId` (Task 1); `bufferMinutes` em `calculateIncrementalOvertimeSummary` e `calculateCurrentDailyProgress` (Task 2); a coluna `overtimeBufferMinutes` (Task 3).
- Produces: nada para tarefas seguintes.

**Nota:** no fechamento o buffer vem da configuracao VIGENTE e e gravado. No painel ao vivo ele vem da configuracao vigente e **nao** e gravado: o dia ainda esta aberto, nenhum registro foi fechado e portanto nenhum snapshot existe. O valor que passa a valer e sempre o do clock-out.

- [ ] **Step 1: Escreva o teste que falha**

Crie `backend/tests/controllers/timeClockOutOvertimeBuffer.test.js`:

```js
// O clock-out e o momento em que a tolerancia da empresa vira numero gravado.
// Duas coisas tem que sair certas do mesmo write: a hora extra ja filtrada pelo
// buffer, e o buffer usado, carimbado no registro para o recalculo do dia nao
// reler a configuracao atual depois.

const mockPrisma = require('../mocks/prisma.mock');
const { stubTimeEntryFindFirst } = require('../mocks/timeEntryFindFirst');
const { captureRequestMetadata } = require('../../src/utils/requestMetadata');
const { evaluateGeofence } = require('../../src/utils/geofence');
const { verifyPin } = require('../../src/utils/pinAuth');
const { accrueBankHours } = require('../../src/utils/bankHours');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/utils/requestMetadata', () => ({
  captureRequestMetadata: jest.fn(),
}));
jest.mock('../../src/utils/geofence', () => ({
  evaluateGeofence: jest.fn(),
  getGeofencePublicConfig: jest.fn(),
  getGeofenceConfig: jest.fn(),
  LOCATION_VALIDATION_SOURCES: { GPS: 'GPS', TERMINAL_QR: 'TERMINAL_QR' },
}));
jest.mock('../../src/utils/pinAuth', () => ({
  verifyPin: jest.fn(),
  isPinLocked: jest.fn(() => false),
  getPinLockExpiry: jest.fn(() => null),
  PIN_MAX_ATTEMPTS: 5,
  PIN_LOCK_MINUTES: 15,
}));
jest.mock('../../src/utils/bankHours', () => ({
  accrueBankHours: jest.fn(),
  expireBankHoursIfNeeded: jest.fn(),
}));

const { clockOut } = require('../../src/controllers/time.controller');

const MINUTE = 60 * 1000;

describe('clock-out com buffer de hora extra', () => {
  let mockReq;
  let mockRes;

  const updateArgs = () => mockPrisma.timeEntry.update.mock.calls[0][0];

  const openEntry = (clockInAt) => ({
    id: 'entry-1',
    userId: 'user-123',
    clockIn: clockInAt,
    clockOut: null,
    notes: null,
    location: null,
    breakMinutes: 0,
    breakStartedAt: null,
    breaks: [],
  });

  // Fecha um turno de `workedMinutes` minutos agora mesmo.
  const closeShiftOf = async (workedMinutes) => {
    const clockInAt = new Date(Date.now() - workedMinutes * MINUTE);
    stubTimeEntryFindFirst(mockPrisma, { open: openEntry(clockInAt) });
    await clockOut(mockReq, mockRes);
  };

  beforeEach(() => {
    mockReq = {
      user: { id: 'user-123', email: 'member@test.com', name: 'Member', role: 'MEMBER' },
      body: { pin: '1234' },
      query: {},
      params: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    captureRequestMetadata.mockReturnValue({ ip: '127.0.0.1', device: 'OmniPunt Android', location: null });
    evaluateGeofence.mockReturnValue({
      enabled: false,
      allowed: true,
      inside: true,
      hasCoordinates: false,
      reason: 'GEOFENCE_DISABLED',
    });
    verifyPin.mockResolvedValue(true);

    mockPrisma.user.findUnique.mockResolvedValue({
      facialEmbedding: null,
      facialThreshold: 0.45,
      pinHash: 'hash',
      pinSalt: 'salt',
      pinFailedAttempts: 0,
      pinLockedUntil: null,
      contractDailyMinutes: 480,
      hourlyRate: 0,
      organizationAdminId: 'admin-1',
    });
    mockPrisma.user.update.mockResolvedValue({});
    accrueBankHours.mockResolvedValue({
      accruedMinutes: 0,
      discardedMinutes: 0,
      balanceMinutes: 0,
      expiredMinutes: 0,
    });
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    mockPrisma.timeEntry.update.mockResolvedValue({ id: 'entry-1', user: {} });
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 10 } });
  });

  it('fecha sem hora extra quando o dia ficou dentro do buffer da empresa', async () => {
    await closeShiftOf(488);

    expect(updateArgs().data.overtimeMinutes).toBe(0);
    // Sem hora extra pendente, o gate OVERTIME_PENDING nao trava a aprovacao.
    expect(updateArgs().data.overtimeStatus).toBeNull();
  });

  it('paga o excedente inteiro quando o dia passa do buffer', async () => {
    await closeShiftOf(505);

    // Gatilho, nao desconto: 25 continua valendo 25.
    expect(updateArgs().data.overtimeMinutes).toBe(25);
    expect(updateArgs().data.overtimeStatus).toBe('PENDING');
  });

  it('carimba no registro o buffer usado', async () => {
    await closeShiftOf(505);

    expect(updateArgs().data.overtimeBufferMinutes).toBe(10);
  });

  it('le o buffer da empresa do colaborador, nao do colaborador', async () => {
    await closeShiftOf(505);

    expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
      where: { key: 'overtimeBuffer:admin-1' },
    });
  });

  it('mantem o comportamento de hoje quando a empresa nunca configurou', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    await closeShiftOf(481);

    expect(updateArgs().data.overtimeMinutes).toBe(1);
    expect(updateArgs().data.overtimeStatus).toBe('PENDING');
    expect(updateArgs().data.overtimeBufferMinutes).toBe(0);
  });

  it('nao derruba o clock-out quando a leitura do buffer falha', async () => {
    mockPrisma.appSetting.findUnique.mockRejectedValue(new Error('connection refused'));

    await closeShiftOf(505);

    expect(mockRes.status).not.toHaveBeenCalledWith(500);
    expect(updateArgs().data.overtimeMinutes).toBe(25);
    expect(updateArgs().data.overtimeBufferMinutes).toBe(0);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run (a partir de `backend/`): `npx jest tests/controllers/timeClockOutOvertimeBuffer.test.js`
Expected: FAIL — `overtimeMinutes` vem `8` em vez de `0` e `overtimeBufferMinutes` vem `undefined`.

- [ ] **Step 3: Leia e grave o buffer no clock-out**

Em `backend/src/controllers/time.controller.js`, adicione o import junto dos outros utils do topo do arquivo:

```js
const {
  getOvertimeBufferMinutes,
  resolveOrganizationAdminId,
} = require('../utils/overtimeBuffer');
```

No `select` do usuario do clock-out (linha 966-973), inclua a empresa:

```js
    const userConfig = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        contractDailyMinutes: true,
        hourlyRate: true,
        // A empresa decide o buffer de hora extra; sem isto o select trazia so
        // o contrato e nao havia como resolver o tenant aqui.
        organizationAdminId: true,
      },
    });
```

Logo antes da chamada de `calculateIncrementalOvertimeSummary` (linha 1004), leia o buffer vigente:

```js
    // Configuracao VIGENTE no fechamento — e este valor que passa a valer para
    // este registro dali em diante, carimbado abaixo.
    const overtimeBufferMinutes = await getOvertimeBufferMinutes(
      resolveOrganizationAdminId({ id: userId, organizationAdminId: userConfig?.organizationAdminId })
    );

    const overtime = calculateIncrementalOvertimeSummary({
      clockIn: openEntry.clockIn,
      clockOut: clockOutTime,
      contractDailyMinutes: userConfig?.contractDailyMinutes,
      workedMinutesBeforeEntry,
      breakMinutes: breakSummary.totalMinutes,
      bufferMinutes: overtimeBufferMinutes,
    });
```

No `data` do update que fecha o ponto, depois de `overtimePercent: overtime.overtimePercent,`:

```js
        overtimeBufferMinutes,
```

- [ ] **Step 4: Passe o buffer para o painel ao vivo**

No handler do registro aberto, no `select` do usuario (linha 1486-1492):

```js
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          contractDailyMinutes: true,
          organizationAdminId: true,
        },
      }),
```

e antes de `calculateCurrentDailyProgress` (linha 1523):

```js
    // Aqui o buffer vem da configuracao vigente e NAO e gravado: o dia ainda
    // esta aberto e nenhum registro foi fechado. Sem isto a tela mostra hora
    // extra acumulando durante o dia e o fechamento entrega zero.
    const overtimeBufferMinutes = await getOvertimeBufferMinutes(
      resolveOrganizationAdminId({ id: userId, organizationAdminId: userConfig?.organizationAdminId })
    );

    const dailyProgress = calculateCurrentDailyProgress({
      clockIn: openEntry.clockIn,
      now,
      contractDailyMinutes: userConfig?.contractDailyMinutes,
      workedMinutesBeforeEntry,
      breakMinutes: breakSummary.totalMinutes,
      bufferMinutes: overtimeBufferMinutes,
    });
```

- [ ] **Step 5: Rode e confirme que passa**

Run (a partir de `backend/`): `npx jest tests/controllers/timeClockOutOvertimeBuffer.test.js tests/controllers/timeClockOutOrdering.test.js tests/controllers/time.controller.test.js tests/controllers/currentEntryBreak.test.js tests/controllers/timeOffline.test.js`
Expected: PASS em todas — o teste novo mais as suites de ponto que ja existiam.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/time.controller.js backend/tests/controllers/timeClockOutOvertimeBuffer.test.js
git commit -m "Aplicar a tolerancia da empresa no fechamento e no relogio ao vivo" -m "O clock-out le a tolerancia vigente, calcula a hora extra com ela e carimba o
valor usado no registro. O painel ao vivo recebe a mesma tolerancia, senao a
tela mostra hora extra acumulando durante o dia e o fechamento entrega zero — la
o valor vem da configuracao vigente e nao e gravado, porque o dia ainda esta
aberto e nenhum registro foi fechado.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Registro criado ou fechado pelo RH nasce com snapshot

**Files:**
- Modify: `backend/src/controllers/hr.controller.js:283-348` (`updateHrEntry`) e `:368-409` (`createHrEntry`)
- Test: `backend/tests/controllers/hrEntryOvertimeBuffer.test.js` (novo)

**Interfaces:**
- Consumes: `getOvertimeBufferMinutes`, `resolveOrganizationAdminId` (Task 1); a coluna `overtimeBufferMinutes` (Task 3).
- Produces: nada para tarefas seguintes.

**A regra (ver "Duas decisoes que a spec deixou em aberto"):** grava o buffer vigente quando o registro NASCE fechado (`createHrEntry`) ou quando um registro ABERTO esta sendo fechado agora (`updateHrEntry`). Edicao de registro ja fechado nao re-carimba nada — e exatamente disso que o snapshot protege.

- [ ] **Step 1: Escreva o teste que falha**

Crie `backend/tests/controllers/hrEntryOvertimeBuffer.test.js`:

```js
// O RH cria e fecha registros fora do fluxo de ponto. Se esses registros
// nascessem sem snapshot, valeriam 0 para sempre — e o buffer da empresa nao
// alcancaria justamente o dia esquecido que o RH acabou de lancar.
//
// O outro lado importa mais: editar um registro JA FECHADO nao pode re-carimbar
// o buffer atual. E esse o cenario que o snapshot existe para impedir — ADMIN
// sobe a tolerancia, RH corrige um typo num dia antigo, hora extra ja aprovada
// muda sozinha.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/utils/recalcDay', () => ({
  recalculateUserDay: jest.fn().mockResolvedValue([]),
  reverseEntryBankHours: jest.fn().mockResolvedValue({ reversedMinutes: 0 }),
}));
jest.mock('../../src/utils/resendNotifier', () => ({
  sendResendEmail: jest.fn().mockResolvedValue(undefined),
}));

const { createHrEntry, updateHrEntry } = require('../../src/controllers/hr.controller');

const TARGET = {
  id: 'member-1',
  name: 'Member',
  email: 'member@test.com',
  role: 'MEMBER',
  organizationAdminId: 'admin-1',
};

describe('snapshot do buffer nos registros do RH', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN', organizationAdminId: null },
      body: {},
      params: {},
      query: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockPrisma.user.findUnique.mockResolvedValue(TARGET);
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 10 } });
    mockPrisma.timeEntry.create.mockResolvedValue({ id: 'entry-new' });
    mockPrisma.timeEntry.update.mockResolvedValue({ id: 'entry-1' });
    mockPrisma.timeEntry.findUnique.mockResolvedValue({ id: 'entry-new', userId: TARGET.id });
    mockPrisma.approvalLog.create.mockResolvedValue({ id: 'log-1' });
  });

  describe('createHrEntry', () => {
    beforeEach(() => {
      mockReq.params = { userId: TARGET.id };
      mockReq.body = {
        clockIn: '2026-08-26T08:00:00-03:00',
        clockOut: '2026-08-26T16:25:00-03:00',
      };
    });

    it('grava o buffer vigente da empresa no registro criado', async () => {
      await createHrEntry(mockReq, mockRes);

      expect(mockPrisma.timeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ overtimeBufferMinutes: 10 }),
        })
      );
      expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
        where: { key: 'overtimeBuffer:admin-1' },
      });
    });

    it('grava 0 quando a empresa nunca configurou', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);

      await createHrEntry(mockReq, mockRes);

      expect(mockPrisma.timeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ overtimeBufferMinutes: 0 }),
        })
      );
    });
  });

  describe('updateHrEntry', () => {
    const storedEntry = (over = {}) => ({
      id: 'entry-1',
      userId: TARGET.id,
      clockIn: new Date('2026-08-26T11:00:00.000Z'),
      clockOut: null,
      breakMinutes: 0,
      notes: null,
      overtimeBufferMinutes: null,
      user: TARGET,
      ...over,
    });

    beforeEach(() => {
      mockReq.params = { id: 'entry-1' };
    });

    it('carimba o buffer ao fechar pela primeira vez um registro aberto', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(storedEntry({ clockOut: null }));
      mockReq.body = { clockOut: '2026-08-26T16:25:00-03:00' };

      await updateHrEntry(mockReq, mockRes);

      expect(mockPrisma.timeEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ overtimeBufferMinutes: 10 }),
        })
      );
    });

    // O coracao da protecao: o dia antigo nao se mexe.
    it('nao re-carimba um registro ja fechado', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(
        storedEntry({ clockOut: new Date('2026-08-26T19:00:00.000Z'), overtimeBufferMinutes: 30 })
      );
      mockReq.body = { notes: 'corrigindo um typo' };

      await updateHrEntry(mockReq, mockRes);

      const updateData = mockPrisma.timeEntry.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('overtimeBufferMinutes');
      expect(mockPrisma.appSetting.findUnique).not.toHaveBeenCalled();
    });

    it('nao carimba nada quando o registro continua aberto', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(storedEntry({ clockOut: null }));
      mockReq.body = { notes: 'ainda em andamento' };

      await updateHrEntry(mockReq, mockRes);

      const updateData = mockPrisma.timeEntry.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('overtimeBufferMinutes');
    });
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run (a partir de `backend/`): `npx jest tests/controllers/hrEntryOvertimeBuffer.test.js`
Expected: FAIL nos casos de carimbo (`overtimeBufferMinutes` ausente no `create`/`update`). Os dois casos de "nao carimba" ja passam — sao guard-rails.

- [ ] **Step 3: Implemente nos dois caminhos**

Em `backend/src/controllers/hr.controller.js`, junto dos imports do topo:

```js
const { getOvertimeBufferMinutes, resolveOrganizationAdminId } = require('../utils/overtimeBuffer');
```

Em `createHrEntry`, logo antes do `prisma.timeEntry.create` (linha 397):

```js
    // Registro nasce fechado: carimba a tolerancia vigente da empresa, como o
    // clock-out faz. Sem isto o dia esquecido lancado pelo RH valeria 0 para
    // sempre, mesmo com a empresa configurada.
    const overtimeBufferMinutes = await getOvertimeBufferMinutes(
      resolveOrganizationAdminId(target)
    );
```

e no `data` do create, depois de `status: 'APPROVED',`:

```js
        overtimeBufferMinutes,
```

Em `updateHrEntry`, logo antes do `prisma.timeEntry.update` (linha 338):

```js
    // So carimba quando o registro estava ABERTO e esta sendo fechado agora —
    // o espelho do clock-out. Registro ja fechado mantem o snapshot que tem:
    // re-carimbar com a tolerancia atual e exatamente a regressao que o
    // snapshot existe para impedir (ADMIN sobe a tolerancia, RH corrige um dia
    // antigo, hora extra ja aprovada muda sozinha).
    const isFirstClose = !entry.clockOut && Boolean(nextClockOut);
    const bufferSnapshot = isFirstClose
      ? { overtimeBufferMinutes: await getOvertimeBufferMinutes(resolveOrganizationAdminId(entry.user)) }
      : {};

    await prisma.timeEntry.update({
      where: { id },
      // Registro aberto continua rastreando (mantém status atual); só aprovamos ao fechar.
      data: nextClockOut ? { ...data, ...bufferSnapshot, status: 'APPROVED' } : data,
    });
```

- [ ] **Step 4: Rode e confirme que passa**

Run (a partir de `backend/`): `npx jest tests/controllers/hrEntryOvertimeBuffer.test.js`
Expected: PASS — 5 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/hr.controller.js backend/tests/controllers/hrEntryOvertimeBuffer.test.js
git commit -m "Carimbar a tolerancia nos registros que o RH cria ou fecha" -m "Registro que nasce fechado pelo RH, e registro aberto que o RH fecha, recebem a
tolerancia vigente da empresa — o espelho do clock-out. Editar um registro JA
fechado nao re-carimba: e justamente essa a regressao que o snapshot impede,
onde uma correcao num dia antigo muda hora extra ja aprovada.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Endpoints de configuracao do buffer

**Files:**
- Modify: `backend/src/controllers/admin.controller.js` (imports do topo e `module.exports` do fim)
- Modify: `backend/src/routes/admin.routes.js:14-17` (import) e `:113` (rotas novas)
- Test: `backend/tests/controllers/adminOvertimeSettings.test.js` (novo)

**Interfaces:**
- Consumes: `getOvertimeBufferMinutes`, `resolveOrganizationAdminId`, `buildOvertimeBufferKey`, `MAX_OVERTIME_BUFFER_MINUTES` (Task 1).
- Produces:
  - `getOvertimeSettings(req, res)` → `200 { overtimeSettings: { bufferMinutes: number } }`
  - `updateOvertimeSettings(req, res)` → `200 { message: string, overtimeSettings: { bufferMinutes: number } }`, `400` fora da faixa
  - Rotas `GET /admin/overtime-settings` e `PATCH /admin/overtime-settings` (body `{ bufferMinutes: number }`), consumidas pela Task 9.

**Arquivo de teste novo de proposito:** `tests/controllers/admin.controller.test.js` esta na lista de quarentena do CI (`.github/workflows/ci.yml:50-55`), entao um caso novo la dentro nao seria executado no CI. Um arquivo proprio entra no subconjunto verde.

- [ ] **Step 1: Escreva o teste que falha**

Crie `backend/tests/controllers/adminOvertimeSettings.test.js`:

```js
// Na LEITURA o buffer nunca falha (valor invalido vira 0). Na ESCRITA e o
// contrario: fora de 0..120 devolve 400 em vez de truncar em silencio, porque
// aqui a intencao do usuario e explicita e truncar esconde erro de digitacao.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const {
  getOvertimeSettings,
  updateOvertimeSettings,
} = require('../../src/controllers/admin.controller');

describe('configuracao de hora extra da empresa', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockReq = {
      user: { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN', organizationAdminId: null },
      body: {},
      params: {},
      query: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('getOvertimeSettings', () => {
    it('devolve o buffer configurado da empresa de quem chama', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 10 } });

      await getOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
        where: { key: 'overtimeBuffer:admin-1' },
      });
      expect(mockRes.json).toHaveBeenCalledWith({ overtimeSettings: { bufferMinutes: 10 } });
    });

    it('devolve 0 quando a empresa nunca configurou', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue(null);

      await getOvertimeSettings(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({ overtimeSettings: { bufferMinutes: 0 } });
    });
  });

  describe('updateOvertimeSettings', () => {
    beforeEach(() => {
      mockPrisma.appSetting.upsert.mockResolvedValue({});
    });

    it('grava o valor na chave da empresa', async () => {
      mockReq.body = { bufferMinutes: 15 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'overtimeBuffer:admin-1' },
        create: { key: 'overtimeBuffer:admin-1', value: { bufferMinutes: 15 } },
        update: { value: { bufferMinutes: 15 } },
      });
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ overtimeSettings: { bufferMinutes: 15 } })
      );
    });

    it('aceita 0 como desligar a tolerancia', async () => {
      mockReq.body = { bufferMinutes: 0 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { value: { bufferMinutes: 0 } } })
      );
    });

    it.each([
      ['acima do teto', 121],
      ['negativo', -1],
      ['fracionado', 10.5],
      ['string', '10'],
      ['ausente', undefined],
    ])('recusa %s com 400 em vez de truncar', async (_label, value) => {
      mockReq.body = { bufferMinutes: value };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.appSetting.upsert).not.toHaveBeenCalled();
    });

    it('grava na empresa do ator, nao no id dele, quando ele nao e o ADMIN dono', async () => {
      // Um SUPERVISOR nunca alcanca esta rota (roleCheck(['ADMIN'])), mas o
      // escopo e resolvido pelo mesmo helper em todo lugar: a empresa vem de
      // organizationAdminId quando ele existe.
      mockReq.user = { id: 'someone-2', role: 'ADMIN', organizationAdminId: 'admin-9' };
      mockReq.body = { bufferMinutes: 20 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'overtimeBuffer:admin-9' } })
      );
    });

    // roleCheck deixa SUPERADMIN passar por qualquer rota /admin, e ele nao
    // pertence a empresa nenhuma: gravaria numa chave que ninguem le.
    it('recusa SUPERADMIN, que nao tem empresa propria', async () => {
      mockReq.user = { id: 'super-1', role: 'SUPERADMIN', organizationAdminId: null };
      mockReq.body = { bufferMinutes: 20 };

      await updateOvertimeSettings(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.appSetting.upsert).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run (a partir de `backend/`): `npx jest tests/controllers/adminOvertimeSettings.test.js`
Expected: FAIL — `getOvertimeSettings is not a function`.

- [ ] **Step 3: Escreva os handlers**

Em `backend/src/controllers/admin.controller.js`, adicione ao bloco de imports do topo:

```js
const {
  getOvertimeBufferMinutes,
  resolveOrganizationAdminId,
  buildOvertimeBufferKey,
  MAX_OVERTIME_BUFFER_MINUTES,
} = require('../utils/overtimeBuffer');
```

Antes do `module.exports` do fim do arquivo, adicione os dois handlers:

```js
/**
 * GET /admin/overtime-settings
 * Tolerancia (buffer) de hora extra da empresa de quem chama.
 */
const getOvertimeSettings = async (req, res) => {
  try {
    const bufferMinutes = await getOvertimeBufferMinutes(resolveOrganizationAdminId(req.user));

    res.json({ overtimeSettings: { bufferMinutes } });
  } catch (error) {
    console.error('❌ Erro ao buscar configuração de hora extra:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao buscar configuração de hora extra',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};

/**
 * PATCH /admin/overtime-settings
 * Define a tolerancia de hora extra da empresa. Body: { bufferMinutes }
 */
const updateOvertimeSettings = async (req, res) => {
  try {
    const { bufferMinutes } = req.body || {};

    // Fora da faixa devolve 400 em vez de truncar: na escrita a intencao do
    // usuario e explicita, e truncar esconde erro de digitacao. A normalizacao
    // silenciosa fica so na leitura, onde o calculo nao pode falhar.
    if (
      typeof bufferMinutes !== 'number' ||
      !Number.isInteger(bufferMinutes) ||
      bufferMinutes < 0 ||
      bufferMinutes > MAX_OVERTIME_BUFFER_MINUTES
    ) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `bufferMinutes deve ser um número inteiro entre 0 e ${MAX_OVERTIME_BUFFER_MINUTES}.`,
      });
    }

    // SUPERADMIN atravessa roleCheck em qualquer rota /admin, mas nao pertence a
    // empresa nenhuma: gravaria numa chave que nenhum calculo le.
    if (req.user?.role === 'SUPERADMIN') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'SUPERADMIN não pertence a uma empresa. Configure a tolerância pelo ADMIN da empresa.',
      });
    }

    const organizationAdminId = resolveOrganizationAdminId(req.user);
    if (!organizationAdminId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Não foi possível resolver a empresa deste usuário.',
      });
    }

    const key = buildOvertimeBufferKey(organizationAdminId);
    const value = { bufferMinutes };

    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

    res.json({
      message: 'Configuração de hora extra atualizada com sucesso.',
      overtimeSettings: { bufferMinutes },
    });
  } catch (error) {
    console.error('❌ Erro ao atualizar configuração de hora extra:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao atualizar configuração de hora extra',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};
```

e inclua os dois no `module.exports`, depois de `updateLocationSettings,`:

```js
  getOvertimeSettings,
  updateOvertimeSettings,
```

- [ ] **Step 4: Registre as rotas**

Em `backend/src/routes/admin.routes.js`, acrescente ao import do controller (linha 15-16):

```js
  getLocationSettings,
  updateLocationSettings,
  getOvertimeSettings,
  updateOvertimeSettings,
```

e depois da rota `PATCH /location-settings` (linha 114):

```js
/**
 * GET /admin/overtime-settings
 * Tolerância de hora extra da empresa (buffer em minutos)
 */
router.get('/overtime-settings', getOvertimeSettings);

/**
 * PATCH /admin/overtime-settings
 * Define a tolerância de hora extra da empresa
 * Body: { bufferMinutes: number } (0..120)
 *
 * Sem requirePlan, ao contrário de location-settings: a tolerância decide folha
 * de pagamento e não é um recurso de pacote.
 */
router.patch('/overtime-settings', updateOvertimeSettings);
```

- [ ] **Step 5: Rode e confirme que passa**

Run (a partir de `backend/`): `npx jest tests/controllers/adminOvertimeSettings.test.js tests/routes/routes.integration.test.js`
Expected: PASS no arquivo novo (11 testes). `routes.integration.test.js` esta em quarentena e pode continuar vermelho — compare com o estado ANTES da sua mudanca e garanta que voce nao acrescentou falha nova.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/admin.controller.js backend/src/routes/admin.routes.js backend/tests/controllers/adminOvertimeSettings.test.js
git commit -m "Deixar o ADMIN configurar a tolerancia de hora extra da empresa" -m "GET e PATCH /admin/overtime-settings, no molde de location-settings mas sem
requirePlan: a tolerancia decide folha de pagamento e nao e recurso de pacote.

Fora de 0..120 a escrita devolve 400 em vez de truncar — na escrita a intencao
do usuario e explicita e truncar esconde erro de digitacao. A normalizacao
silenciosa continua so na leitura, onde o calculo nao pode falhar. SUPERADMIN
nao grava: ele nao pertence a empresa nenhuma.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Nota opcional ao negar hora extra

**Files:**
- Modify: `backend/src/controllers/supervisor.controller.js:1741-1790` (`rejectOvertime`)
- Modify: `backend/src/routes/supervisor.routes.js:104-109` (comentario da rota)
- Modify: `backend/src/mcp/catalog/approvals.js:137-156` (`approvals_reject_overtime`)
- Test: `backend/tests/controllers/supervisor.controller.test.js` (arquivo existente)

**Interfaces:**
- Consumes: nada das tarefas anteriores.
- Produces: `PATCH /supervisor/overtime/:id/reject` aceita body sem `comment` — consumido pela Task 10.

- [ ] **Step 1: Escreva o teste que falha**

Em `backend/tests/controllers/supervisor.controller.test.js`, acrescente `rejectOvertime` ao `require` do controller no topo do arquivo:

```js
const {
  getTeamPendingEntries,
  approveEntry,
  approveEntriesBulk,
  rejectEntry,
  rejectEntriesBulk,
  rejectOvertime,
  requestEdit,
  getTeamMembers,
  getTeamPresenceSnapshot,
} = require('../../src/controllers/supervisor.controller');
```

e adicione, ao fim do `describe('Supervisor Controller', ...)`:

```js
  // Negar hora extra deixa de exigir justificativa; negar a MARCACAO continua
  // exigindo. Sao trilhas diferentes, e a fronteira entre elas nunca teve teste.
  describe('rejectOvertime: nota opcional', () => {
    const pendingOvertimeEntry = {
      id: 'entry-1',
      status: 'PENDING',
      clockOut: new Date('2026-08-26T19:00:00.000Z'),
      overtimeStatus: 'PENDING',
      overtimeMinutes: 25,
      overtimeMinutes50: 25,
      overtimeMinutes100: 0,
      bankHoursAccruedMinutes: 25,
      user: {
        id: 'member-123',
        name: 'Member',
        email: 'member@test.com',
        supervisorId: 'supervisor-123',
        organizationAdminId: 'admin-1',
      },
    };

    beforeEach(() => {
      mockReq.params = { id: 'entry-1' };
      mockPrisma.timeEntry.findUnique.mockResolvedValue(pendingOvertimeEntry);
      mockPrisma.$transaction.mockResolvedValue([{ id: 'entry-1' }, { id: 'log-1' }]);
    });

    it('nega sem comentario nenhum', async () => {
      mockReq.body = {};

      await rejectOvertime(mockReq, mockRes);

      expect(mockRes.status).not.toHaveBeenCalledWith(400);
      expect(reverseEntryBankHours).toHaveBeenCalledWith('entry-1');
    });

    it('nega com comentario curto, que antes era recusado', async () => {
      mockReq.body = { comment: 'ok' };

      await rejectOvertime(mockReq, mockRes);

      expect(mockRes.status).not.toHaveBeenCalledWith(400);
    });

    it('registra os minutos originais no log mesmo sem comentario', async () => {
      mockReq.body = {};

      await rejectOvertime(mockReq, mockRes);

      const logCreate = mockPrisma.approvalLog.create.mock.calls[0][0];
      expect(logCreate.data.action).toBe('OVERTIME_REJECTED');
      expect(logCreate.data.comment).toContain('HE original: 25min');
      // Sem sobra de espaco nem de separador quando o supervisor nao escreveu nada.
      expect(logCreate.data.comment.startsWith('[HE original:')).toBe(true);
    });

    it('mantem o comentario do supervisor antes dos minutos originais', async () => {
      mockReq.body = { comment: 'combinado na reuniao' };

      await rejectOvertime(mockReq, mockRes);

      const logCreate = mockPrisma.approvalLog.create.mock.calls[0][0];
      expect(logCreate.data.comment).toContain('combinado na reuniao');
      expect(logCreate.data.comment).toContain('HE original: 25min');
    });
  });

  // Guarda a fronteira do escopo: a exigencia de 5 caracteres PERTENCE a
  // rejeicao da marcacao e nao pode cair junto.
  describe('rejeitar a marcacao continua exigindo justificativa', () => {
    it('rejectEntry sem comentario devolve 400', async () => {
      mockReq.params = { id: 'entry-1' };
      mockReq.body = {};

      await rejectEntry(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('rejectEntriesBulk sem comentario devolve 400', async () => {
      mockReq.body = { entryIds: ['entry-1'] };

      await rejectEntriesBulk(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });
```

- [ ] **Step 2: Rode e confirme que falha**

Run (a partir de `backend/`): `npx jest tests/controllers/supervisor.controller.test.js -t "nota opcional"`
Expected: FAIL — os dois primeiros casos recebem 400 ("Comentário obrigatório para negar horas extras").

- [ ] **Step 3: Remova a exigencia e monte o log**

Em `backend/src/controllers/supervisor.controller.js`, dentro de `rejectOvertime`, **apague** o bloco das linhas 1747-1753:

```js
    // Comentário obrigatório para negar horas extras
    if (!comment || comment.trim().length < 5) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Comentário obrigatório para negar horas extras (mínimo 5 caracteres)',
      });
    }
```

e, no lugar, logo antes de `const entry = await loadEntryForOvertimeDecision(req, res);`:

```js
    // A justificativa é opcional para hora extra (continua obrigatória para
    // rejeitar a MARCAÇÃO, que é outra trilha). O que não é opcional é o
    // rastro dos minutos originais: sem ele o número negado não volta.
    const trimmedComment = typeof comment === 'string' ? comment.trim() : '';
```

Depois, no `approvalLog.create` da transacao (linha 1782-1789), troque o campo `comment`:

```js
      prisma.approvalLog.create({
        data: {
          timeEntryId: id,
          reviewerId: supervisorId,
          action: 'OVERTIME_REJECTED',
          comment: buildOvertimeRejectionNote(trimmedComment, entry),
        },
      }),
```

E, logo acima de `rejectOvertime` (depois de `loadEntryForOvertimeDecision`), adicione o helper — usado tambem pela Task 8:

```js
/**
 * Comentário do log de negação de HE: o que o supervisor escreveu (se escreveu)
 * mais os minutos originais, que é o que permite auditar o número revertido.
 */
const buildOvertimeRejectionNote = (trimmedComment, entry) => {
  const original = `[HE original: ${entry.overtimeMinutes}min (50%: ${entry.overtimeMinutes50}min, 100%: ${entry.overtimeMinutes100}min), banco: ${entry.bankHoursAccruedMinutes}min]`;

  return trimmedComment ? `${trimmedComment} ${original}` : original;
};
```

- [ ] **Step 4: Rode e confirme que passa**

Run (a partir de `backend/`): `npx jest tests/controllers/supervisor.controller.test.js`
Expected: PASS — a suite inteira, incluindo os 6 casos novos.

- [ ] **Step 5: Corrija o contrato publicado da rota e do MCP**

Em `backend/src/routes/supervisor.routes.js`, linhas 104-109:

```js
/**
 * PATCH /supervisor/overtime/:id/reject
 * Nega as horas extras de um registro (zera efeito e reverte banco de horas)
 * Body: { comment?: string } (opcional)
 */
router.patch('/overtime/:id/reject', rejectOvertime);
```

Em `backend/src/mcp/catalog/approvals.js`, na tool `approvals_reject_overtime`:

```js
    description:
      'Rejeita a hora extra de uma marcacao e REVERTE o acumulo correspondente no banco de horas ' +
      'do colaborador. Comentario opcional. A marcacao em si continua podendo ser aprovada ' +
      'depois com approvals_approve.',
    inputSchema: obj(
      { id: str('Id da marcacao (uuid).'), comment: str('Motivo da rejeicao. Opcional.') },
      ['id']
    ),
```

- [ ] **Step 6: Rode a suite do catalogo MCP**

Run (a partir de `backend/`): `npx jest tests/mcp/catalog.test.js`
Expected: PASS — o `:id` do path continua declarado como obrigatorio no `inputSchema`, que e o que o teste cobra.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/supervisor.controller.js backend/src/routes/supervisor.routes.js backend/src/mcp/catalog/approvals.js backend/tests/controllers/supervisor.controller.test.js
git commit -m "Tornar opcional a justificativa para negar hora extra" -m "Negar hora extra deixa de exigir 5 caracteres. O comentario continua aceito e
continua sendo gravado junto com os minutos originais, que e o que permite
auditar o numero revertido — sem comentario o log guarda so os minutos.

Rejeitar a MARCACAO continua exigindo justificativa, inclusive em lote: e outra
trilha, e agora tem teste guardando essa fronteira. Rota e catalogo MCP
corrigidos, que anunciavam o comentario como obrigatorio.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Negacao de hora extra em lote

**Files:**
- Modify: `backend/src/controllers/supervisor.controller.js` (handler novo + `module.exports`)
- Modify: `backend/src/routes/supervisor.routes.js` (rota nova)
- Test: `backend/tests/controllers/supervisor.controller.test.js`

**Interfaces:**
- Consumes: `classifyBulkEntries`, `BULK_ENTRY_INCLUDE`, `reverseEntryBankHours`, `buildOvertimeRejectionNote` (Task 7) — todos ja no mesmo arquivo.
- Produces: `POST /supervisor/overtime/bulk/reject`, body `{ entryIds: string[], comment?: string }` → `200 { message, overtimeRejectedCount, skipped }` — consumido pela Task 11.

**Sem tool MCP.** A exposicao MCP do projeto ja opera perto do teto de tools, e negacao em lote sem justificativa e a ultima coisa a abrir para agente sem pedido explicito.

- [ ] **Step 1: Escreva o teste que falha**

Em `backend/tests/controllers/supervisor.controller.test.js`, acrescente `rejectOvertimeBulk` ao `require` do controller e adicione ao fim do `describe` principal:

```js
  describe('rejectOvertimeBulk', () => {
    const entryWithPendingOvertime = (id, over = {}) => ({
      id,
      status: 'PENDING',
      clockOut: new Date('2026-08-26T19:00:00.000Z'),
      overtimeStatus: 'PENDING',
      overtimeMinutes: 25,
      overtimeMinutes50: 25,
      overtimeMinutes100: 0,
      bankHoursAccruedMinutes: 25,
      user: {
        id: 'member-123',
        name: 'Member',
        email: 'member@test.com',
        supervisorId: 'supervisor-123',
        organizationAdminId: 'admin-1',
      },
      ...over,
    });

    beforeEach(() => {
      mockPrisma.$transaction.mockResolvedValue([{ count: 2 }, { count: 2 }]);
    });

    it('nega em lote sem comentario', async () => {
      mockReq.body = { entryIds: ['entry-1', 'entry-2'] };
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        entryWithPendingOvertime('entry-1'),
        entryWithPendingOvertime('entry-2'),
      ]);

      await rejectOvertimeBulk(mockReq, mockRes);

      expect(mockRes.status).not.toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ overtimeRejectedCount: 2 })
      );
      expect(reverseEntryBankHours).toHaveBeenCalledTimes(2);
    });

    // O ponto que separa este endpoint do reject-bulk: a MARCACAO nao e tocada.
    it('nao altera o status das marcacoes', async () => {
      mockReq.body = { entryIds: ['entry-1'] };
      mockPrisma.timeEntry.findMany.mockResolvedValue([entryWithPendingOvertime('entry-1')]);

      await rejectOvertimeBulk(mockReq, mockRes);

      const writes = mockPrisma.timeEntry.updateMany.mock.calls.map(([args]) => args.data);
      for (const data of writes) {
        expect(data).not.toHaveProperty('status');
      }
    });

    it('escreve com o predicado de HE pendente, nao so com a leitura anterior', async () => {
      mockReq.body = { entryIds: ['entry-1'] };
      mockPrisma.timeEntry.findMany.mockResolvedValue([entryWithPendingOvertime('entry-1')]);

      await rejectOvertimeBulk(mockReq, mockRes);

      const [args] = mockPrisma.timeEntry.updateMany.mock.calls[0];
      expect(args.where).toEqual({ id: { in: ['entry-1'] }, overtimeStatus: 'PENDING' });
    });

    it('ignora item sem HE pendente em vez de falhar o lote', async () => {
      mockReq.body = { entryIds: ['entry-1', 'entry-2'] };
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        entryWithPendingOvertime('entry-1'),
        entryWithPendingOvertime('entry-2', { overtimeStatus: null }),
      ]);

      await rejectOvertimeBulk(mockReq, mockRes);

      const payload = mockRes.json.mock.calls[0][0];
      expect(payload.skipped).toContainEqual({ id: 'entry-2', reason: 'OVERTIME_NOT_PENDING' });
    });

    it('ignora id inexistente', async () => {
      mockReq.body = { entryIds: ['entry-1', 'sumiu'] };
      mockPrisma.timeEntry.findMany.mockResolvedValue([entryWithPendingOvertime('entry-1')]);

      await rejectOvertimeBulk(mockReq, mockRes);

      const payload = mockRes.json.mock.calls[0][0];
      expect(payload.skipped).toContainEqual({ id: 'sumiu', reason: 'NOT_FOUND' });
    });

    it('devolve 409 quando nao sobra nada elegivel', async () => {
      mockReq.body = { entryIds: ['entry-1'] };
      mockPrisma.timeEntry.findMany.mockResolvedValue([
        entryWithPendingOvertime('entry-1', { overtimeStatus: 'APPROVED' }),
      ]);

      await rejectOvertimeBulk(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa lote vazio ou acima de 200 ids', async () => {
      mockReq.body = { entryIds: [] };
      await rejectOvertimeBulk(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);

      mockRes.status.mockClear();
      mockReq.body = { entryIds: Array.from({ length: 201 }, (_, i) => `e-${i}`) };
      await rejectOvertimeBulk(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });
```

- [ ] **Step 2: Rode e confirme que falha**

Run (a partir de `backend/`): `npx jest tests/controllers/supervisor.controller.test.js -t "rejectOvertimeBulk"`
Expected: FAIL — `rejectOvertimeBulk is not a function`.

- [ ] **Step 3: Escreva o handler**

Em `backend/src/controllers/supervisor.controller.js`, depois de `rejectOvertime`:

```js
/**
 * POST /supervisor/overtime/bulk/reject
 * Nega SÓ as horas extras pendentes de um lote de registros: zera o efeito e
 * reverte o crédito de banco de horas, sem tocar no status das marcações.
 * Body: { entryIds: string[], comment?: string }
 *
 * Separado de rejectEntriesBulk de propósito: lá a negação é da marcação e a
 * justificativa continua obrigatória.
 */
const rejectOvertimeBulk = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const { entryIds, comment } = req.body || {};

    if (!Array.isArray(entryIds) || entryIds.length === 0 || entryIds.length > 200) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Informe entryIds como um array com 1 a 200 registros.',
      });
    }

    const entries = await prisma.timeEntry.findMany({
      where: { id: { in: entryIds } },
      include: BULK_ENTRY_INCLUDE,
    });

    const foundIds = new Set(entries.map((entry) => entry.id));
    const notFound = entryIds
      .filter((id) => !foundIds.has(id))
      .map((id) => ({ id, reason: 'NOT_FOUND' }));

    // Mesma autorização e mesmos motivos de ignorar do resto do lote.
    const { eligible, skipped } = await classifyBulkEntries(req.user, entries, notFound);

    const overtimeEntries = [];
    for (const entry of eligible) {
      if (entry.overtimeStatus === 'PENDING') {
        overtimeEntries.push(entry);
      } else {
        skipped.push({ id: entry.id, reason: 'OVERTIME_NOT_PENDING' });
      }
    }

    if (overtimeEntries.length === 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Nenhuma hora extra pendente no lote. Atualize a lista.',
        overtimeRejectedCount: 0,
        skipped,
      });
    }

    const overtimeIds = overtimeEntries.map((entry) => entry.id);
    const trimmedComment = typeof comment === 'string' ? comment.trim() : '';

    // Reverte o crédito antes da transação, igual ao rejectOvertime e ao
    // rejectEntriesBulk. Sequencial: o lote é limitado a 200 registros.
    for (const id of overtimeIds) {
      await reverseEntryBankHours(id);
    }

    // `overtimeStatus: 'PENDING'` no WHERE: o predicado é avaliado pelo banco e
    // não pela leitura feita acima. Sem ele, dois supervisores negando o mesmo
    // lote ao mesmo tempo passariam os dois pelo filtro em memória.
    const [rejected] = await prisma.$transaction([
      prisma.timeEntry.updateMany({
        where: { id: { in: overtimeIds }, overtimeStatus: 'PENDING' },
        data: {
          overtimeStatus: 'REJECTED',
          overtimeMinutes: 0,
          overtimeMinutes50: 0,
          overtimeMinutes100: 0,
          overtimePercent: 0,
          bankHoursAccruedMinutes: 0,
        },
      }),
      prisma.approvalLog.createMany({
        data: overtimeEntries.map((entry) => ({
          timeEntryId: entry.id,
          reviewerId: supervisorId,
          action: 'OVERTIME_REJECTED',
          comment: buildOvertimeRejectionNote(trimmedComment, entry),
        })),
      }),
    ]);

    const overtimeRejectedCount = rejected?.count ?? 0;

    console.log(
      `❌ ${overtimeRejectedCount} horas extras negadas em lote por ${req.user.email}`
    );

    res.json({
      message: `${overtimeRejectedCount} hora(s) extra(s) negada(s)`,
      overtimeRejectedCount,
      skipped,
    });
  } catch (error) {
    console.error('❌ Erro ao negar horas extras em lote:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erro ao negar horas extras em lote',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    });
  }
};
```

Acrescente ao `module.exports`, depois de `rejectOvertime,`:

```js
  rejectOvertimeBulk,
```

- [ ] **Step 4: Registre a rota**

Em `backend/src/routes/supervisor.routes.js`, acrescente `rejectOvertimeBulk` ao import do controller e adicione depois da rota `PATCH /overtime/:id/reject`:

```js
/**
 * POST /supervisor/overtime/bulk/reject
 * Nega só as horas extras pendentes de um lote (não mexe no status das marcações)
 * Body: { entryIds: string[], comment?: string }
 */
router.post('/overtime/bulk/reject', rejectOvertimeBulk);
```

- [ ] **Step 5: Rode e confirme que passa**

Run (a partir de `backend/`): `npx jest tests/controllers/supervisor.controller.test.js tests/controllers/supervisorBankHoursRelease.test.js`
Expected: PASS nas duas suites.

- [ ] **Step 6: Rode o backend inteiro no mesmo recorte do CI**

Run (a partir de `backend/`):

```bash
npx jest --runInBand --testPathIgnorePatterns tests/routes/routes.integration.test.js tests/controllers/admin.controller.test.js tests/controllers/finance.controller.test.js tests/controllers/user.controller.test.js tests/controllers/vacation.controller.test.js
```

Expected: PASS — este e exatamente o subconjunto que o CI executa.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/supervisor.controller.js backend/src/routes/supervisor.routes.js backend/tests/controllers/supervisor.controller.test.js
git commit -m "Negar horas extras de um lote sem mexer nas marcacoes" -m "POST /supervisor/overtime/bulk/reject decide so a trilha de hora extra: zera o
efeito, reverte o banco de horas e deixa o status das marcacoes intacto, para o
supervisor poder aprovar os pontos depois. Item sem hora extra pendente e
ignorado com motivo, como no resto do lote, em vez de derrubar a chamada.

O predicado overtimeStatus PENDING vai no proprio UPDATE: quem decide quem
venceu a corrida e o banco, nao a leitura anterior. rejectEntriesBulk nao muda.

Sem tool MCP: a exposicao ja opera perto do teto, e negacao em lote sem
justificativa nao se abre para agente sem alguem pedir.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Campo da tolerancia na tela de ADMIN

**Files:**
- Modify: `frontend/src/pages/AdminDashboard.tsx` (estado, loader, handler de salvar, e um card novo depois do bloco de localizacao, linha 1236)

**Interfaces:**
- Consumes: `GET`/`PATCH /admin/overtime-settings` (Task 6).
- Produces: nada para tarefas seguintes.

**O texto da tela e a parte que decide pagamento.** A diferenca entre "25 vira 25" e "25 vira 15" nao e obvia, e quem configura precisa ler isso antes de digitar.

- [ ] **Step 1: Adicione o estado**

Em `frontend/src/pages/AdminDashboard.tsx`, junto dos outros `useState` de configuracao (perto da linha 268):

```tsx
  const [overtimeBufferForm, setOvertimeBufferForm] = useState('0')
  const [overtimeSettingsLoading, setOvertimeSettingsLoading] = useState(false)
  const [overtimeSettingsSaving, setOvertimeSettingsSaving] = useState(false)
```

- [ ] **Step 2: Carregue o valor atual**

Depois de `loadLocationSettings` (linha 442):

```tsx
  // Sem gate de plano, ao contrario de loadLocationSettings: a tolerancia decide
  // folha de pagamento e nao e recurso de pacote.
  const loadOvertimeSettings = async () => {
    if (!token) return
    setOvertimeSettingsLoading(true)
    try {
      const response = await apiFetch<{ overtimeSettings: { bufferMinutes: number } }>(
        '/admin/overtime-settings',
        { token }
      )
      setOvertimeBufferForm(String(response.overtimeSettings?.bufferMinutes ?? 0))
    } finally {
      setOvertimeSettingsLoading(false)
    }
  }
```

e, junto dos outros `useEffect` de carga (perto da linha 444):

```tsx
  useEffect(() => {
    loadOvertimeSettings().catch(() => undefined)
  }, [token])
```

- [ ] **Step 3: Salve com validacao do mesmo lado do servidor**

Depois de `handleSaveLocationSettings` (linha 1006):

```tsx
  const handleSaveOvertimeSettings = async () => {
    if (!token) return
    setError('')
    setNotice('')

    const parsed = Number(overtimeBufferForm)
    // Mesma faixa que o servidor recusa com 400: o campo avisa antes de gastar
    // uma ida ao servidor, mas quem manda continua sendo o backend.
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 120) {
      setError(
        t(
          'Overtime tolerance must be a whole number of minutes between 0 and 120.',
          'A tolerancia de hora extra deve ser um numero inteiro de minutos entre 0 e 120.'
        )
      )
      return
    }

    setOvertimeSettingsSaving(true)
    try {
      // skipIdempotency: salvar o mesmo valor duas vezes no mesmo dia voltaria
      // 202 sem overtimeSettings no corpo, e a tela leria undefined.
      const response = await apiFetch<{
        overtimeSettings: { bufferMinutes: number }
        message: string
      }>('/admin/overtime-settings', {
        token,
        method: 'PATCH',
        body: { bufferMinutes: parsed },
        skipIdempotency: true,
      })

      setOvertimeBufferForm(String(response.overtimeSettings.bufferMinutes))
      setNotice(
        response.message
          ? translateApiMessage(response.message)
          : t('Overtime settings updated.', 'Configuracao de hora extra atualizada.')
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not save overtime settings.', 'Erro ao salvar configuracao de hora extra')
      )
    } finally {
      setOvertimeSettingsSaving(false)
    }
  }
```

- [ ] **Step 4: Adicione o card**

Logo depois do fechamento do bloco de localizacao (a linha `) : null}` na linha 1236) e antes do card de usuarios:

```tsx
        <div className="rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm lg:col-span-2">
          <h3 className="text-lg font-semibold text-slate-900">
            {t('Overtime tolerance', 'Tolerancia de hora extra')}
          </h3>
          <p className="mt-2 text-xs text-slate-500">
            {t(
              'Minutes past the daily contract that do not generate overtime. It is a trigger, not a discount: with a 10-minute tolerance, 25 extra minutes are still worth 25, not 15. Applies to the whole day, and the value in force at clock-out is the one stored on the entry.',
              'Minutos acima da jornada diaria que nao geram hora extra. E um gatilho, nao um desconto: com tolerancia de 10, 25 minutos extras continuam valendo 25, e nao 15. Vale para o dia inteiro, e o valor vigente no fechamento e o que fica gravado no registro.'
            )}
          </p>

          {overtimeSettingsLoading ? (
            <p className="mt-2 text-xs text-slate-500">
              {t('Loading overtime settings...', 'Carregando configuracao de hora extra...')}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="overtime-buffer-minutes"
                className="block text-[11px] font-semibold text-slate-700"
              >
                {t('Tolerance (minutes)', 'Tolerancia (minutos)')}
              </label>
              <input
                id="overtime-buffer-minutes"
                type="number"
                min={0}
                max={120}
                step={1}
                value={overtimeBufferForm}
                onChange={(event) => setOvertimeBufferForm(event.target.value)}
                className="mt-1 w-32 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={handleSaveOvertimeSettings}
              disabled={overtimeSettingsSaving}
              className="rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {overtimeSettingsSaving
                ? t('Saving...', 'Salvando...')
                : t('Save overtime tolerance', 'Salvar tolerancia de hora extra')}
            </button>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            {t(
              '0 disables the tolerance: any minute past the contract generates overtime, which is how the system behaved before this setting existed. Changing it never recalculates past days.',
              '0 desliga a tolerancia: qualquer minuto acima da jornada gera hora extra, que e como o sistema se comportava antes desta configuracao existir. Mudar o valor nunca recalcula dias passados.'
            )}
          </p>
        </div>
```

- [ ] **Step 5: Verifique tipo e bundle**

Run (a partir de `frontend/`): `npm run build`
Expected: `tsc` sem erro e o bundle gerado.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/AdminDashboard.tsx
git commit -m "Deixar o ADMIN ajustar a tolerancia de hora extra pela tela" -m "O texto do card e metade da entrega: a diferenca entre 25 virar 25 e 25 virar
15 nao e obvia e decide pagamento, entao a tela diz em voz alta que a tolerancia
e gatilho e nao desconto, que vale para o dia inteiro e que mudar o valor nao
recalcula o passado.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Tirar a exigencia de 5 caracteres do caminho de hora extra

**Files:**
- Modify: `frontend/src/pages/SupervisorDashboard.tsx:722-733` e `:1653-1658`
- Modify: `frontend/src/pages/SupervisorPendingItemsPage.tsx:314-324`
- Modify: `frontend/src/pages/AdminPendingApprovalsPage.tsx:173-183`

**Interfaces:**
- Consumes: `PATCH /supervisor/overtime/:id/reject` sem `comment` (Task 7).
- Produces: nada.

**Nao encoste** nas validacoes de `REJECT`/`REQUEST_EDIT` da MARCACAO (`SupervisorPendingItemsPage.tsx:266`, `AdminPendingApprovalsPage.tsx:122`, `SupervisorDashboard.tsx:877`). Sao outra trilha e continuam valendo. A divergencia pre-existente de 3 contra 5 caracteres nelas e bug conhecido e esta fora deste plano.

- [ ] **Step 1: `SupervisorDashboard.tsx` — remova a guarda**

Em `submitOvertimeReview`, apague o bloco:

```tsx
    if (decision === 'REJECT' && comment.length < 5) {
      setError(
        t(
          'To deny overtime, provide a comment with at least 5 characters.',
          'Para negar horas extras, informe comentario com pelo menos 5 caracteres.'
        )
      )
      return
    }
```

O resto da funcao nao muda: `body: comment ? { comment } : {}` ja envia so o que foi digitado.

- [ ] **Step 2: `SupervisorDashboard.tsx` — corrija o aviso do modal**

Na linha 1653-1658, troque o texto:

```tsx
                <p className="mt-1 text-xs text-amber-700">
                  {t(
                    'Approve or deny the overtime before approving the entry. A comment is optional.',
                    'Aprove ou negue as horas extras antes de aprovar o ponto. O comentario e opcional.'
                  )}
                </p>
```

- [ ] **Step 3: `SupervisorPendingItemsPage.tsx` — remova a guarda**

Em `handleOvertimeReview`, apague o bloco:

```tsx
    if (decision === 'REJECT' && comment.length < 5) {
      setActionLoadingByEntry((prev) => ({ ...prev, [entryId]: false }))
      setError(
        t(
          'To deny overtime, provide a comment with at least 5 characters.',
          'Para negar horas extras, informe comentario com pelo menos 5 caracteres.'
        )
      )
      return
    }
```

Atencao: essa funcao ja marcou `actionLoadingByEntry` como `true` antes do bloco; removendo a guarda, o `finally` existente continua sendo quem desliga. Nao deixe o `setActionLoadingByEntry(false)` orfao.

- [ ] **Step 4: `AdminPendingApprovalsPage.tsx` — remova a guarda**

Em `handleReviewOvertime`, apague o bloco:

```tsx
    if (decision === 'REJECT' && comment.length < 5) {
      setError(
        t(
          'To deny overtime, provide a comment with at least 5 characters.',
          'Para negar horas extras, informe comentario com pelo menos 5 caracteres.'
        )
      )
      return
    }
```

- [ ] **Step 5: Confirme que as guardas da MARCACAO continuam de pe**

Run (a partir de `frontend/`):

```bash
grep -rn "at least 3 characters" src/pages/SupervisorPendingItemsPage.tsx src/pages/AdminPendingApprovalsPage.tsx
grep -rn "at least 5 characters" src/pages
```

Expected: o primeiro `grep` acha as duas guardas de `REJECT`/`REQUEST_EDIT` da marcacao (intactas); o segundo acha **apenas** as guardas do lote de marcacoes (`readDenyComment` em `SupervisorPendingItemsPage.tsx` e a de `SupervisorDashboard.tsx:877`), nenhuma no caminho de hora extra.

- [ ] **Step 6: Verifique tipo e bundle**

Run (a partir de `frontend/`): `npm test && npm run build`
Expected: vitest PASS (5 arquivos em `src/lib`) e build sem erro.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/SupervisorDashboard.tsx frontend/src/pages/SupervisorPendingItemsPage.tsx frontend/src/pages/AdminPendingApprovalsPage.tsx
git commit -m "Parar de exigir justificativa para negar hora extra nas telas" -m "As tres telas que decidem hora extra paravam o supervisor com um aviso de 5
caracteres que o servidor nao cobra mais. O campo de comentario continua onde
estava e continua enviando o que for digitado.

As guardas da rejeicao da MARCACAO nao foram tocadas: sao outra trilha e o
backend continua exigindo justificativa la, inclusive em lote.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Botao de negar hora extra em lote

**Files:**
- Modify: `frontend/src/pages/SupervisorPendingItemsPage.tsx:104-110` (tipo), `:221-248` (grupo), `:350-406` (`runBulk`), `:444-468` (handler novo) e os dois blocos de botoes (`:786-805` mobile, `:1015-1032` desktop)

**Interfaces:**
- Consumes: `POST /supervisor/overtime/bulk/reject` (Task 8).
- Produces: nada.

**Por que nesta tela:** e a unica que ja agrupa registros por colaborador e ja tem acao em lote. O lote de HE reaproveita esse agrupamento — nao ha checkbox por registro no projeto.

- [ ] **Step 1: Leve os ids de HE pendente ate o grupo**

No tipo `WorkerGroup` (linha 104-110), acrescente o campo:

```tsx
type WorkerGroup = {
  user: Entry['user']
  days: Map<string, DayGroup>
  approvableIds: string[]
  pendingOtIds: string[]
  pendingOtMinutes: number
  totalMinutes: number
}
```

No `useMemo` que monta os grupos, inicialize o campo novo (linha 228):

```tsx
        group = {
          user: entry.user,
          days: new Map(),
          approvableIds: [],
          pendingOtIds: [],
          pendingOtMinutes: 0,
          totalMinutes: 0,
        }
```

e preencha junto dos minutos (linha 246):

```tsx
        if (entry.overtimeStatus === 'PENDING') {
          group.pendingOtIds.push(entry.id)
          group.pendingOtMinutes += entry.overtimeMinutes || 0
        }
```

- [ ] **Step 2: Escreva o handler**

Depois de `handleBulkReject` (linha 468):

```tsx
  /**
   * Nega so a trilha de hora extra do colaborador no periodo: as marcacoes
   * continuam pendentes e aprovaveis depois. Comentario opcional — diferente do
   * lote de marcacoes, onde ele continua obrigatorio.
   */
  const handleBulkRejectOvertime = async (group: WorkerGroup) => {
    if (group.pendingOtIds.length === 0) return
    const userKey = group.user.id || group.user.email
    const comment = (bulkCommentByUser[userKey] || '').trim()

    const confirmText = t(
      `Deny ${fmtHM(group.pendingOtMinutes)} of pending overtime for ${group.user.name}? The entries themselves stay pending, and the bank-hours credit is reversed.`,
      `Negar ${fmtHM(group.pendingOtMinutes)} de horas extras pendentes de ${group.user.name}? As marcacoes continuam pendentes, e o credito de banco de horas e revertido.`
    )
    if (!window.confirm(confirmText)) return

    setNotice('')
    setError('')
    setBulkLoadingByUser((prev) => ({ ...prev, [userKey]: true }))

    try {
      // skipIdempotency pelo mesmo motivo de runBulk: repetir o mesmo corpo no
      // mesmo dia voltaria 202 sem os contadores.
      const result = await apiFetch<BulkResult>('/supervisor/overtime/bulk/reject', {
        token,
        method: 'POST',
        body: comment ? { entryIds: group.pendingOtIds, comment } : { entryIds: group.pendingOtIds },
        skipIdempotency: true,
      })

      const count = result.overtimeRejectedCount || 0
      const skippedCount = result.skipped?.length || 0
      setNotice(
        t(`Overtime denied on ${count} entries.`, `Horas extras negadas em ${count} registros.`) +
          (skippedCount > 0 ? t(` ${skippedCount} skipped.`, ` ${skippedCount} ignorados.`) : '')
      )
      setBulkCommentByUser((prev) => ({ ...prev, [userKey]: '' }))
      await loadData()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not bulk deny overtime.', 'Erro ao negar horas extras em lote')
      )
    } finally {
      setBulkLoadingByUser((prev) => ({ ...prev, [userKey]: false }))
    }
  }
```

- [ ] **Step 3: Adicione o botao no cartao mobile**

No bloco da linha 786-805, troque o `grid grid-cols-2` por um layout que comporte o terceiro botao e acrescente-o depois do "Negar tudo":

```tsx
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleBulkApprove(group)}
                        disabled={group.approvableIds.length === 0 || Boolean(bulkLoadingByUser[userKey])}
                        className="min-h-[44px] rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {t(`Approve all (${group.approvableIds.length})`, `Aprovar tudo (${group.approvableIds.length})`)}
                      </button>
                      <button
                        onClick={() => handleBulkReject(group)}
                        disabled={
                          group.approvableIds.length === 0 ||
                          Boolean(bulkLoadingByUser[userKey]) ||
                          (bulkCommentByUser[userKey] || '').trim().length < 5
                        }
                        className="min-h-[44px] rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
                      >
                        {t(`Deny all (${group.approvableIds.length})`, `Negar tudo (${group.approvableIds.length})`)}
                      </button>
                      <button
                        onClick={() => handleBulkRejectOvertime(group)}
                        disabled={group.pendingOtIds.length === 0 || Boolean(bulkLoadingByUser[userKey])}
                        className="col-span-2 min-h-[44px] rounded-full border border-amber-200 bg-white px-4 py-2 text-sm font-semibold text-amber-700 disabled:opacity-50"
                      >
                        {t(
                          `Deny overtime only (${group.pendingOtIds.length})`,
                          `Negar so as horas extras (${group.pendingOtIds.length})`
                        )}
                      </button>
                    </div>
```

- [ ] **Step 4: Adicione o botao no layout de desktop**

Depois do botao "Negar tudo" da linha 1022-1032:

```tsx
                      <button
                        onClick={() => handleBulkRejectOvertime(group)}
                        disabled={group.pendingOtIds.length === 0 || Boolean(bulkLoadingByUser[userKey])}
                        className="rounded-full border border-amber-200 bg-white px-4 py-2 text-xs font-semibold text-amber-700 disabled:opacity-50"
                      >
                        {t(
                          `Deny overtime only (${group.pendingOtIds.length})`,
                          `Negar so as horas extras (${group.pendingOtIds.length})`
                        )}
                      </button>
```

- [ ] **Step 5: Verifique tipo e bundle**

Run (a partir de `frontend/`): `npm run build`
Expected: `tsc` sem erro. Se `pendingOtIds` faltar em algum ponto que monta `WorkerGroup`, o erro aparece aqui — e o motivo de o campo ser obrigatorio no tipo.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/SupervisorPendingItemsPage.tsx
git commit -m "Negar as horas extras do colaborador em um clique, sem tocar nos pontos" -m "O botao usa o agrupamento por colaborador que a tela ja tem e chama o endpoint
novo de lote so de hora extra: as marcacoes continuam pendentes e aprovaveis
depois. O comentario e opcional aqui, ao contrario do lote de marcacoes ao lado,
onde continua obrigatorio — os dois botoes dividem o mesmo campo de texto.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Levar a coluna nova ao banco

**Files:** nenhum. Passo operacional.

**Interfaces:**
- Consumes: `backend/prisma/schema.prisma` da Task 3.
- Produces: a coluna `TimeEntry.overtimeBufferMinutes` existindo de fato.

**ORDEM DE DEPLOY OBRIGATORIA: `prisma db push` tem que rodar em producao ANTES de subir a imagem de backend desta branch. Nao existe guarda de compatibilidade retroativa no codigo para a ordem inversa.**

O Prisma Client gerado nomeia `overtimeBufferMinutes` em toda escrita de `TimeEntry` e no `select` explicito de `recalcDay.js`, alem de todo `findUnique`/`findMany` sem `select`. Subir este backend ANTES de a coluna existir nao degrada com elegancia: falha clock-out, criacao de registro pelo RH e a maioria das leituras de `TimeEntry` com o erro do Postgres `42703` (coluna inexistente). A ordem inversa — coluna primeiro, codigo antigo rodando — e totalmente segura: a coluna e nullable, o codigo antigo ignora ela, e as linhas existentes leem `NULL` -> 0.

**Esta tarefa exige o dono do projeto presente e nao pode ser executada por um agente sozinho.**

O `DATABASE_URL` de `backend/.env` aponta para **producao** por tunel SSH. Rodar `prisma db push` sem override escreve em producao. O projeto usa `db push`, nunca `prisma migrate`.

- [ ] **Step 1: Confirme para onde o `.env` aponta**

Run (a partir de `backend/`): `grep DATABASE_URL .env`
Expected: a URL do tunel de producao. Se apontar para outro lugar, pare e confirme com o dono antes de continuar.

- [ ] **Step 2: Aplique primeiro no banco local**

Run (a partir de `backend/`), com a URL local explicita na propria linha:

```bash
DATABASE_URL='postgresql://<usuario>:<senha>@localhost:5432/<banco_local>' npx prisma db push
```

Expected: `Your database is now in sync with your Prisma schema.` e a coluna criada como nullable, sem prompt de perda de dados — a coluna e `Int?` e nenhuma linha existente precisa de valor.

- [ ] **Step 3: Verifique o comportamento no stack local antes de producao**

Suba o stack local (`docker-compose.local.yml`, porta 8080; exige rebuild para ver codigo novo) e confirme, com um ADMIN:

1. A tela de ADMIN mostra o campo de tolerancia e salva um valor (por exemplo 10).
2. Um colaborador fecha um turno alguns minutos acima da jornada e o registro nao gera hora extra pendente.
3. Um turno bem acima da jornada gera hora extra pelo excedente **inteiro**.
4. O RH edita esse registro antigo e a hora extra **nao muda**, mesmo depois de o ADMIN trocar a tolerancia.
5. Negar hora extra sem comentario funciona; rejeitar a marcacao sem comentario continua devolvendo erro.

- [ ] **Step 4: Aplique em producao, com o dono do projeto**

Este `db push` tem que rodar ANTES de a imagem de backend desta branch subir em producao — nao ha guarda no codigo para a ordem inversa (ver aviso no topo desta tarefa: backend novo sem a coluna falha com `42703` em clock-out, criacao de registro do RH e a maioria das leituras de `TimeEntry`).

Somente depois de 1-5 acima passarem, e com confirmacao explicita do dono:

```bash
npx prisma db push
```

Expected: mesma saida do passo 2. Registros existentes ficam com `overtimeBufferMinutes = NULL`, que o recalculo trata como 0 — o comportamento que eles ja tinham.

- [ ] **Step 5: Nao ha commit neste passo**

A mudanca de schema ja foi commitada na Task 3. Registre no canal combinado com o dono que o push foi aplicado, e em qual data.

---

## Ordem, paralelismo e verificacao final

- **Sequencial obrigatorio:** 1 → 2 → 3 → (4, 5 em paralelo) → 12.
- **Independentes do buffer:** 7 → 8 → 10 → 11 podem correr em paralelo com 1-6.
- **Task 9** depende so da Task 6.
- **Task 12** e a ultima, com o dono presente.

Antes de dar a feature por pronta, com evidencia na tela e nao de memoria:

```bash
# backend, o mesmo recorte que o CI executa
cd backend
npx jest --runInBand --testPathIgnorePatterns tests/routes/routes.integration.test.js tests/controllers/admin.controller.test.js tests/controllers/finance.controller.test.js tests/controllers/user.controller.test.js tests/controllers/vacation.controller.test.js

# frontend
cd ../frontend
npm test
npm run build
```

As quatro suites de controller em quarentena e a integracao de rotas continuam fora do recorte porque ja estavam vermelhas antes desta feature (`.github/workflows/ci.yml:42-55`). Se voce consertar alguma de passagem, tire-a da lista do CI no mesmo commit.
