const { HR_UP, ADMIN_UP, str, int, obj, NO_ARGS, paging, enumOf } = require('./_shared');

// Todo este grupo move dinheiro ou expoe dado financeiro. Vem desmarcado por
// padrao na pagina de permissoes; ver `sensitive: true`.
const MONEY_NOTE =
  'Grupo financeiro: so chame com pedido explicito do usuario e confirme valores antes. Nao ha ' +
  'tool de desfazer.';

module.exports = [
  {
    name: 'billing_get_overview',
    title: 'Panorama financeiro',
    titleEn: 'Finance overview',
    group: 'billing',
    access: 'read',
    roles: ADMIN_UP,
    plans: null,
    method: 'GET',
    path: '/users/me/finance/overview',
    description:
      'Situacao financeira do tenant: plano vigente, assentos contratados e em uso, valor mensal e ' +
      'proxima cobranca.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
    sensitive: true,
  },
  {
    name: 'billing_list_invoices',
    title: 'Listar faturas',
    titleEn: 'List invoices',
    group: 'billing',
    access: 'read',
    roles: ADMIN_UP,
    plans: null,
    method: 'GET',
    path: '/users/me/finance/invoices',
    description:
      'Faturas do tenant, paginadas. Padrao status=paid. Se uma fatura recente nao aparecer, rode ' +
      'billing_sync_invoices primeiro.',
    inputSchema: obj({
      ...paging(20),
      status: enumOf(['paid', 'all'], 'Filtra por situacao. Padrao paid.'),
    }),
    annotations: { readOnlyHint: true },
    sensitive: true,
  },
  {
    name: 'billing_sync_invoices',
    title: 'Sincronizar faturas do Stripe',
    titleEn: 'Sync invoices',
    group: 'billing',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'POST',
    path: '/users/me/finance/invoices/sync',
    description:
      'Busca as faturas no Stripe e persiste localmente. Nao cobra nada nem altera assinatura, so ' +
      'atualiza o espelho lido por billing_list_invoices. Seguro de repetir.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    sensitive: true,
  },
  {
    name: 'billing_get_seats',
    title: 'Assentos por conta',
    titleEn: 'Seat usage',
    group: 'billing',
    access: 'read',
    roles: HR_UP,
    plans: null,
    method: 'GET',
    path: '/users/admin-seats',
    description:
      'Assentos contratados, ocupados e livres. Consulte antes de users_create ou ' +
      'users_create_invite_link: sem assento livre a criacao devolve 402.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'billing_change_plan',
    title: 'Alterar plano',
    titleEn: 'Change plan',
    group: 'billing',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'PATCH',
    path: '/users/me/plan',
    description:
      'Altera o plano ou o limite de assentos do tenant. Com `startCheckout: true` devolve uma URL ' +
      'de checkout do Stripe para o usuario pagar — entregue o link, nunca tente concluir o ' +
      `pagamento. Reduzir assentos abaixo do uso atual e recusado. ${MONEY_NOTE}`,
    inputSchema: obj({
      planCode: enumOf(['BASE', 'STARTER', 'GROWTH', 'PRO'], 'Codigo do plano de destino.'),
      seatLimit: int('Novo limite de assentos.', { minimum: 1 }),
      seats: int('Quantidade de assentos a contratar.', { minimum: 1 }),
      startCheckout: {
        type: 'boolean',
        description: 'Se true, devolve uma URL de checkout do Stripe em vez de aplicar direto.',
      },
      stripeSessionId: str('Id da sessao do Stripe, para confirmar um checkout ja pago.'),
      returnTo: str('Caminho do painel para onde voltar depois do checkout.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    sensitive: true,
  },
  {
    name: 'billing_buy_seats',
    title: 'Comprar assentos extras',
    titleEn: 'Buy extra seats',
    group: 'billing',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'POST',
    path: '/users/me/additional-seats/checkout',
    description:
      'Cria uma sessao de checkout no Stripe para comprar assentos adicionais e devolve a URL. ' +
      'Nada e cobrado ate o usuario pagar na pagina. Depois do pagamento, chame ' +
      `billing_confirm_seats com o stripeSessionId. ${MONEY_NOTE}`,
    inputSchema: obj({ quantity: int('Quantos assentos comprar.', { minimum: 1 }) }, ['quantity']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    sensitive: true,
  },
  {
    name: 'billing_confirm_seats',
    title: 'Confirmar compra de assentos',
    titleEn: 'Confirm seat purchase',
    group: 'billing',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'PATCH',
    path: '/users/me/additional-seats/confirm',
    description:
      'Confirma um checkout de assentos ja pago e libera os assentos no tenant. Use o ' +
      '`stripeSessionId` devolvido por billing_buy_seats. Falha se a sessao nao estiver paga.',
    inputSchema: obj({ stripeSessionId: str('Id da sessao de checkout do Stripe.') }, ['stripeSessionId']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    sensitive: true,
  },
];
