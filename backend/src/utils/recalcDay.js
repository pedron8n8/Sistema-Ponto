const { prisma } = require('../config/database');
const { calculateIncrementalOvertimeSummary } = require('./overtime');
const { accrueBankHours } = require('./bankHours');
const { getStartOfDay, getEndOfDay } = require('./timeCalculations');

/**
 * Reverte créditos de banco de horas (ACCRUAL) ainda PENDENTES vinculados a um registro,
 * ajustando o saldo do colaborador. Usado antes de recalcular ou ao excluir um registro,
 * para que o recálculo não gere contagem dupla.
 *
 * Créditos já PAGOS não são revertidos (não há como "despagar"); apenas têm o vínculo
 * com o registro removido pelo chamador, quando necessário.
 */
/**
 * Le o que precisa ser revertido de banco de horas para VARIAS marcacoes de uma
 * vez, e devolve um plano — sem escrever nada.
 *
 * Existe para que o reject em lote possa reverter DENTRO da sua transacao. Antes
 * ele chamava reverseEntryBankHours num laco sequencial ANTES da transacao: o
 * accrual ja tinha sido apagado e o saldo decrementado quando a transacao rodava,
 * entao uma falha dela deixava as marcacoes PENDING com o credito de banco de
 * horas perdido, sem nenhuma escrita compensatoria. Era tambem o gargalo que
 * limitava o lote (N x 3 queries sequenciais viram 1 leitura).
 *
 * A LEITURA fica de fora de proposito: ler antes nao causa dano, e manter as
 * escritas em `$transaction([...])` (em lote, nao interativa) evita o timeout de
 * transacao interativa que 200 registros x 4 queries estouraria.
 *
 * @param {string[]} timeEntryIds
 * @returns {Promise<{accrualIds: string[], decrementsByUser: Array<{userId: string, minutes: number}>, reversedMinutes: number}>}
 */
const planEntryBankHoursReversal = async (timeEntryIds) => {
  const ids = (Array.isArray(timeEntryIds) ? timeEntryIds : []).filter(Boolean);
  if (!ids.length) return { accrualIds: [], decrementsByUser: [], reversedMinutes: 0 };

  const pendingAccruals = await prisma.bankHoursEntry.findMany({
    where: {
      timeEntryId: { in: ids },
      type: 'ACCRUAL',
      paymentStatus: 'PENDING',
      expiredAt: null,
    },
    select: { id: true, minutes: true, userId: true },
  });

  if (!pendingAccruals.length) return { accrualIds: [], decrementsByUser: [], reversedMinutes: 0 };

  // Agrupa por colaborador: um lote pode cobrir varias pessoas, e o saldo vive
  // na linha de cada uma.
  const byUser = new Map();
  let reversedMinutes = 0;

  for (const accrual of pendingAccruals) {
    const minutes = Math.max(0, accrual.minutes);
    reversedMinutes += minutes;
    byUser.set(accrual.userId, (byUser.get(accrual.userId) || 0) + minutes);
  }

  return {
    accrualIds: pendingAccruals.map((item) => item.id),
    decrementsByUser: [...byUser.entries()]
      .filter(([, minutes]) => minutes > 0)
      .map(([userId, minutes]) => ({ userId, minutes })),
    reversedMinutes,
  };
};

const reverseEntryBankHours = async (timeEntryId) => {
  if (!timeEntryId) return { reversedMinutes: 0 };

  const pendingAccruals = await prisma.bankHoursEntry.findMany({
    where: {
      timeEntryId,
      type: 'ACCRUAL',
      paymentStatus: 'PENDING',
      expiredAt: null,
    },
    select: { id: true, minutes: true, userId: true },
  });

  if (!pendingAccruals.length) return { reversedMinutes: 0 };

  const reversedMinutes = pendingAccruals.reduce((sum, item) => sum + Math.max(0, item.minutes), 0);
  const userId = pendingAccruals[0].userId;

  await prisma.bankHoursEntry.deleteMany({
    where: { id: { in: pendingAccruals.map((item) => item.id) } },
  });

  if (reversedMinutes > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { bankHoursBalanceMinutes: { decrement: reversedMinutes } },
    });
  }

  return { reversedMinutes };
};

