const { SUPERVISOR_UP, HR_UP, ADMIN_UP, str, int, bool, obj, NO_ARGS, SCOPE_NOTE } = require('./_shared');

// Estas rotas existem duplicadas no backend, diferindo so no guard
// (/admin/* exige ADMIN, /supervisor/* aceita HR+ ou SUPERVISOR+). Uma tool
// so, e o bridge escolhe a rota pelo role de quem autorizou a conexao.
module.exports = [
  {
    name: 'bankhours_get_overview',
    title: 'Panorama do banco de horas',
    titleEn: 'Hour bank overview',
    group: 'bankhours',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'GET',
    path: '/supervisor/team/bank-hours/overview',
    routeByRole: {
      SUPERADMIN: '/admin/bank-hours/overview',
      ADMIN: '/admin/bank-hours/overview',
    },
    description:
      'Saldo de banco de horas de todos os colaboradores visiveis, com pendencias de pagamento e ' +
      `politica de expiracao. ADMIN ve o tenant inteiro; os demais veem sua arvore. ${SCOPE_NOTE}`,
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'bankhours_adjust',
    title: 'Ajustar saldo de banco de horas',
    titleEn: 'Adjust hour bank',
    group: 'bankhours',
    access: 'write',
    roles: HR_UP,
    plans: null,
    method: 'PATCH',
    path: '/supervisor/team/:userId/bank-hours',
    routeByRole: {
      SUPERADMIN: '/admin/users/:userId/bank-hours',
      ADMIN: '/admin/users/:userId/bank-hours',
    },
    description:
      'Ajuste manual no saldo de banco de horas de um colaborador. Use `minutesDelta` para somar ' +
      '(positivo) ou subtrair (negativo) minutos, ou `resetToZero: true` para zerar o saldo. ' +
      '`reason` e OBRIGATORIO e fica registrado no extrato do colaborador. Mexe em direito ' +
      'trabalhista: confirme o valor e o motivo com quem pediu antes de chamar.',
    inputSchema: obj(
      {
        userId: str('Id do colaborador (uuid).'),
        minutesDelta: int('Minutos a somar (positivo) ou subtrair (negativo).'),
        resetToZero: bool('Se true, zera o saldo e ignora minutesDelta.'),
        reason: str('Justificativa do ajuste. Obrigatoria e visivel no extrato.'),
      },
      ['userId', 'reason']
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    sensitive: true,
  },
  {
    name: 'bankhours_pay',
    title: 'Pagar banco de horas',
    titleEn: 'Pay out hour bank',
    group: 'bankhours',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'PATCH',
    path: '/admin/users/:userId/bank-hours/pay',
    description:
      'Marca horas do banco de um colaborador como PAGAS em folha, baixando o saldo. Use ' +
      '`payAllPending: true` para quitar tudo, ou `entryIds` para quitar lancamentos especificos. ' +
      'Tem efeito financeiro e nao ha tool de desfazer: confirme o colaborador e o montante antes ' +
      'de chamar. So ADMIN pode executar.',
    inputSchema: obj(
      {
        userId: str('Id do colaborador (uuid).'),
        payAllPending: bool('Se true, quita todos os lancamentos pendentes.'),
        entryIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids dos lancamentos de banco de horas a quitar. Alternativa a payAllPending.',
        },
        paymentNote: str('Referencia do pagamento, ex.: competencia da folha.'),
      },
      ['userId']
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    sensitive: true,
  },
];
