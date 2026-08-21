const {
  ALL_ROLES, ADMIN_UP, GROWTH_UP,
  str, num, obj, NO_ARGS, paging, dateRange, enumOf, ENTRY_STATUS,
} = require('./_shared');

// Fatores de autenticacao aceitos por clock-in/out/break/resume. Quais sao
// exigidos depende da config do tenant — time_get_clock_requirements informa.
const AUTH_FACTORS = {
  pin: str('PIN de 4 digitos do colaborador, se o tenant exigir PIN.'),
  qrToken: str('Token do QR rotativo do terminal, se o tenant exigir terminal.'),
  latitude: num('Latitude decimal, se o tenant exigir geofence.'),
  longitude: num('Longitude decimal, se o tenant exigir geofence.'),
};

const punchTool = (name, title, titleEn, path, what) => ({
  name,
  title,
  titleEn,
  group: 'time',
  access: 'write',
  roles: ALL_ROLES,
  plans: null,
  method: 'POST',
  path,
  description:
    `${what} Age sempre sobre o usuario que autorizou a conexao MCP — nao ha como bater ponto ` +
    'por outra pessoa por aqui (para isso use timesheet_create_entry, que e uma correcao de RH). ' +
    'Reconhecimento facial e liveness NAO sao possiveis via MCP (exigem camera): se o tenant os ' +
    'exigir, a chamada falha e o colaborador precisa usar o app. Consulte ' +
    'time_get_clock_requirements antes para saber quais fatores enviar.',
  inputSchema: obj({
    notes: str('Observacao livre a anexar na marcacao.'),
    ...AUTH_FACTORS,
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
});

module.exports = [
  punchTool(
    'time_clock_in', 'Bater entrada', 'Clock in', '/time/clock-in',
    'Registra a entrada e abre uma marcacao de ponto.'
  ),
  punchTool(
    'time_clock_out', 'Bater saida', 'Clock out', '/time/clock-out',
    'Registra a saida e fecha a marcacao aberta, calculando horas trabalhadas, ' +
    'horas extras (50%/100%) e acumulo no banco de horas.'
  ),
  punchTool(
    'time_start_break', 'Iniciar intervalo', 'Start break', '/time/break',
    'Inicia o intervalo/pausa na marcacao aberta.'
  ),
  punchTool(
    'time_resume', 'Encerrar intervalo', 'Resume from break', '/time/resume',
    'Encerra o intervalo em curso e retoma a contagem de trabalho.'
  ),

  {
    name: 'time_get_current',
    title: 'Marcacao aberta agora',
    titleEn: 'Current open entry',
    group: 'time',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/time/current',
    description:
      'Retorna a marcacao de ponto aberta do usuario que autorizou a conexao, com minutos ' +
      'trabalhados e de intervalo calculados ao vivo. Use para responder "estou batido?" e ' +
      'para decidir entre time_clock_in e time_clock_out.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'time_get_today',
    title: 'Ponto de hoje',
    titleEn: "Today's punches",
    group: 'time',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/time/today',
    description: 'Todas as marcacoes de hoje do usuario que autorizou a conexao, com totais do dia.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'time_get_clock_requirements',
    title: 'Regras de marcacao do tenant',
    titleEn: 'Clock-in requirements',
    group: 'time',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/time/geofence',
    description:
      'Config publica de validacao do tenant: se exige geofence (e o centro/raio), PIN, face, ' +
      'liveness ou QR de terminal. Chame ANTES de time_clock_in/out para saber quais argumentos ' +
      'de autenticacao enviar e se a marcacao via MCP e possivel.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'time_list_my_entries',
    title: 'Meu historico de ponto',
    titleEn: 'My time entries',
    group: 'time',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/time/me',
    description:
      'Historico paginado de marcacoes do usuario que autorizou a conexao, com filtro por status ' +
      'e periodo. Para o historico de outra pessoa use team_list_entries ou timesheet_get_user_days.',
    inputSchema: obj({
      ...paging(20),
      status: enumOf(ENTRY_STATUS, 'Filtra por situacao da aprovacao.'),
      ...dateRange(),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'time_get_my_bank_hours',
    title: 'Meu banco de horas',
    titleEn: 'My hour bank',
    group: 'time',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/time/bank-hours/me',
    description:
      'Saldo e extrato do banco de horas do usuario que autorizou a conexao, com politica de ' +
      'expiracao e limite configurados.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'time_get_entry',
    title: 'Detalhe de uma marcacao',
    titleEn: 'Get one time entry',
    group: 'time',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/time/:id',
    description:
      'Uma marcacao de ponto pelo id, com horas extras e situacao. So retorna se estiver no ' +
      'escopo de visibilidade de quem autorizou a conexao.',
    inputSchema: obj({ id: str('Id da marcacao (uuid).') }, ['id']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'time_update_notes',
    title: 'Justificar minha marcacao',
    titleEn: 'Justify my entry',
    group: 'time',
    access: 'write',
    roles: ALL_ROLES,
    plans: null,
    method: 'PATCH',
    path: '/time/:id/notes',
    description:
      'Edita a observacao de uma marcacao PROPRIA. E o caminho de justificativa do colaborador e ' +
      'so funciona depois que o supervisor pediu correcao (approvals_request_edit); fora dessa ' +
      'janela a API recusa. Nao altera horarios — quem corrige horario e o RH (timesheet_update_entry).',
    inputSchema: obj(
      { id: str('Id da marcacao (uuid).'), notes: str('Texto da justificativa.') },
      ['id', 'notes']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'time_rotate_terminal_qr',
    title: 'Gerar QR de terminal',
    titleEn: 'Rotate terminal QR',
    group: 'time',
    access: 'write',
    roles: ADMIN_UP,
    plans: GROWTH_UP,
    method: 'POST',
    path: '/time/terminal/qr',
    description:
      'Gera/rotaciona o token do QR code de um terminal de ponto compartilhado. Requer plano ' +
      'GROWTH ou PRO. O token e de vida curta: gere na hora de exibir.',
    inputSchema: obj({ terminalId: str('Identificador do terminal.') }, ['terminalId']),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
];
