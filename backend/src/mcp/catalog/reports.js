const {
  ALL_ROLES, ADMIN_UP,
  str, obj, NO_ARGS, date, enumOf, ENTRY_STATUS, SCOPE_NOTE,
} = require('./_shared');

module.exports = [
  {
    name: 'reports_export',
    title: 'Gerar relatorio',
    titleEn: 'Export report',
    group: 'reports',
    access: 'write',
    roles: ALL_ROLES,
    plans: null,
    method: 'POST',
    path: '/reports/export',
    description:
      'Enfileira a geracao de um relatorio de ponto em xlsx ou csv e retorna um jobId. NAO devolve ' +
      'o arquivo: a geracao e assincrona. Consulte reports_get_status com o jobId ate concluir e ' +
      `depois use reports_list para pegar o nome do arquivo. ${SCOPE_NOTE}`,
    inputSchema: obj(
      {
        startDate: date('Inicio do periodo.'),
        endDate: date('Fim do periodo.'),
        status: enumOf(ENTRY_STATUS, 'Inclui apenas marcacoes nesta situacao.'),
        userId: str('Restringe a um colaborador (uuid).'),
        teamId: str('Restringe a uma equipe.'),
        format: enumOf(['xlsx', 'csv'], 'Formato do arquivo. Padrao xlsx.'),
        timeZone: str('Fuso IANA para o corte dos dias, ex.: America/Sao_Paulo.'),
      },
      ['startDate', 'endDate']
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'reports_get_status',
    title: 'Situacao da geracao',
    titleEn: 'Report job status',
    group: 'reports',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/reports/status/:jobId',
    description:
      'Situacao do job de geracao retornado por reports_export: enfileirado, em andamento, ' +
      'concluido ou falho. Consulte com intervalo entre tentativas em vez de em loop apertado.',
    inputSchema: obj({ jobId: str('Id do job devolvido por reports_export.') }, ['jobId']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'reports_list',
    title: 'Relatorios gerados',
    titleEn: 'List reports',
    group: 'reports',
    access: 'read',
    roles: ALL_ROLES,
    plans: null,
    method: 'GET',
    path: '/reports/list',
    description:
      'Arquivos de relatorio ja gerados e disponiveis, com nome e data. O conteudo do arquivo nao ' +
      'e exposto via MCP: entregue o nome ao usuario, que baixa pelo painel em Relatorios.',
    inputSchema: NO_ARGS,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'reports_delete',
    title: 'Excluir relatorio',
    titleEn: 'Delete report',
    group: 'reports',
    access: 'write',
    roles: ADMIN_UP,
    plans: null,
    method: 'DELETE',
    path: '/reports/:filename',
    description:
      'Apaga um arquivo de relatorio gerado, do disco. Irreversivel, mas o relatorio pode ser ' +
      'gerado de novo com reports_export. Use o `filename` exato vindo de reports_list.',
    inputSchema: obj({ filename: str('Nome do arquivo exatamente como em reports_list.') }, ['filename']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];
