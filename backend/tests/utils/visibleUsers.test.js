// Tabela de escopo de leitura de ponto por cargo (utils/visibleUsers.js).
// O caso do HR é regressão: ele é transversal, não hierárquico — precisa consultar
// organizationAdminId, nunca supervisorId.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const { resolveVisibleUserIds } = require('../../src/utils/visibleUsers');

/** Como o resultado é memoizado no ator, cada caso precisa de um objeto novo. */
const actor = (overrides) => ({ id: 'actor-1', organizationAdminId: 'admin-1', ...overrides });

/** Filtro da última chamada a user.findMany. */
const lastWhere = () => mockPrisma.user.findMany.mock.calls.at(-1)[0].where;

describe('resolveVisibleUserIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'member-1', isActive: true }]);
  });

  it('não restringe o SUPERADMIN', async () => {
    await expect(resolveVisibleUserIds(actor({ role: 'SUPERADMIN' }))).resolves.toBeNull();
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['ADMIN', { role: 'ADMIN' }, 'actor-1'],
    ['INTEGRATOR', { role: 'INTEGRATOR' }, 'admin-1'],
    ['HR', { role: 'HR' }, 'admin-1'],
    ['MEMBER com canViewAllUsers', { role: 'MEMBER', canViewAllUsers: true }, 'admin-1'],
  ])('%s enxerga o tenant inteiro', async (_label, overrides, expectedOwner) => {
    const visible = await resolveVisibleUserIds(actor(overrides));

    // ADMIN é dono do próprio tenant; os demais apontam para o admin da organização.
    expect(lastWhere()).toEqual({
      OR: [{ id: expectedOwner }, { organizationAdminId: expectedOwner }],
      isActive: true,
    });
    expect(visible).toEqual(['member-1']);
  });

  it('SUPERVISOR desce a hierarquia por supervisorId', async () => {
    mockPrisma.user.findMany
      .mockResolvedValueOnce([{ id: 'sub-sup', isActive: true }])
      .mockResolvedValueOnce([{ id: 'member-1', isActive: true }])
      .mockResolvedValueOnce([]);

    const visible = await resolveVisibleUserIds(actor({ role: 'SUPERVISOR' }));

    expect(lastWhere()).toEqual({
      supervisorId: { in: ['member-1'] },
      organizationAdminId: 'admin-1',
    });
    // Netos entram: a travessia é recursiva, e o próprio ator vem sempre.
    expect(visible.sort()).toEqual(['actor-1', 'member-1', 'sub-sup']);
  });

  it('MEMBER enxerga apenas a si mesmo', async () => {
    await expect(resolveVisibleUserIds(actor({ role: 'MEMBER' }))).resolves.toEqual(['actor-1']);
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('memoiza o escopo no ator dentro do mesmo request', async () => {
    const hr = actor({ role: 'HR' });

    await resolveVisibleUserIds(hr);
    await resolveVisibleUserIds(hr);

    expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
  });
});
