const { SUPERVISOR_UP, str, obj } = require('./_shared');

// Regra do dominio que a IA precisa saber: quando a marcacao tem hora extra
// pendente, PATCH /supervisor/approve/:id falha. A ordem e overtime -> entry.
const OVERTIME_FIRST =
  'ORDEM OBRIGATORIA: se a marcacao tiver hora extra com overtimeStatus PENDING, decida a hora ' +
  'extra primeiro (approvals_approve_overtime ou approvals_reject_overtime). Aprovar a marcacao ' +
  'antes disso falha.';

const BULK_NOTE =
  'Aceita duas formas, nunca as duas juntas: `entryIds` com ids explicitos (maximo 500), ou ' +
  '`scope` com um periodo, para varrer tudo que estiver pendente naquela janela. Use `scope` ' +
  'para fechar a semana inteira de uma vez.';

const scopeSchema = () => ({
  type: 'object',
  description: 'Alternativa a entryIds: varre tudo que estiver pendente no periodo.',
  properties: {
    startDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Inicio, YYYY-MM-DD.' },
    endDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Fim, YYYY-MM-DD.' },
    userId: { type: 'string', description: 'Restringe a um colaborador (uuid).' },
    groupId: { type: 'string', description: 'Restringe a um grupo ou equipe.' },
  },
  required: ['startDate', 'endDate'],
  additionalProperties: false,
});

const entryIdsSchema = () => ({
  type: 'array',
  items: { type: 'string' },
  maxItems: 500,
  description: 'Ids das marcacoes (uuid). Maximo 500 por chamada.',
});

module.exports = [
  {
    name: 'approvals_approve',
    title: 'Aprovar marcacao',
    titleEn: 'Approve entry',
    group: 'approvals',
    access: 'write',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'PATCH',
    path: '/supervisor/approve/:id',
    description:
      `Aprova uma marcacao de ponto da equipe, consolidando as horas do dia. ${OVERTIME_FIRST}`,
    inputSchema: obj(
      { id: str('Id da marcacao (uuid).'), comment: str('Comentario opcional no log de aprovacao.') },
      ['id']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'approvals_reject',
    title: 'Rejeitar marcacao',
    titleEn: 'Reject entry',
    group: 'approvals',
    access: 'write',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'PATCH',
    path: '/supervisor/reject/:id',
    description:
      'Rejeita uma marcacao de ponto da equipe. O comentario e OBRIGATORIO: e o que o colaborador ' +
      've como motivo. Se a intencao for pedir uma correcao em vez de invalidar o dia, use ' +
      'approvals_request_edit.',
    inputSchema: obj(
      { id: str('Id da marcacao (uuid).'), comment: str('Motivo da rejeicao. Obrigatorio.') },
      ['id', 'comment']
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'approvals_approve_bulk',
    title: 'Aprovar em lote',
    titleEn: 'Bulk approve',
    group: 'approvals',
    access: 'write',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'POST',
    path: '/supervisor/approve-bulk',
    description:
      `Aprova varias marcacoes de uma vez. ${BULK_NOTE} ${OVERTIME_FIRST} ` +
      'A resposta lista o que foi aprovado e o que foi pulado, com o motivo de cada pulo.',
    inputSchema: obj({
      entryIds: entryIdsSchema(),
      scope: scopeSchema(),
      comment: str('Comentario aplicado a todas as aprovacoes.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'approvals_reject_bulk',
    title: 'Rejeitar em lote',
    titleEn: 'Bulk reject',
    group: 'approvals',
    access: 'write',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'POST',
    path: '/supervisor/reject-bulk',
    description:
      `Rejeita varias marcacoes de uma vez. ${BULK_NOTE} O comentario e OBRIGATORIO e vale para ` +
      'todas. Operacao ampla e visivel para os colaboradores: confirme o escopo antes de chamar.',
    inputSchema: obj(
      {
        entryIds: entryIdsSchema(),
        scope: scopeSchema(),
        comment: str('Motivo aplicado a todas as rejeicoes. Obrigatorio.'),
      },
      ['comment']
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'approvals_approve_overtime',
    title: 'Aprovar hora extra',
    titleEn: 'Approve overtime',
    group: 'approvals',
    access: 'write',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'PATCH',
    path: '/supervisor/overtime/:id/approve',
    description:
      'Aprova a hora extra de uma marcacao. A hora extra e uma trilha de aprovacao separada da ' +
      'marcacao (campo overtimeStatus) e precisa ser decidida ANTES de approvals_approve. Aprovar ' +
      'confirma o acumulo no banco de horas nos percentuais de 50% e 100% calculados.',
    inputSchema: obj(
      { id: str('Id da marcacao (uuid).'), comment: str('Comentario opcional.') },
      ['id']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'approvals_reject_overtime',
    title: 'Rejeitar hora extra',
    titleEn: 'Reject overtime',
    group: 'approvals',
    access: 'write',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'PATCH',
    path: '/supervisor/overtime/:id/reject',
    description:
      'Rejeita a hora extra de uma marcacao e REVERTE o acumulo correspondente no banco de horas ' +
      'do colaborador. Comentario obrigatorio. A marcacao em si continua podendo ser aprovada ' +
      'depois com approvals_approve.',
    inputSchema: obj(
      { id: str('Id da marcacao (uuid).'), comment: str('Motivo da rejeicao. Obrigatorio.') },
      ['id', 'comment']
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'approvals_request_edit',
    title: 'Pedir correcao ao colaborador',
    titleEn: 'Request edit',
    group: 'approvals',
    access: 'write',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'PATCH',
    path: '/supervisor/request-edit/:id',
    description:
      'Devolve a marcacao ao colaborador pedindo justificativa, em vez de rejeitar. E o que abre ' +
      'a janela para ele usar time_update_notes. Comentario obrigatorio: e a pergunta que ele le. ' +
      'Prefira isto a approvals_reject quando o dia parece legitimo mas falta explicacao.',
    inputSchema: obj(
      { id: str('Id da marcacao (uuid).'), comment: str('O que o colaborador deve esclarecer. Obrigatorio.') },
      ['id', 'comment']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];
