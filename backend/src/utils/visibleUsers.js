const { prisma } = require('../config/database');

/**
 * Resolve o tenant (organização) ao qual um usuário pertence.
 * ADMIN é dono do próprio tenant; os demais apontam para o admin da organização.
 */
const resolveTenantOwnerId = (user) => {
  if (!user) return null;
  if (user.role === 'ADMIN') return user.id;
  return user.organizationAdminId || null;
};

/** Ids dos usuários ativos do tenant, incluindo o próprio admin dono. */
const listTenantUserIds = async (ownerId) => {
  if (!ownerId) return [];
  const users = await prisma.user.findMany({
    where: { OR: [{ id: ownerId }, { organizationAdminId: ownerId }], isActive: true },
    select: { id: true },
  });
  return users.map((u) => u.id);
};

/**
 * Descendentes ativos de `rootId` via supervisorId, em qualquer profundidade, incluindo o root.
 * BFS iterativo: a árvore tem poucos níveis e isso evita SQL recursivo/raw.
 * Sempre fechado por tenant — hierarquia mal cadastrada não atravessa a fronteira entre clientes.
 *
 * A travessia atravessa nós inativos de propósito: um supervisor desativado não pode
 * esconder a equipe ativa abaixo dele. O filtro de isActive vale só para o resultado.
 */
const listDescendantIds = async (rootId, tenantOwnerId) => {
  const visited = new Set([rootId]);
  const active = new Set([rootId]); // o próprio ator entra sempre: ele está logado
  let frontier = [rootId];

  while (frontier.length > 0) {
    const children = await prisma.user.findMany({
      where: {
        supervisorId: { in: frontier },
        ...(tenantOwnerId ? { organizationAdminId: tenantOwnerId } : {}),
      },
      select: { id: true, isActive: true },
    });

    // visited também corta ciclos (A supervisiona B que supervisiona A)
    frontier = children.map((c) => c.id).filter((id) => !visited.has(id));
    frontier.forEach((id) => visited.add(id));
    children.filter((c) => c.isActive).forEach((c) => active.add(c.id));
  }

  return [...active];
};

/**
 * Ids dos usuários cujo ponto o ator pode ler. Sempre só usuários ativos (fora o próprio ator).
 *
 * Retorna `null` quando não há restrição (SUPERADMIN); caso contrário, um array de ids.
 * Chamadores devem tratar `null` como "sem filtro" e o array como lista exaustiva.
 *
 *  - SUPERADMIN       -> null (todos os tenants)
 *  - canViewAllUsers  -> todos os usuários ativos do tenant do ator
 *  - ADMIN            -> todos os usuários ativos do tenant (ele é o dono)
 *  - HR / SUPERVISOR  -> descendentes ativos via supervisorId, recursivo, + ele mesmo
 *  - MEMBER           -> apenas ele mesmo
 */
const resolveVisibleUserIds = async (actor) => {
  if (!actor?.id) return [];
  if (actor.role === 'SUPERADMIN') return null;

  const tenantOwnerId = resolveTenantOwnerId(actor);

  if (actor.canViewAllUsers || actor.role === 'ADMIN') {
    return listTenantUserIds(tenantOwnerId);
  }

  if (actor.role === 'HR' || actor.role === 'SUPERVISOR') {
    return listDescendantIds(actor.id, tenantOwnerId);
  }

  return [actor.id];
};

/** true se o ator pode ler o ponto de `targetId`. */
const canViewUser = async (actor, targetId) => {
  const visible = await resolveVisibleUserIds(actor);
  return visible === null || visible.includes(targetId);
};

module.exports = {
  resolveTenantOwnerId,
  resolveVisibleUserIds,
  canViewUser,
};
