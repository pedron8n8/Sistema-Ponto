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

  // Marcacao aberta nao tem minuto RECONHECIDO: o pedaco de agora sai de
  // liveEntryMinutes, com o relogio do servidor. Manter as duas contas
  // separadas e o que deixa a hora extra nascer so do que ja fechou.
  if (!entry.clockIn || !entry.clockOut) return 0;

  // Registro legado que nunca passou por recalcDay: 0 gravado sem decisao
  // nenhuma. Aqui o fallback e o certo — e por isso que o zero autoritativo
  // precisa do overtimeStatus para se distinguir deste.
  return Math.max(0, Math.floor((new Date(entry.clockOut) - new Date(entry.clockIn)) / 60000));
};

/**
 * Teto do relogio ao vivo. Nao existe fechamento automatico de ponto: uma
 * marcacao que ninguem fechou cresce indefinidamente e o painel passa a
 * afirmar uma jornada que ninguem trabalhou — 61h numa quarta-feira, que
 * alguem pode aprovar no automatico e virar banco de horas.
 *
 * 16h fica acima de qualquer jornada legitima, inclusive a que atravessa a
 * meia-noite, entao o teto so encosta em marcacao esquecida. Passado ele o
 * numero congela: continua evidente que o dia esta errado, sem inflar sozinho.
 */
const MAX_LIVE_MINUTES = 16 * 60;

const toDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toPositiveMinutes = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
};

/**
 * Minutos EM CURSO de uma marcacao aberta, com `now` fazendo as vezes de saida
 * virtual. Zero para qualquer marcacao ja fechada — o tempo dela ja esta em
 * recognizedEntryMinutes, e somar as duas contaria o turno duas vezes.
 *
 * A forma e a MESMA do clock-out (calculateOvertimeSummary: duracao em minutos
 * cheios menos a pausa), e e isso que faz o numero reconciliar sem pulo quando
 * a saida e batida: no instante do clock-out, `now` e `clockOut` sao o mesmo
 * instante e as duas contas dao o mesmo minuto.
 *
 * A pausa EM ANDAMENTO entra pelo breakStartedAt, porque breakMinutes so recebe
 * o intervalo depois que ele fecha (o clock-out grava breakSummary.totalMinutes,
 * ja com a pausa aberta dobrada dentro). Sem isso o painel contaria como
 * trabalhado o almoco que esta correndo agora, e o valor CAIRIA na volta da
 * pausa — andar para tras e pior que ficar parado em 00:00.
 */
const liveEntryMinutes = (entry, now = new Date()) => {
  if (!entry || entry.clockOut) return 0;

  const clockIn = toDate(entry.clockIn);
  if (!clockIn) return 0;

  // Zero autoritativo vale tambem para o turno aberto: se a HE foi negada de
  // ponta a ponta, o relogio ao vivo nao pode ressuscitar o que o gestor negou.
  if (isWorkedMinutesAuthoritative(entry) && Number(entry.workedMinutes) === 0) return 0;

  const reference = toDate(now) || new Date();
  const elapsedMinutes = Math.floor((reference.getTime() - clockIn.getTime()) / 60000);

  const breakStartedAt = toDate(entry.breakStartedAt);
  const openBreakMinutes = breakStartedAt
    ? Math.max(0, Math.floor((reference.getTime() - breakStartedAt.getTime()) / 60000))
    : 0;

  // Relogio adiantado no cliente ou marcacao no futuro nao viram tempo
  // negativo: o dia fica em 00:00 ate o instante alcancar a entrada.
  const workedMinutes = Math.max(
    0,
    elapsedMinutes - toPositiveMinutes(entry.breakMinutes) - openBreakMinutes
  );

  // O teto e do numero que o relatorio mostra, aplicado depois da pausa.
  return Math.min(workedMinutes, MAX_LIVE_MINUTES);
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
  now,
}) => {
  const contract = resolveContractDailyMinutes(contractDailyMinutes);
  const rows = Array.isArray(entries) ? entries : [];
  const zone = resolveTimeZone(timeZone);
  // Um unico instante para a semana inteira: o controller passa o MESMO `now`
  // que estampa em generatedAt. Chamar new Date() por marcacao deixaria o
  // rodape "atualizado as" apontando para um instante que nenhum numero usou.
  const reference = toDate(now) || new Date();

  const days = Array.from({ length: DAYS_IN_WEEK }, (_, index) => {
    const dateKey = addDaysToDateKey(weekStart, index);
    const dayEntries = rows.filter((entry) => dayKeyInTimeZone(entry.clockIn, zone) === dateKey);

    // Reconhecido = so o que ja fechou. E a base da hora extra e o numero que
    // nao se mexe entre dois refreshes.
    const recognizedMinutes = dayEntries.reduce(
      (sum, entry) => sum + recognizedEntryMinutes(entry),
      0
    );

    // Em curso = o pedaco de agora do turno aberto. Fica em parcela separada
    // para o dia poder mostrar o total ao vivo sem contaminar a HE.
    const liveMinutes = dayEntries.reduce(
      (sum, entry) => sum + liveEntryMinutes(entry, reference),
      0
    );

    const workedMinutes = recognizedMinutes + liveMinutes;

    // A HE sai do TOTAL do dia e o limiar se aplica UMA vez, nunca por
    // marcacao: o limiar e um conceito diario. Somando HE marcacao por
    // marcacao, duas fatias de 6min com limiar de 10 virariam zero cada uma e o
    // dia perderia 12 minutos de hora extra real.
    //
    // Recalcular em vez de somar entry.overtimeMinutes tambem e proposital: o
    // gravado pode ter nascido antes do limiar existir, e o dia aberto ainda
    // nao tem HE gravada nenhuma.
    //
    // Sai do RECONHECIDO, nao do worked: hora extra e uma decisao sobre jornada
    // cumprida, e turno aberto ainda nao cumpriu nada. Contar o tempo em curso
    // aqui faria a HE aparecer no painel as 17h01 e, pior, nascer PENDING no
    // clock-out de um turno que ainda ia render pausa — e HE pendente bloqueia
    // a aprovacao do ponto. Quem quer o "ja passei do contrato" ao vivo tem
    // overtimeMinutesSoFar em /time/current.
    const overtimeMinutes = applyMinOvertimeMinutes(
      recognizedMinutes - contract,
      minOvertimeMinutes
    );

    return {
      dateKey,
      // Cada linha ganha os minutos reconhecidos ao lado do workedMinutes
      // gravado. Sem isso, quem renderiza a marcacao usaria o valor cru e
      // mostraria a duracao cheia de uma HE negada — a mesma divergencia que
      // este endpoint existe para acabar, so uma linha abaixo do total.
      entries: dayEntries.map((entry) => ({
        ...entry,
        recognizedMinutes: recognizedEntryMinutes(entry),
        liveMinutes: liveEntryMinutes(entry, reference),
      })),
      recognizedMinutes,
      liveMinutes,
      workedMinutes,
      overtimeMinutes,
      isOpen: dayEntries.some((entry) => !entry.clockOut),
    };
  });

  return {
    days,
    totalWorkedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
    totalRecognizedMinutes: days.reduce((sum, day) => sum + day.recognizedMinutes, 0),
    totalLiveMinutes: days.reduce((sum, day) => sum + day.liveMinutes, 0),
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
  liveEntryMinutes,
  MAX_LIVE_MINUTES,
  recognizedEntryMinutes,
};
