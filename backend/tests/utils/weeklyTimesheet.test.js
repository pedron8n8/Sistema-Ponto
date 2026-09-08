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
    const result = buildWeeklyTimesheet({ ...base, entries: [open] });

    expect(result.days[0].isOpen).toBe(true);
    expect(result.hasOpenEntry).toBe(true);
    // Marcacao aberta nao entra no total: o pedaco de agora e de quem consome.
    expect(result.days[0].workedMinutes).toBe(0);
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
