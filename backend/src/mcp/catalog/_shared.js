/** Constantes e helpers compartilhados pelos arquivos de catalogo. */

// Espelham os guards de rota. Ver a nota em catalog/index.js: servem para
// pre-filtrar tools/list, nao para autorizar.
const ALL_ROLES = ['SUPERADMIN', 'ADMIN', 'INTEGRATOR', 'HR', 'SUPERVISOR', 'MEMBER'];
const ADMIN_UP = ['SUPERADMIN', 'ADMIN'];
const HR_UP = ['SUPERADMIN', 'ADMIN', 'INTEGRATOR', 'HR'];
const SUPERVISOR_UP = ['SUPERADMIN', 'ADMIN', 'INTEGRATOR', 'HR', 'SUPERVISOR'];
const SUPERADMIN_ONLY = ['SUPERADMIN'];

const GROWTH_UP = ['GROWTH', 'PRO'];
const PRO_ONLY = ['PRO'];

// --- builders de JSON Schema ------------------------------------------------
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const bool = (description, extra = {}) => ({ type: 'boolean', description, ...extra });
// String.raw, e nao aspas simples: em '^\d{4}...' a sequencia \d nao existe em
// JS e colapsa para 'd', entao o pattern anunciado era ^d{4}-d{2}-d{2}$ — que
// casa a letra d literal e REJEITA qualquer data real em cliente que valide o
// inputSchema. Afetava as 11 tools que declaram data. approvals.js e users.js
// escrevem o mesmo padrao com '\\d' e sempre estiveram corretos; era so aqui.
const date = (description) =>
  str(`${description} Formato YYYY-MM-DD.`, { pattern: String.raw`^\d{4}-\d{2}-\d{2}$` });
const enumOf = (values, description) => ({ type: 'string', enum: values, description });

const obj = (properties = {}, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const NO_ARGS = obj();

/** Paginacao usada pelas listagens do sistema. */
const paging = (defaultLimit = 20) => ({
  page: int('Pagina (1-based).', { minimum: 1, default: 1 }),
  limit: int(`Itens por pagina.`, { minimum: 1, maximum: 500, default: defaultLimit }),
});

const dateRange = () => ({
  startDate: date('Inicio do periodo.'),
  endDate: date('Fim do periodo.'),
});

const ENTRY_STATUS = ['PENDING', 'APPROVED', 'REJECTED'];

/** Aviso reusado: listagens sao filtradas em silencio, nunca dao 403. */
const SCOPE_NOTE =
  'O resultado e filtrado em silencio pelo escopo de quem autorizou a conexao ' +
  '(MEMBER ve so a si; SUPERVISOR ve a arvore abaixo dele; HR/INTEGRATOR/ADMIN veem o tenant). ' +
  'Nao assuma que a lista e completa para a empresa inteira.';

module.exports = {
  ALL_ROLES,
  ADMIN_UP,
  HR_UP,
  SUPERVISOR_UP,
  SUPERADMIN_ONLY,
  GROWTH_UP,
  PRO_ONLY,
  str,
  num,
  int,
  bool,
  date,
  enumOf,
  obj,
  NO_ARGS,
  paging,
  dateRange,
  ENTRY_STATUS,
  SCOPE_NOTE,
};
