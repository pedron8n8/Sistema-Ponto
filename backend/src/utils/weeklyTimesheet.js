const { applyMinOvertimeMinutes, resolveContractDailyMinutes } = require('./overtime');
const {
  isWorkedMinutesAuthoritative,
  assertOvertimeStatusSelected,
} = require('./recognizedMinutes');
const { resolveTimeZone } = require('./dateFilters');

const DAYS_IN_WEEK = 7;

// O backend NAO tem um getDateKeyWithTimeZone — esse helper e do frontend
// (frontend/src/lib). Aqui a chave do dia sai de Intl com locale en-CA, que
// formata YYYY-MM-DD nativamente, no mesmo espirito do formatToParts que
// dateFilters.js ja usa para converter fuso.
//
// Sem o corte por fuso, um clock-in de 21h em Sao Paulo cairia no dia seguinte
// em UTC: o dia apareceria vazio na tela e as horas iriam para o dia errado da
// semana (ou para fora dela, na noite de domingo).
const dayKeyInTimeZone = (value, timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

// Soma de dias sobre a CHAVE do dia (YYYY-MM-DD), nao sobre um instante.
// Date.UTC evita o horario de verao: somar 24h em milissegundos erraria a chave
// na noite de mudanca de fuso, e a chave e so um rotulo de calendario.
//
// Exportado porque o controller monta a JANELA da query com esta mesma conta.
// Se a janela e os buckets nao usarem a mesma aritmetica, a query traz um dia
// que nenhum bucket recolhe (ou deixa de trazer um que existe) e o total da
// semana muda sem ninguem mexer no ponto.
const addDaysToDateKey = (dateKey, days) => {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

// Minutos RECONHECIDOS de uma marcacao. Terceira copia proposital da mesma
// forma (KPI de presenca e worker de alerta tem as suas): unificar a aritmetica
// mudaria em silencio o numero de folha de registros legados, porque o fallback
// do relatorio desconta pausa e os outros nao. O que se compartilha e o
// PREDICADO (isWorkedMinutesAuthoritative) e o SELECT, nao a conta.
const recognizedEntryMinutes = (entry) => {
  assertOvertimeStatusSelected(entry, 'weeklyTimesheet');

  const stored = Number(entry.workedMinutes);
  if (Number.isFinite(stored) && stored > 0) return Math.floor(stored);

  // Zero autoritativo: HE negada de ponta a ponta. Cair no fallback aqui
  // ressuscitaria justamente os minutos que o gestor negou.
  if (isWorkedMinutesAuthoritative(entry)) return 0;

  // Marcacao aberta nao entra no total. O tempo em curso e responsabilidade de
  // quem consome (o painel tem o relogio ao vivo, o MCP nao tem relogio
  // nenhum): `isOpen`/`hasOpenEntry` sinalizam que falta o pedaco de agora.
  if (!entry.clockIn || !entry.clockOut) return 0;

  // Registro legado que nunca passou por recalcDay: 0 gravado sem decisao
  // nenhuma. Aqui o fallback e o certo — e por isso que o zero autoritativo
  // precisa do overtimeStatus para se distinguir deste.
  return Math.max(0, Math.floor((new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000));
};

/**
 * Aritmetica pura, sem Prisma: e o que deixa o relatorio ao vivo, a planilha e
 * a tool do MCP concordarem sem que este arquivo saiba de onde vieram as linhas
 * — e e o que torna o comportamento testavel sem o mock do Prisma.
 *
 * Devolve SEMPRE sete dias, inclusive os sem marcacao: quem consome renderiza a
 * semana inteira sem ter que inventar os buracos, e um dia ausente deixa de ser
 * indistinguivel de um dia zerado.
 */
const buildWeeklyTimesheet = ({
  entries,
  weekStart,
  timeZone,
  contractDailyMinutes,
  minOvertimeMinutes,
}) => {
  const contract = resolveContractDailyMinutes(contractDailyMinutes);
  const rows = Array.isArray(entries) ? entries : [];
  const zone = resolveTimeZone(timeZone);

  const days = Array.from({ length: DAYS_IN_WEEK }, (_, index) => {
    const dateKey = addDaysToDateKey(weekStart, index);
    const dayEntries = rows.filter((entry) => dayKeyInTimeZone(entry.clockIn, zone) === dateKey);

    const workedMinutes = dayEntries.reduce(
      (sum, entry) => sum + recognizedEntryMinutes(entry),
      0
    );

    // A HE sai do TOTAL do dia e o limiar se aplica UMA vez, nunca por
    // marcacao: o limiar e um conceito diario. Somando HE marcacao por
    // marcacao, duas fatias de 6min com limiar de 10 virariam zero cada uma e o
    // dia perderia 12 minutos de hora extra real.
    //
    // Recalcular em vez de somar entry.overtimeMinutes tambem e proposital: o
    // gravado pode ter nascido antes do limiar existir, e o dia aberto ainda
    // nao tem HE gravada nenhuma.
    const overtimeMinutes = applyMinOvertimeMinutes(workedMinutes - contract, minOvertimeMinutes);

    return {
      dateKey,
      // Cada linha ganha os minutos reconhecidos ao lado do workedMinutes
      // gravado. Sem isso, quem renderiza a marcacao usaria o valor cru e
      // mostraria a duracao cheia de uma HE negada — a mesma divergencia que
      // este endpoint existe para acabar, so uma linha abaixo do total.
      entries: dayEntries.map((entry) => ({
        ...entry,
        recognizedMinutes: recognizedEntryMinutes(entry),
      })),
      workedMinutes,
      overtimeMinutes,
      isOpen: dayEntries.some((entry) => !entry.clockOut),
    };
  });

  return {
    days,
    totalWorkedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
    // Soma da HE JA limiarizada por dia. Aplicar o limiar sobre a soma da
    // semana seria outra regra (e ilegal): o limiar do art. 58 §1º e diario.
    totalOvertimeMinutes: days.reduce((sum, day) => sum + day.overtimeMinutes, 0),
    hasOpenEntry: days.some((day) => day.isOpen),
  };
};

module.exports = {
  DAYS_IN_WEEK,
  addDaysToDateKey,
  buildWeeklyTimesheet,
  dayKeyInTimeZone,
  recognizedEntryMinutes,
};
