const {
  ALL_ROLES, SUPERVISOR_UP, HR_UP, GROWTH_UP,
  str, obj, NO_ARGS, date, enumOf,
} = require('./_shared');

const PLAN_NOTE = 'Todo o modulo de ferias requer plano GROWTH ou PRO.';

// Maquina de estados: REQUESTED -> SUPERVISOR_APPROVED -> HR_CONFIRMED,
// com SUPERVISOR_REJECTED / HR_REJECTED / CANCELED como terminais.
const FLOW_NOTE =
  'Fluxo em dois estagios: REQUESTED -> SUPERVISOR_APPROVED -> HR_CONFIRMED. O RH so ve o pedido ' +
  'depois que o supervisor aprovou.';

module.exports = [
  {
    name: 'vacations_list_mine',
    title: 'Minhas ferias',
    titleEn: 'My time off',
    group: 'vacations',
    access: 'read',
    roles: ALL_ROLES,
    plans: GROWTH_UP,
    method: 'GET',
    path: '/vacations/me',
    description:
      `Pedidos de ferias e ausencias do usuario que autorizou a conexao, com a situacao de cada um. ${FLOW_NOTE} ${PLAN_NOTE}`,
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'vacations_request',
    title: 'Solicitar ferias',
    titleEn: 'Request time off',
    group: 'vacations',
    access: 'write',
    roles: ALL_ROLES,
    plans: GROWTH_UP,
    method: 'POST',
    path: '/vacations/request',
    description:
      'Abre um pedido de ferias ou ausencia PARA O PROPRIO usuario que autorizou a conexao. Entra ' +
      `como REQUESTED e vai para o supervisor. ${FLOW_NOTE} ${PLAN_NOTE}`,
    inputSchema: obj(
      {
        startDate: date('Primeiro dia de ausencia.'),
        endDate: date('Ultimo dia de ausencia.'),
        requestType: str('Tipo do pedido, ex.: VACATION, SICK, UNPAID. Conforme configurado no tenant.'),
        reason: str('Justificativa do pedido.'),
      },
      ['startDate', 'endDate']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'vacations_list_team_requests',
    title: 'Pedidos da equipe',
    titleEn: 'Team requests',
    group: 'vacations',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: GROWTH_UP,
    method: 'GET',
    path: '/vacations/team/requests',
    description:
      'Pedidos de ferias da equipe aguardando decisao do supervisor. Padrao status=ALL. Combine com ' +
      `team_get_vacation_calendar antes de decidir. ${PLAN_NOTE}`,
    inputSchema: obj({
      status: enumOf(
        ['ALL', 'REQUESTED', 'SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED', 'HR_CONFIRMED', 'HR_REJECTED', 'CANCELED'],
        'Filtra por situacao. Padrao ALL.'
      ),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'vacations_list_hr_requests',
    title: 'Pedidos para o RH confirmar',
    titleEn: 'HR queue',
    group: 'vacations',
    access: 'read',
    roles: HR_UP,
    plans: GROWTH_UP,
    method: 'GET',
    path: '/vacations/hr/requests',
    description:
      'Fila do RH: pedidos ja aprovados pelo supervisor e aguardando confirmacao final. Padrao ' +
      `status=SUPERVISOR_APPROVED. ${PLAN_NOTE}`,
    inputSchema: obj({
      status: enumOf(
        ['ALL', 'REQUESTED', 'SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED', 'HR_CONFIRMED', 'HR_REJECTED', 'CANCELED'],
        'Filtra por situacao. Padrao SUPERVISOR_APPROVED.'
      ),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'vacations_supervisor_review',
    title: 'Decisao do supervisor',
    titleEn: 'Supervisor review',
    group: 'vacations',
    access: 'write',
    roles: SUPERVISOR_UP,
    plans: GROWTH_UP,
    method: 'PATCH',
    path: '/vacations/:id/supervisor-review',
    description:
      'Primeiro estagio da decisao. APPROVE encaminha ao RH; REJECT encerra o pedido. Antes de ' +
      `aprovar, confira team_get_vacation_calendar para nao furar a cobertura da equipe. ${PLAN_NOTE}`,
    inputSchema: obj(
      {
        id: str('Id do pedido (uuid).'),
        decision: enumOf(['APPROVE', 'REJECT'], 'Decisao do supervisor.'),
        comment: str('Comentario para o colaborador.'),
      },
      ['id', 'decision']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'vacations_hr_review',
    title: 'Confirmacao do RH',
    titleEn: 'HR review',
    group: 'vacations',
    access: 'write',
    roles: HR_UP,
    plans: GROWTH_UP,
    method: 'PATCH',
    path: '/vacations/:id/hr-review',
    description:
      'Segundo e ultimo estagio. CONFIRM efetiva as ferias; REJECT encerra o pedido mesmo tendo ' +
      'aprovacao do supervisor. Note que aqui a decisao e CONFIRM ou REJECT, nao APPROVE. So ' +
      `funciona em pedidos que estao em SUPERVISOR_APPROVED. ${PLAN_NOTE}`,
    inputSchema: obj(
      {
        id: str('Id do pedido (uuid).'),
        decision: enumOf(['CONFIRM', 'REJECT'], 'Decisao do RH.'),
        comment: str('Comentario para o colaborador.'),
      },
      ['id', 'decision']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];
