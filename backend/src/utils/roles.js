/**
 * INTEGRATOR é o HR com um degrau a mais: mesma superfície de permissões e o mesmo
 * escopo de leitura (o tenant inteiro, utils/visibleUsers.js), mais o poder de gerir
 * usuários HR — hoje essa é a única diferença entre os dois cargos.
 *
 * Onde o código pergunta "é RH?" para liberar tela/rota/escopo, use isHrLevel.
 * Onde pergunta "quem esse ator pode criar/editar/promover?", use manageableRolesFor —
 * é aí que os dois cargos se separam.
 */
const HR_LEVEL_ROLES = ['HR', 'INTEGRATOR'];

const isHrLevel = (role) => HR_LEVEL_ROLES.includes(role);

const HR_MANAGEABLE_ROLES = ['SUPERVISOR', 'MEMBER'];
const INTEGRATOR_MANAGEABLE_ROLES = ['HR', 'SUPERVISOR', 'MEMBER'];

/** Papéis que um ator de nível RH pode criar, editar e atribuir. */
const manageableRolesFor = (actorRole) =>
  actorRole === 'INTEGRATOR' ? INTEGRATOR_MANAGEABLE_ROLES : HR_MANAGEABLE_ROLES;

module.exports = {
  HR_LEVEL_ROLES,
  isHrLevel,
  HR_MANAGEABLE_ROLES,
  INTEGRATOR_MANAGEABLE_ROLES,
  manageableRolesFor,
};