/**
 * Recalcula minutos trabalhados, horas extras (50/100) e banco de horas de TODOS os
 * registros fechados (com clockOut) de um colaborador em um determinado dia.
 *
 * A divisão de horas extras depende da ordem cronológica das entradas do dia
 * (`calculateIncrementalOvertimeSummary`), por isso reprocessamos o dia inteiro em ordem.
 * Idempotente: reverte o crédito anterior de cada registro antes de re-creditar.
 *
 * @param {{ userId: string, date: Date|string }} params
 */
const recalculateUserDay = async ({ userId, date }) => {
  const dayStart = getStartOfDay(date);
  const dayEnd = getEndOfDay(date);

  const userConfig = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      contractDailyMinutes: true,
      // O limiar de HE curta e do TENANT, nao do colaborador: quem habilita e o
      // ADMIN/INTEGRATOR da conta. Vem junto nesta mesma query, pela relacao,
      // para nao custar uma ida extra ao banco por dia recalculado.
      organizationAdmin: { select: { overtimeMinMinutes: true } },
    },
  });

  // Colaborador sem dono de organizacao (base legada) simplesmente nao tem
  // limiar — o comportamento volta a ser o de antes.
  const minOvertimeMinutes = userConfig?.organizationAdmin?.overtimeMinMinutes ?? null;

  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      clockIn: { gte: dayStart, lte: dayEnd },
      clockOut: { not: null },
    },
    orderBy: { clockIn: 'asc' },
    select: { id: true, clockIn: true, clockOut: true, breakMinutes: true, status: true, overtimeStatus: true },
  });

  let workedMinutesBeforeEntry = 0;
  const results = [];

  for (const entry of entries) {
    // Remove crédito pendente anterior deste registro para evitar contagem dupla.
    await reverseEntryBankHours(entry.id);

    const overtime = calculateIncrementalOvertimeSummary({
      clockIn: entry.clockIn,
      clockOut: entry.clockOut,
      contractDailyMinutes: userConfig?.contractDailyMinutes,
      workedMinutesBeforeEntry,
      breakMinutes: entry.breakMinutes,
      minOvertimeMinutes,
    });

    // HE negada é definitiva: mantém efeito zerado e não re-credita banco de horas,
    // mesmo que o recálculo do dia volte a produzir horas extras para este registro.
    if (entry.overtimeStatus === 'REJECTED') {
      // O tempo negado sai do reconhecido: turno de 12h numa jornada de 8h com a
      // HE negada vale 480min, não 720. Sem descontar aqui também, o recálculo
      // do dia (edição do RH, batida offline sincronizada) regravava o valor
      // cheio e desfazia em silêncio o que o supervisor negou.
      //
      // Desconta a HE da própria entrada em vez de cortar no contrato: num dia
      // com várias entradas a HE é incremental e a segunda entrada pode ser HE
      // de ponta a ponta, onde cortar em 480 daria número errado.
      const recognizedMinutes = Math.max(0, overtime.workedMinutes - overtime.overtimeMinutes);

      await prisma.timeEntry.update({
        where: { id: entry.id },
        data: {
          workedMinutes: recognizedMinutes,
          overtimeMinutes: 0,
          overtimeMinutes50: 0,
          overtimeMinutes100: 0,
          overtimePercent: 0,
          bankHoursAccruedMinutes: 0,
        },
      });

      // Acumula o tempo CHEIO, não o reconhecido: o colaborador trabalhou
      // aqueles minutos e negar é sobre reconhecimento, não sobre rebobinar o
      // relógio do dia. É também neutro para a HE das entradas seguintes — a
      // diferença cai inteira na faixa acima do contrato, então otAfter-otBefore
      // não muda (coberto por recalcDay.test.js).
      workedMinutesBeforeEntry += overtime.workedMinutes;
      results.push({
        id: entry.id,
        workedMinutes: recognizedMinutes,
        overtimeMinutes: 0,
        bankHoursAccruedMinutes: 0,
      });
      continue;
    }

    // GRAVA PRIMEIRO, CREDITA DEPOIS. accrueBankHours relê o registro no banco
    // para decidir se o crédito está represado (batida offline aguardando o
    // supervisor). Creditando antes deste update, um registro represado que
    // ESTE update promove a APPROVED era lido ainda como PENDING: o crédito
    // ficava represado e nada mais o soltava — as rotas de decisão de HE
    // recusam registro que já saiu de PENDING. Cenário real: colaborador
    // sincroniza turno offline com HE, o RH corrige o registro antes de o
    // supervisor decidir, e as horas somem do banco sem erro nenhum.
    //
    // Escolhido em vez de passar o status alvo por parâmetro para accrueBankHours:
    // o guard continua decidindo só a partir do que está COMMITADO no banco, sem
    // um parâmetro "confie em mim" que um chamador futuro possa passar sem nunca
    // gravar a aprovação. Mesma ordem de releaseDeferredBankHours no supervisor.
    await prisma.timeEntry.update({
      where: { id: entry.id },
      data: {
        workedMinutes: overtime.workedMinutes,
        overtimeMinutes: overtime.overtimeMinutes,
        overtimeMinutes50: overtime.overtimeMinutes50,
        overtimeMinutes100: overtime.overtimeMinutes100,
        overtimePercent: overtime.overtimePercent,
        // Zera aqui e carimba o valor real depois: reverseEntryBankHours acabou
        // de apagar o crédito anterior, então deixar o número velho na coluna
        // enquanto o crédito novo não sai mostraria banco que não existe.
        bankHoursAccruedMinutes: 0,
        // Decisão de HE: aprovação sobrevive a mudanças de valor; registros já aprovados
        // (edição/criação do HR) auto-aprovam a HE; sem HE, limpa a pendência.
        overtimeStatus:
          overtime.overtimeMinutes > 0
            ? entry.overtimeStatus === 'APPROVED' || entry.status !== 'PENDING'
              ? 'APPROVED'
              : 'PENDING'
            : null,
      },
    });

    // O update acima ja commitou. Se o credito estourar aqui sem protecao, o
    // registro fica APPROVED, uncredited e com o marcador de represado — e toda
    // rota de supervisor passa a devolver 409 nele. O estado se recupera no
    // proximo recalculo, mas ate la a hora extra some da vista. Mesmo try/catch
    // de releaseDeferredBankHours, que protege exatamente esta chamada.
    let bankHoursResult = { accruedMinutes: 0, deferredMinutes: 0 };
    try {
      bankHoursResult = await accrueBankHours({
        userId,
        overtimeMinutes: overtime.overtimeMinutes,
        timeEntryId: entry.id,
      });

      if (bankHoursResult.accruedMinutes > 0) {
        await prisma.timeEntry.update({
          where: { id: entry.id },
          data: { bankHoursAccruedMinutes: bankHoursResult.accruedMinutes },
        });
      }
    } catch (error) {
      console.error(
        `⚠️ Recalculo concluido mas banco de horas falhou (entry ${entry.id}):`,
        error
      );
    }

    workedMinutesBeforeEntry += overtime.workedMinutes;
    results.push({
      id: entry.id,
      workedMinutes: overtime.workedMinutes,
      overtimeMinutes: overtime.overtimeMinutes,
      bankHoursAccruedMinutes: bankHoursResult.accruedMinutes,
    });
  }

  return results;
};

module.exports = {
  recalculateUserDay,
  reverseEntryBankHours,
  planEntryBankHoursReversal,
};
