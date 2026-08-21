const {
  SUPERVISOR_UP, HR_UP, ADMIN_UP, GROWTH_UP,
  str, obj, NO_ARGS, paging, dateRange, date, enumOf, int, num,
  ENTRY_STATUS, SCOPE_NOTE,
} = require('./_shared');

const orgFilters = () => ({
  branch: str('Filtra por filial.'),
  department: str('Filtra por departamento.'),
  team: str('Filtra por equipe.'),
});

module.exports = [
  {
    name: 'team_list_members',
    title: 'Listar equipe',
    titleEn: 'List team',
    group: 'team',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'GET',
    path: '/supervisor/team',
    description: `Roster da equipe sob quem autorizou a conexao, com role, supervisor e jornada contratada. ${SCOPE_NOTE}`,
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_get_presence',
    title: 'Quem esta batido agora',
    titleEn: 'Live presence',
    group: 'team',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'GET',
    path: '/supervisor/presence',
    description:
      'Snapshot de presenca: quem esta trabalhando, em intervalo, ausente ou atrasado agora. ' +
      'Este e o equivalente pontual do stream SSE do painel, que nao e exposto via MCP. ' +
      SCOPE_NOTE,
    inputSchema: obj(orgFilters()),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_get_hours_kpis',
    title: 'KPIs de horas da equipe',
    titleEn: 'Team hours KPIs',
    group: 'team',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'GET',
    path: '/supervisor/kpis/hours',
    description:
      'Horas previstas vs. trabalhadas vs. extras por colaborador no periodo, com as opcoes de ' +
      'filtro disponiveis. Bom para "quem esta acima ou abaixo da jornada". ' +
      SCOPE_NOTE,
    inputSchema: obj({
      userId: str('Restringe a um colaborador (uuid).'),
      period: enumOf(['daily', 'weekly', 'monthly'], 'Granularidade. Padrao weekly.'),
      ...dateRange(),
      ...orgFilters(),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_list_entries',
    title: 'Marcacoes da equipe',
    titleEn: 'Team time entries',
    group: 'team',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'GET',
    path: '/supervisor/entries',
    description:
      'Marcacoes de ponto da equipe, paginadas. O padrao e status=PENDING, ou seja, a fila de ' +
      'aprovacao. Chame antes de approvals_approve ou approvals_reject para saber o que esta ' +
      'pendente e quais marcacoes tem hora extra a decidir primeiro. ' +
      SCOPE_NOTE,
    inputSchema: obj({
      ...paging(20),
      status: enumOf([...ENTRY_STATUS, 'ALL'], 'Situacao. Padrao PENDING.'),
      userId: str('Restringe a um colaborador (uuid).'),
      groupId: str('Restringe a um grupo ou equipe.'),
      ...dateRange(),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_get_entry',
    title: 'Marcacao da equipe com historico',
    titleEn: 'Team entry with history',
    group: 'team',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'GET',
    path: '/supervisor/entries/:id',
    description:
      'Uma marcacao da equipe com o rastro completo de aprovacoes: quem aprovou, rejeitou ou ' +
      'pediu correcao, quando e com que comentario.',
    inputSchema: obj({ id: str('Id da marcacao (uuid).') }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_get_daily_breakdown',
    title: 'Fechamento de um dia',
    titleEn: 'Daily breakdown',
    group: 'team',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'GET',
    path: '/reports/daily-breakdown',
    description:
      'Detalhamento de um unico dia por colaborador: entradas, saidas, intervalos, horas extras. ' +
      'Mais preciso que team_get_hours_kpis quando a pergunta e sobre uma data especifica. ' +
      SCOPE_NOTE,
    inputSchema: obj({
      date: date('Dia a detalhar.'),
      userId: str('Restringe a um colaborador (uuid).'),
      teamId: str('Restringe a uma equipe.'),
      timeZone: str('Fuso IANA para o corte do dia, ex.: America/Sao_Paulo.'),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_list_hr_roster',
    title: 'Roster do tenant (RH)',
    titleEn: 'HR roster',
    group: 'team',
    access: 'read',
    roles: HR_UP,
    plans: null,
    method: 'GET',
    path: '/hr/team',
    description:
      'Roster do tenant inteiro na visao de RH, com jornada contratada, fuso e valor-hora. Mais ' +
      'completo que team_list_members, mas exige role HR, INTEGRATOR ou ADMIN.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_get_admin_stats',
    title: 'Estatisticas do tenant',
    titleEn: 'Tenant stats',
    group: 'team',
    access: 'read',
    roles: ADMIN_UP,
    plans: null,
    method: 'GET',
    path: '/admin/stats',
    description:
      'Numeros agregados do tenant no periodo: colaboradores ativos, marcacoes, pendencias e ' +
      'horas extras. Visao de ADMIN, cobre o tenant inteiro.',
    inputSchema: obj(dateRange()),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_get_overview',
    title: 'Panorama de equipes',
    titleEn: 'Teams overview',
    group: 'team',
    access: 'read',
    roles: ADMIN_UP,
    plans: null,
    method: 'GET',
    path: '/admin/team-overview',
    description: 'Todas as equipes do tenant com seus supervisores e contagem de membros.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_get_audit_trail',
    title: 'Auditoria de uma marcacao',
    titleEn: 'Entry audit trail',
    group: 'team',
    access: 'read',
    roles: ADMIN_UP,
    plans: null,
    method: 'GET',
    path: '/admin/audit/:timeEntryId',
    description:
      'Trilha de auditoria completa de uma marcacao. Use quando a pergunta for "quem mexeu nisso ' +
      'e quando".',
    inputSchema: obj({ timeEntryId: str('Id da marcacao (uuid).') }, ['timeEntryId']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_list_user_entries',
    title: 'Marcacoes de um colaborador',
    titleEn: 'Entries of one user',
    group: 'team',
    access: 'read',
    roles: ADMIN_UP,
    plans: null,
    method: 'GET',
    path: '/admin/users/:userId/entries',
    description: 'Historico paginado de marcacoes de um colaborador especifico do tenant.',
    inputSchema: obj({
      userId: str('Id do colaborador (uuid).'),
      ...paging(20),
      status: enumOf(ENTRY_STATUS, 'Situacao da aprovacao.'),
      ...dateRange(),
    }, ['userId']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'team_get_vacation_calendar',
    title: 'Calendario de ausencias',
    titleEn: 'Absence calendar',
    group: 'team',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: GROWTH_UP,
    method: 'GET',
    path: '/vacations/team/calendar',
    description:
      'Calendario mensal de ferias e ausencias da equipe, sinalizando os dias em que a presenca ' +
      'cai abaixo do minimo. Requer plano GROWTH ou PRO. Use para responder "posso aprovar essas ' +
      'ferias sem furar a equipe" antes de vacations_supervisor_review.',
    inputSchema: obj({
      year: int('Ano. Padrao: ano atual.', { minimum: 2000 }),
      month: int('Mes de 1 a 12. Padrao: mes atual.', { minimum: 1, maximum: 12 }),
      minPresencePercent: num('Presenca minima aceitavel em porcentagem. Padrao 70.', {
        minimum: 0,
        maximum: 100,
      }),
    }),
    annotations: { readOnlyHint: true },
  },
];
