const {
  ADMIN_UP, GROWTH_UP, PRO_ONLY,
  str, int, num, bool, obj, NO_ARGS, enumOf,
} = require('./_shared');

module.exports = [
  {
    name: 'settings_get_location',
    title: 'Config de geofence',
    titleEn: 'Location settings',
    group: 'settings',
    access: 'read',
    roles: ADMIN_UP,
    plans: GROWTH_UP,
    method: 'GET',
    path: '/admin/location-settings',
    description:
      'Config de validacao por localizacao do tenant: fonte, modo, raio e centro do geofence. ' +
      'Requer plano GROWTH ou PRO. A versao publica, que qualquer colaborador ve, e ' +
      'time_get_clock_requirements.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'settings_update_location',
    title: 'Alterar geofence',
    titleEn: 'Update location settings',
    group: 'settings',
    access: 'write',
    roles: ADMIN_UP,
    plans: GROWTH_UP,
    method: 'PATCH',
    path: '/admin/location-settings',
    description:
      'Altera as regras de localizacao para bater ponto. Afeta TODOS os colaboradores do tenant na ' +
      'hora: apertar o raio ou ligar `requireLocation` pode impedir marcacoes imediatamente. Leia ' +
      'settings_get_location antes e envie so os campos que mudam. Requer plano GROWTH ou PRO.',
    inputSchema: obj({
      enabled: bool('Liga ou desliga a validacao por localizacao.'),
      geolocationEnabled: bool('Liga a coleta de coordenadas no app.'),
      locationValidationSource: str('Fonte da validacao, ex.: GPS ou IP.'),
      mode: str('Modo de aplicacao, ex.: BLOCK para impedir ou WARN para so avisar.'),
      requireLocation: bool('Se true, recusa a marcacao sem coordenadas.'),
      radiusMeters: int('Raio permitido em metros a partir do centro.', { minimum: 1 }),
      center: {
        type: 'object',
        description: 'Centro do geofence.',
        properties: {
          latitude: { type: 'number', description: 'Latitude decimal.' },
          longitude: { type: 'number', description: 'Longitude decimal.' },
        },
        required: ['latitude', 'longitude'],
        additionalProperties: false,
      },
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    sensitive: true,
  },
  {
    name: 'settings_get_pro',
    title: 'Config PRO',
    titleEn: 'PRO settings',
    group: 'settings',
    access: 'read',
    roles: ADMIN_UP,
    plans: PRO_ONLY,
    method: 'GET',
    path: '/admin/pro/settings',
    description:
      'Config dos recursos PRO do tenant: parametros de liveness do reconhecimento facial e estado ' +
      'da API publica de folha. Requer plano PRO ativo.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'settings_update_liveness',
    title: 'Alterar liveness facial',
    titleEn: 'Update liveness settings',
    group: 'settings',
    access: 'write',
    roles: ADMIN_UP,
    plans: PRO_ONLY,
    method: 'PATCH',
    path: '/admin/pro/liveness',
    description:
      'Ajusta a deteccao de vivacidade do reconhecimento facial. Afrouxar os parametros aumenta o ' +
      'risco de fraude por foto; apertar demais faz colaboradores legitimos falharem ao bater ' +
      'ponto. Leia settings_get_pro antes. Requer plano PRO.',
    inputSchema: obj({
      enabled: bool('Liga ou desliga a exigencia de liveness.'),
      maxAgeMs: int('Idade maxima da captura em milissegundos.', { minimum: 0 }),
      minFrames: int('Quantidade minima de quadros analisados.', { minimum: 1 }),
      minHeadMovementDelta: num('Movimento minimo de cabeca exigido.', { minimum: 0 }),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    sensitive: true,
  },
  {
    name: 'settings_update_public_api',
    title: 'Config da API publica de folha',
    titleEn: 'Public payroll API settings',
    group: 'settings',
    access: 'write',
    roles: ADMIN_UP,
    plans: PRO_ONLY,
    method: 'PATCH',
    path: '/admin/pro/public-api',
    description:
      'Liga ou desliga a API publica de folha e define a validade dos tokens dela. ATENCAO: essa ' +
      'config vive em memoria do processo, ou seja, volta ao padrao quando o servidor reinicia. ' +
      'Nao confunda com esta conexao MCP, que e persistida. Requer plano PRO.',
    inputSchema: obj({
      enabled: bool('Liga ou desliga a API publica de folha.'),
      defaultTokenTtlHours: int('Validade padrao dos tokens em horas.', { minimum: 1, maximum: 168 }),
      maxTokenTtlHours: int('Validade maxima permitida em horas. Teto do sistema: 168.', {
        minimum: 1,
        maximum: 168,
      }),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'settings_issue_public_api_token',
    title: 'Emitir token da API de folha',
    titleEn: 'Issue payroll API token',
    group: 'settings',
    access: 'write',
    roles: ADMIN_UP,
    plans: PRO_ONLY,
    method: 'POST',
    path: '/admin/pro/public-api/token',
    description:
      'Emite um token bearer para a API publica de folha (sistema externo de RH ou contabilidade). ' +
      'O token e devolvido UMA unica vez, em texto claro, e NAO pode ser revogado antes de expirar ' +
      '— por isso use o menor prazo que resolva. Nunca gere um sem que o usuario tenha pedido, e ' +
      'entregue o valor apenas a ele. Requer plano PRO.',
    inputSchema: obj({
      expiresInHours: int('Validade em horas. Teto do sistema: 168.', { minimum: 1, maximum: 168 }),
      scopes: {
        type: 'array',
        items: { type: 'string', enum: ['payroll:read'] },
        description: 'Escopos do token. Hoje so payroll:read existe.',
      },
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    sensitive: true,
  },
];
