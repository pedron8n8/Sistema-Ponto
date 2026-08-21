const {
  ALL_ROLES, SUPERVISOR_UP, HR_UP, ADMIN_UP, SUPERADMIN_ONLY, PRO_ONLY,
  str, int, num, bool, obj, NO_ARGS, paging, enumOf, SCOPE_NOTE,
} = require('./_shared');

const ROLE_VALUES = ['INTEGRATOR', 'HR', 'SUPERVISOR', 'MEMBER'];

// Quem pode criar/promover quem: HR mexe em SUPERVISOR e MEMBER;
// INTEGRATOR mexe tambem em HR; ADMIN em todos. Ver utils/roles.js.
const MANAGEABLE_NOTE =
  'A role que se pode atribuir depende de quem autorizou a conexao: HR alcanca SUPERVISOR e ' +
  'MEMBER; INTEGRATOR alcanca tambem HR; ADMIN alcanca todas. Tentar atribuir acima do proprio ' +
  'alcance devolve 403.';

module.exports = [
  // ---------------------------------------------------------------- conta propria
  {
    name: 'account_whoami',
    title: 'Quem autorizou esta conexao',
    titleEn: 'Who am I',
    group: 'account',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/auth/me',
    description:
      'Identidade sob a qual esta conexao MCP age: nome, e-mail, role, plano e situacao do plano. ' +
      'Chame primeiro quando nao souber o escopo disponivel — e ela que explica por que uma tool ' +
      'devolve 403 ou uma lista vem curta.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'account_get_profile',
    title: 'Meu perfil completo',
    titleEn: 'My full profile',
    group: 'account',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/auth/profile',
    description:
      'Perfil completo de quem autorizou a conexao: jornada contratada, fuso, supervisor, banco de ' +
      'horas, Slack. Segredos (hash de PIN, embedding facial) nao sao retornados.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'account_check_profile_complete',
    title: 'Cadastro esta completo?',
    titleEn: 'Profile completeness',
    group: 'account',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/users/me/profile-complete',
    description: 'Diz se faltam dados obrigatorios no cadastro e quais.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'account_update',
    title: 'Atualizar minha conta',
    titleEn: 'Update my account',
    group: 'account',
    access: 'write',
    roles: ALL_ROLES,
    plans: null,
    method: 'PATCH',
    path: '/users/me/account',
    description:
      'Atualiza dados da conta de quem autorizou a conexao. Trocar `email` ou `password` altera a ' +
      'credencial de login no Supabase e pode derrubar as sessoes ativas — confirme antes. A senha ' +
      'precisa ter no minimo 12 caracteres com maiuscula, minuscula, numero e simbolo.',
    inputSchema: obj({
      name: str('Nome completo.'),
      email: str('Novo e-mail de login.'),
      password: str('Nova senha. Minimo 12 caracteres, com maiuscula, minuscula, numero e simbolo.'),
      phone: str('Telefone.'),
      slackUserId: str('Id do usuario no Slack, para os comandos /omni.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    sensitive: true,
  },
  {
    name: 'account_get_face_enrollment',
    title: 'Meu cadastro facial',
    titleEn: 'My face enrollment',
    group: 'account',
    access: 'read',
    roles: ALL_ROLES,
    plans: PRO_ONLY,
    method: 'GET',
    path: '/users/me/face',
    description:
      'Diz se ha cadastro facial ativo, quando foi feito e qual o limiar configurado. Requer plano ' +
      'PRO. O cadastro em si (POST) nao e exposto via MCP: exige camera.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'account_delete_face_enrollment',
    title: 'Remover meu cadastro facial',
    titleEn: 'Delete my face enrollment',
    group: 'account',
    access: 'write',
    roles: ALL_ROLES,
    plans: PRO_ONLY,
    method: 'DELETE',
    path: '/users/me/face',
    description:
      'Apaga o cadastro facial de quem autorizou a conexao. Se o tenant exigir face para bater ' +
      'ponto, a pessoa fica sem conseguir registrar ate cadastrar de novo pelo app. Requer plano PRO.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    sensitive: true,
  },
  {
    name: 'account_delete_photo',
    title: 'Remover minha foto',
    titleEn: 'Delete my photo',
    group: 'account',
    access: 'write',
    roles: ALL_ROLES,
    plans: null,
    method: 'DELETE',
    path: '/users/me/photo',
    description:
      'Apaga a foto de perfil de quem autorizou a conexao. O upload de foto nao e exposto via MCP ' +
      '(exige envio de arquivo); use o painel.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },

  // ---------------------------------------------------------------- usuarios
  {
    name: 'users_list',
    title: 'Listar colaboradores',
    titleEn: 'List users',
    group: 'users',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'GET',
    path: '/users',
    description:
      'Lista colaboradores com busca por nome ou e-mail e filtro por role. E a forma canonica de ' +
      'resolver um nome em um userId antes de chamar qualquer tool que peca userId. ' +
      SCOPE_NOTE,
    inputSchema: obj({
      search: str('Busca parcial por nome ou e-mail.'),
      role: enumOf(['SUPERADMIN', 'ADMIN', ...ROLE_VALUES], 'Filtra por role.'),
      activeOnly: bool('Se true, so colaboradores ativos.'),
      organizationAdminId: str('Restringe a um tenant. Util so para SUPERADMIN.'),
      ...paging(50),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'users_get',
    title: 'Detalhe de um colaborador',
    titleEn: 'Get user',
    group: 'users',
    access: 'read',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'GET',
    path: '/users/:id',
    description:
      'Cadastro de um colaborador: role, supervisor, jornada contratada, fuso, situacao. So retorna ' +
      'se estiver no escopo de visibilidade de quem autorizou a conexao.',
    inputSchema: obj({ id: str('Id do colaborador (uuid).') }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'users_create',
    title: 'Criar colaborador',
    titleEn: 'Create user',
    group: 'users',
    access: 'write',
    roles: HR_UP,
    plans: null,
    method: 'POST',
    path: '/users',
    description:
      'Cria um colaborador no Supabase e no banco, consumindo um assento do plano. Se nao houver ' +
      'assento livre a API devolve 402 com o link de compra — nao tente contornar. ' +
      `${MANAGEABLE_NOTE} Alternativa sem senha: users_create_invite_link, que deixa a pessoa se ` +
      'cadastrar. Campos de provisionamento de tenant e plano nao sao expostos aqui.',
    inputSchema: obj(
      {
        email: str('E-mail de login. Sera normalizado para minusculas.'),
        name: str('Nome completo. Minimo 2 caracteres.'),
        role: enumOf(ROLE_VALUES, 'Role do colaborador. Padrao MEMBER.'),
        password: str('Senha inicial. Minimo 6 caracteres neste endpoint.'),
        supervisorId: str('Id do supervisor direto (uuid). Define a arvore de visibilidade.'),
      },
      ['email', 'name', 'password']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'users_update',
    title: 'Atualizar colaborador',
    titleEn: 'Update user',
    group: 'users',
    access: 'write',
    roles: HR_UP,
    plans: null,
    method: 'PATCH',
    path: '/users/:id',
    description:
      'Atualiza nome, role, supervisor ou situacao de um colaborador. `isActive: false` desativa a ' +
      'pessoa (libera o assento e a tira das listagens) sem apagar historico de ponto — prefira ' +
      `isso a users_delete em desligamentos. ${MANAGEABLE_NOTE}`,
    inputSchema: obj(
      {
        id: str('Id do colaborador (uuid).'),
        name: str('Nome completo.'),
        role: enumOf(ROLE_VALUES, 'Nova role.'),
        isActive: bool('false desativa o colaborador e libera o assento.'),
        supervisorId: str('Novo supervisor direto (uuid), ou null para desvincular.'),
        canViewAllUsers: bool('Concede visao de todo o tenant independente da role.'),
      },
      ['id']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'users_delete',
    title: 'Excluir colaborador',
    titleEn: 'Delete user',
    group: 'users',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'DELETE',
    path: '/users/:id',
    description:
      'Apaga o colaborador em definitivo. IRREVERSIVEL e leva o historico junto. Para desligamento ' +
      'use users_update com isActive: false, que preserva a folha de ponto para auditoria. Chame ' +
      'esta tool apenas com confirmacao explicita do usuario, para um cadastro criado por engano.',
    inputSchema: obj({ id: str('Id do colaborador (uuid).') }, ['id']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    sensitive: true,
  },
  {
    name: 'users_create_invite_link',
    title: 'Gerar link de convite',
    titleEn: 'Create invite link',
    group: 'users',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'POST',
    path: '/users/me/team-invite-link',
    description:
      'Gera um link de convite com a role ja embutida: a pessoa se cadastra e entra no tenant sem ' +
      'que ninguem defina senha por ela. Preferivel a users_create no dia a dia. O assento e ' +
      'conferido no momento em que a pessoa aceita.',
    inputSchema: obj(
      {
        role: enumOf(ROLE_VALUES, 'Role que o convidado tera.'),
        expiresInHours: int('Validade do link em horas.', { minimum: 1 }),
      },
      ['role']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'users_set_supervisor',
    title: 'Trocar supervisor',
    titleEn: 'Set supervisor',
    group: 'users',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'PATCH',
    path: '/admin/users/:userId/supervisor',
    description:
      'Reposiciona um colaborador na arvore de equipes. Isso muda quem ve e aprova o ponto dele, ' +
      'entao afeta a fila de aprovacao dos dois supervisores envolvidos. Use `supervisorId: null` ' +
      'para desvincular.',
    inputSchema: obj(
      {
        userId: str('Id do colaborador (uuid).'),
        supervisorId: str('Id do novo supervisor (uuid), ou null para desvincular.'),
      },
      ['userId']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'users_set_pin',
    title: 'Definir PIN de ponto',
    titleEn: 'Set clock PIN',
    group: 'users',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'PATCH',
    path: '/admin/users/:userId/pin',
    description:
      'Define o PIN de 4 digitos que o colaborador usa para bater ponto, e zera o bloqueio por ' +
      'tentativas erradas. Credencial de autenticacao: nunca escolha o PIN por conta propria nem ' +
      'sugira um valor — use exatamente o que o usuario informar, e nao repita o valor de volta.',
    inputSchema: obj(
      { userId: str('Id do colaborador (uuid).'), pin: str('PIN de 4 digitos.', { pattern: '^\\d{4}$' }) },
      ['userId', 'pin']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    sensitive: true,
  },
  {
    name: 'users_delete_pin',
    title: 'Remover PIN de ponto',
    titleEn: 'Remove clock PIN',
    group: 'users',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'DELETE',
    path: '/admin/users/:userId/pin',
    description:
      'Apaga o PIN do colaborador. Se o tenant exigir PIN para bater ponto, a pessoa fica sem ' +
      'conseguir registrar ate que um novo seja definido com users_set_pin.',
    inputSchema: obj({ userId: str('Id do colaborador (uuid).') }, ['userId']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'users_set_work_settings',
    title: 'Definir jornada de trabalho',
    titleEn: 'Set work settings',
    group: 'users',
    access: 'write',
    roles: SUPERVISOR_UP,
    plans: null,
    method: 'PATCH',
    path: '/supervisor/team/:userId/work-settings',
    routeByRole: {
      SUPERADMIN: '/admin/users/:userId/work-settings',
      ADMIN: '/admin/users/:userId/work-settings',
      INTEGRATOR: '/hr/users/:userId/work-settings',
      HR: '/hr/users/:userId/work-settings',
    },
    description:
      'Define a jornada contratada, o horario padrao e o fuso de um colaborador. Muda a base de ' +
      'calculo de hora extra e de banco de horas dos dias SEGUINTES; nao recalcula o passado. ' +
      '`hourlyRate` so e aceito por HR, INTEGRATOR e ADMIN — se quem autorizou for SUPERVISOR o ' +
      'campo e ignorado.',
    inputSchema: obj(
      {
        userId: str('Id do colaborador (uuid).'),
        contractDailyMinutes: int('Jornada diaria contratada em minutos. Ex.: 480 para 8h.', {
          minimum: 0,
          maximum: 1440,
        }),
        workdayStartTime: str('Inicio padrao da jornada, HH:MM.', { pattern: '^\\d{2}:\\d{2}$' }),
        workdayEndTime: str('Fim padrao da jornada, HH:MM.', { pattern: '^\\d{2}:\\d{2}$' }),
        timeZone: str('Fuso IANA do colaborador, ex.: America/Sao_Paulo.'),
        hourlyRate: num('Valor-hora. Somente HR, INTEGRATOR ou ADMIN.', { minimum: 0 }),
      },
      ['userId']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },

  // ---------------------------------------------------------------- plataforma
  {
    name: 'platform_list_accounts',
    title: 'Panorama de contas (SUPERADMIN)',
    titleEn: 'Accounts overview',
    group: 'platform',
    access: 'read',
    roles: SUPERADMIN_ONLY,
    plans: null,
    method: 'GET',
    path: '/users/superadmin/accounts-overview',
    description:
      'Visao de plataforma: todos os tenants com plano, assentos e historico de pagamento, ' +
      'incluindo dados vindos do Stripe. Exclusivo de SUPERADMIN e atravessa todos os tenants — ' +
      'so faz sentido em uma conexao MCP de operacao interna.',
    inputSchema: obj({
      paymentHistoryLimit: int('Quantos pagamentos por conta. Maximo 50, padrao 10.', { minimum: 1, maximum: 50 }),
      stripeLookbackDays: int('Janela de busca no Stripe em dias. Maximo 3650, padrao 365.', { minimum: 1, maximum: 3650 }),
      stripeMaxPages: int('Paginas do Stripe a percorrer. Maximo 20, padrao 5.', { minimum: 1, maximum: 20 }),
      stripePerPage: int('Itens por pagina no Stripe. Maximo 100, padrao 100.', { minimum: 1, maximum: 100 }),
    }),
    annotations: { readOnlyHint: true },
    sensitive: true,
  },
];
