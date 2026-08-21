const { HR_UP, str, int, obj, date, dateRange } = require('./_shared');

const AUTO_APPROVE_NOTE =
  'Escritas de RH entram JA APROVADAS (nao passam pela fila do supervisor), geram linha de ' +
  'auditoria com o autor e disparam e-mail ao colaborador. Recalculam o dia inteiro: horas ' +
  'trabalhadas, horas extras e o acumulo no banco de horas.';

const entryFields = () => ({
  clockIn: str('Entrada, ISO 8601 com fuso, ex.: 2026-08-19T09:00:00-03:00.'),
  clockOut: str('Saida, ISO 8601 com fuso.'),
  breakMinutes: int('Minutos de intervalo descontados.', { minimum: 0 }),
  notes: str('Motivo da correcao. Fica visivel na auditoria.'),
});

module.exports = [
  {
    name: 'timesheet_get_day',
    title: 'Fechamento do dia (todos)',
    titleEn: 'Whole-day timesheet',
    group: 'timesheet',
    access: 'read',
    roles: HR_UP,
    plans: null,
    method: 'GET',
    path: '/hr/daily',
    description:
      'Tempo trabalhado por todos os colaboradores do tenant em um dia. Visao de fechamento do RH. ' +
      'Sem `date`, usa hoje.',
    inputSchema: obj({ date: date('Dia a consultar. Padrao: hoje.') }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'timesheet_get_user_days',
    title: 'Folha de um colaborador',
    titleEn: 'One user timesheet',
    group: 'timesheet',
    access: 'read',
    roles: HR_UP,
    plans: null,
    method: 'GET',
    path: '/hr/users/:userId/daily',
    description:
      'Folha de ponto de um colaborador agrupada por dia. Sem periodo informado, retorna os ' +
      'ultimos 30 dias. Use antes de timesheet_update_entry para achar o dia a corrigir e ' +
      'confirmar se falta marcacao (dia vazio) ou se ela esta errada.',
    inputSchema: obj({ userId: str('Id do colaborador (uuid).'), ...dateRange() }, ['userId']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'timesheet_create_entry',
    title: 'Lancar dia esquecido',
    titleEn: 'Create missing entry',
    group: 'timesheet',
    access: 'write',
    roles: HR_UP,
    plans: null,
    method: 'POST',
    path: '/hr/users/:userId/entries',
    description:
      'Cria retroativamente uma marcacao para um colaborador que esqueceu de bater ponto. ' +
      `${AUTO_APPROVE_NOTE} Confirme com timesheet_get_user_days que o dia esta realmente vazio: ` +
      'esta tool cria uma marcacao nova, nao corrige uma existente (para isso use ' +
      'timesheet_update_entry).',
    inputSchema: obj({ userId: str('Id do colaborador (uuid).'), ...entryFields() }, ['userId', 'clockIn']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'timesheet_update_entry',
    title: 'Corrigir marcacao',
    titleEn: 'Update entry',
    group: 'timesheet',
    access: 'write',
    roles: HR_UP,
    plans: null,
    method: 'PATCH',
    path: '/hr/entries/:id',
    description:
      'Corrige horarios, intervalo ou observacao de uma marcacao existente. Este e o unico caminho ' +
      `para alterar HORARIO — time_update_notes so muda o texto. ${AUTO_APPROVE_NOTE}`,
    inputSchema: obj({ id: str('Id da marcacao (uuid).'), ...entryFields() }, ['id']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'timesheet_delete_entry',
    title: 'Excluir marcacao',
    titleEn: 'Delete entry',
    group: 'timesheet',
    access: 'write',
    roles: HR_UP,
    plans: null,
    method: 'DELETE',
    path: '/hr/entries/:id',
    description:
      'Apaga uma marcacao, recalcula o dia e REVERTE o acumulo dela no banco de horas. ' +
      'IRREVERSIVEL. Antes de apagar, considere corrigir com timesheet_update_entry; so apague ' +
      'marcacoes duplicadas ou lancadas por engano, e confirme com a pessoa antes.',
    inputSchema: obj({ id: str('Id da marcacao (uuid).') }, ['id']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    sensitive: true,
  },
];
