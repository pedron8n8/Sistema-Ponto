const { buildWeeklyTimesheet, addDaysToDateKey } = require('../../src/utils/weeklyTimesheet');

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
    expect(result.totalOvertimeMinutes).toBe(0);
    expect(result.hasOpenEntry).toBe(false);
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
    // E nem por linha: quem renderiza a marcacao tambem precisa ver 0.
    expect(result.days[0].entries[1].recognizedMinutes).toBe(0);
  });

  it('ainda cura registro legado sem calculo', () => {
    const legacy = entry({ workedMinutes: 0, overtimeStatus: null });
    const result = buildWeeklyTimesheet({ ...base, entries: [legacy] });

    expect(result.days[0].workedMinutes).toBe(480);
    expect(result.days[0].entries[0].recognizedMinutes).toBe(480);
  });

  it('aplica o limiar de HE curta ao total do DIA', () => {
    const short = entry({ workedMinutes: 486, overtimeMinutes: 6 });
    const result = buildWeeklyTimesheet({ ...base, minOvertimeMinutes: 10, entries: [short] });

    expect(result.days[0].overtimeMinutes).toBe(0);
    // O tempo trabalhado e fato e nao muda por causa de uma regra de HE.
    expect(result.days[0].workedMinutes).toBe(486);
  });

  it('tira a HE do TOTAL do dia, nao da fatia de cada marcacao', () => {
    // Nenhuma das duas marcacoes passa do contrato sozinha, mas juntas passam
    // em 12min. O bug que isto trava: calcular HE por marcacao daria 0 no dia
    // inteiro e apagaria 12 minutos de hora extra real.
    const manha = entry({ id: 'a', workedMinutes: 246 });
    const tarde = entry({
      id: 'b',
      clockIn: new Date('2026-08-31T21:00:00Z'),
      clockOut: new Date('2026-08-31T23:00:00Z'),
      workedMinutes: 246,
    });

    const result = buildWeeklyTimesheet({ ...base, minOvertimeMinutes: 10, entries: [manha, tarde] });

    expect(result.days[0].workedMinutes).toBe(492);
    expect(result.days[0].overtimeMinutes).toBe(12);
  });

  it('conta a HE em cheio a partir do limiar (corte, nao franquia)', () => {
    const acima = entry({ workedMinutes: 491 });
    const result = buildWeeklyTimesheet({ ...base, minOvertimeMinutes: 10, entries: [acima] });

    // 11 minutos continuam 11, nao 1.
    expect(result.days[0].overtimeMinutes).toBe(11);
  });

  it('marca o dia com marcacao aberta', () => {
    const open = entry({ clockOut: null, workedMinutes: 0 });
    const result = buildWeeklyTimesheet({
      ...base,
      entries: [open],
      now: new Date('2026-08-31T14:30:00Z'),
    });

    expect(result.days[0].isOpen).toBe(true);
    expect(result.hasOpenEntry).toBe(true);
    // Entrou 12:00, agora sao 14:30: o dia ja vale 2h30, nao 00:00.
    expect(result.days[0].workedMinutes).toBe(150);
  });

  it('comeca a contar no primeiro minuto depois da entrada', () => {
    const open = entry({ clockOut: null, workedMinutes: 0 });

    // 30s depois ainda nao fechou um minuto: HH:MM nao tem onde mostrar isso.
    const trintaSegundos = buildWeeklyTimesheet({
      ...base,
      entries: [open],
      now: new Date('2026-08-31T12:00:30Z'),
    });
    const umMinuto = buildWeeklyTimesheet({
      ...base,
      entries: [open],
      now: new Date('2026-08-31T12:01:00Z'),
    });

    expect(trintaSegundos.days[0].workedMinutes).toBe(0);
    expect(umMinuto.days[0].workedMinutes).toBe(1);
  });

  it('faz o dia do turno aberto subir junto com o relogio', () => {
    const open = entry({ clockOut: null, workedMinutes: 0 });

    const primeiro = buildWeeklyTimesheet({
      ...base,
      entries: [open],
      now: new Date('2026-08-31T13:00:00Z'),
    });
    const segundo = buildWeeklyTimesheet({
      ...base,
      entries: [open],
      now: new Date('2026-08-31T13:20:00Z'),
    });

    expect(primeiro.days[0].workedMinutes).toBe(60);
    expect(segundo.days[0].workedMinutes).toBe(80);
    // O total da semana acompanha, senao o rodape contradiz os cartoes.
    expect(segundo.totalWorkedMinutes).toBe(80);
  });

  it('reconcilia sem pulo no clock-out', () => {
    const instante = new Date('2026-08-31T20:00:00Z');
    const aberto = entry({ clockOut: null, workedMinutes: 0, breakMinutes: 60 });

    const aoVivo = buildWeeklyTimesheet({ ...base, entries: [aberto], now: instante });

    // Mesma marcacao, fechada nesse exato instante: o clock-out grava
    // duracao - pausa, que e a mesma conta do tempo ao vivo.
    const fechado = buildWeeklyTimesheet({
      ...base,
      entries: [entry({ clockOut: instante, workedMinutes: 420, breakMinutes: 60 })],
      now: instante,
    });

    expect(aoVivo.days[0].workedMinutes).toBe(420);
    expect(fechado.days[0].workedMinutes).toBe(420);
  });

  it('desconta a pausa em andamento do tempo ao vivo', () => {
    // Saiu para almoco 13:00 e ainda nao voltou; agora sao 14:00.
    const emPausa = entry({
      clockOut: null,
      workedMinutes: 0,
      breakMinutes: 0,
      breakStartedAt: new Date('2026-08-31T13:00:00Z'),
    });

    const result = buildWeeklyTimesheet({
      ...base,
      entries: [emPausa],
      now: new Date('2026-08-31T14:00:00Z'),
    });

    // 2h decorridas menos 1h de pausa correndo.
    expect(result.days[0].workedMinutes).toBe(60);
  });

  it('soma marcacao fechada e aberta no mesmo dia', () => {
    const manha = entry({ id: 'a', workedMinutes: 240 });
    const tarde = entry({
      id: 'b',
      clockIn: new Date('2026-08-31T21:00:00Z'),
      clockOut: null,
      workedMinutes: 0,
    });

    const result = buildWeeklyTimesheet({
      ...base,
      entries: [manha, tarde],
      now: new Date('2026-08-31T22:00:00Z'),
    });

    expect(result.days[0].recognizedMinutes).toBe(240);
    expect(result.days[0].liveMinutes).toBe(60);
    expect(result.days[0].workedMinutes).toBe(300);
  });

  it('nao classifica hora extra enquanto o turno esta aberto', () => {
    // Ja fechou o contrato do dia e continua batendo: worked sobe, HE espera o
    // fechamento. HE pendente bloqueia aprovacao — nao se cria no meio do turno.
    const fechada = entry({ id: 'a', workedMinutes: 480 });
    const aberta = entry({
      id: 'b',
      clockIn: new Date('2026-08-31T21:00:00Z'),
      clockOut: null,
      workedMinutes: 0,
    });

    const result = buildWeeklyTimesheet({
      ...base,
      entries: [fechada, aberta],
      now: new Date('2026-08-31T22:00:00Z'),
    });

    expect(result.days[0].workedMinutes).toBe(540);
    expect(result.days[0].overtimeMinutes).toBe(0);
    expect(result.totalOvertimeMinutes).toBe(0);
  });

  it('nao ressuscita HE negada pelo relogio ao vivo', () => {
    const negadaEAberta = entry({
      clockOut: null,
      workedMinutes: 0,
      overtimeStatus: 'REJECTED',
    });

    const result = buildWeeklyTimesheet({
      ...base,
      entries: [negadaEAberta],
      now: new Date('2026-08-31T20:00:00Z'),
    });

    expect(result.days[0].workedMinutes).toBe(0);
  });

  it('nao produz tempo negativo com marcacao no futuro', () => {
    const futura = entry({ clockOut: null, workedMinutes: 0 });

    const result = buildWeeklyTimesheet({
      ...base,
      entries: [futura],
      now: new Date('2026-08-31T11:00:00Z'),
    });

    expect(result.days[0].workedMinutes).toBe(0);
  });

  it('poe o turno aberto que cruza a meia-noite no dia da ENTRADA', () => {
    // Entrou 21h de domingo em Sao Paulo (00h30Z de segunda) e segue aberto na
    // madrugada. O dia do ponto e o dia de quem bateu, como ja vale para as
    // marcacoes fechadas.
    const madrugada = entry({
      clockIn: new Date('2026-09-07T00:30:00Z'),
      clockOut: null,
      workedMinutes: 0,
    });

    const result = buildWeeklyTimesheet({
      ...base,
      timeZone: 'America/Sao_Paulo',
      entries: [madrugada],
      now: new Date('2026-09-07T02:30:00Z'),
    });

    expect(result.days[6].dateKey).toBe('2026-09-06');
    expect(result.days[6].workedMinutes).toBe(120);
    expect(result.totalWorkedMinutes).toBe(120);
  });

  it('nao mexe no dia ja fechado quando o relogio anda', () => {
    const cedo = buildWeeklyTimesheet({
      ...base,
      entries: [entry()],
      now: new Date('2026-08-31T20:00:00Z'),
    });
    const tarde = buildWeeklyTimesheet({
      ...base,
      entries: [entry()],
      now: new Date('2026-09-02T20:00:00Z'),
    });

    expect(cedo.days[0].workedMinutes).toBe(480);
    expect(tarde.days[0].workedMinutes).toBe(480);
    expect(tarde.days[0].liveMinutes).toBe(0);
  });

  it('coloca a marcacao no dia do FUSO do colaborador, nao no dia UTC', () => {
    // 21h30 de domingo em Sao Paulo = 00h30 de segunda em UTC. Sem o corte por
    // fuso a marcacao sairia da semana pela borda de cima.
    const noite = entry({
      clockIn: new Date('2026-09-07T00:30:00Z'),
      clockOut: new Date('2026-09-07T02:30:00Z'),
      workedMinutes: 120,
    });

    const result = buildWeeklyTimesheet({
      ...base,
      timeZone: 'America/Sao_Paulo',
      entries: [noite],
    });

    expect(result.days[6].dateKey).toBe('2026-09-06');
    expect(result.days[6].workedMinutes).toBe(120);
    expect(result.totalWorkedMinutes).toBe(120);
  });

  it('ignora marcacao fora da semana em vez de somar no dia errado', () => {
    const foraDaSemana = entry({
      clockIn: new Date('2026-09-08T12:00:00Z'),
      clockOut: new Date('2026-09-08T20:00:00Z'),
    });

    const result = buildWeeklyTimesheet({ ...base, entries: [foraDaSemana] });

    expect(result.totalWorkedMinutes).toBe(0);
  });

  it('usa o contrato do colaborador para achar a HE', () => {
    const seisHoras = entry({ workedMinutes: 400 });
    const result = buildWeeklyTimesheet({
      ...base,
      contractDailyMinutes: 360,
      entries: [seisHoras],
    });

    expect(result.days[0].overtimeMinutes).toBe(40);
  });

  it('soma a HE dia a dia, sem aplicar o limiar sobre a semana', () => {
    // Dois dias com 6min de sobra e limiar de 10: cada dia zera. Se o limiar
    // fosse aplicado sobre a soma da semana (12min), apareceria HE que nao
    // existe em nenhum dia.
    const segunda = entry({ workedMinutes: 486 });
    const terca = entry({
      id: 'e2',
      clockIn: new Date('2026-09-01T12:00:00Z'),
      clockOut: new Date('2026-09-01T20:06:00Z'),
      workedMinutes: 486,
    });

    const result = buildWeeklyTimesheet({
      ...base,
      minOvertimeMinutes: 10,
      entries: [segunda, terca],
    });

    expect(result.totalWorkedMinutes).toBe(972);
    expect(result.totalOvertimeMinutes).toBe(0);
  });
});

describe('addDaysToDateKey', () => {
  it('atravessa a virada de mes', () => {
    expect(addDaysToDateKey('2026-08-31', 6)).toBe('2026-09-06');
    expect(addDaysToDateKey('2026-08-31', 7)).toBe('2026-09-07');
  });
});
