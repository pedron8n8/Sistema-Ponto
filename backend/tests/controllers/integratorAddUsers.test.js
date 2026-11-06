// O INTEGRATOR adiciona usuarios ao time do seu ADMIN, por criacao direta ou convite,
// mas nunca cria alguem do mesmo nivel ou acima dele.

process.env.TEAM_INVITE_HMAC_SECRET = 'test-invite-secret-1234';

const mockPrisma = require('../mocks/prisma.mock');
const { mockSupabaseAdmin } = require('../mocks/supabase.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: mockSupabaseAdmin }));

const { createUser, createMyTeamInviteLink } = require('../../src/controllers/user.controller');
const { verifyTeamInviteToken } = require('../../src/utils/teamInviteToken');

describe('INTEGRATOR adding users', () => {
  const integrator = { id: 'int-1', email: 'int@test.com', role: 'INTEGRATOR', organizationAdminId: 'org-1' };
  const orgAdmin = { id: 'org-1', role: 'ADMIN', adminSeatLimit: 50, adminPlanId: 'plan-1' };

  let res;
  const status = () => res.status.mock.calls[0]?.[0];

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.user.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(where.id === 'org-1' ? orgAdmin : null)
    );
    mockPrisma.user.count.mockReset();
    mockPrisma.user.count.mockResolvedValue(19);
    mockPrisma.user.create.mockReset();
    mockSupabaseAdmin.auth.admin.createUser.mockReset();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('invite link', () => {
    it('is issued for the organization admin, not for the integrator', async () => {
      await createMyTeamInviteLink({ user: integrator, body: { role: 'MEMBER' } }, res);

      expect(status()).toBe(201);
      const { token } = res.json.mock.calls[0][0].invite;
      const invite = verifyTeamInviteToken(token);
      expect(invite.adminId).toBe('org-1');
      expect(invite.role).toBe('MEMBER');
      expect(mockPrisma.user.count.mock.calls[0][0].where.organizationAdminId).toBe('org-1');
    });

    it.each(['INTEGRATOR', 'ADMIN'])('cannot invite %s', async (role) => {
      await createMyTeamInviteLink({ user: integrator, body: { role } }, res);

      expect(status()).toBe(role === 'ADMIN' ? 400 : 403);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('requires a linked admin', async () => {
      await createMyTeamInviteLink(
        { user: { ...integrator, organizationAdminId: null }, body: { role: 'MEMBER' } },
        res
      );

      expect(status()).toBe(400);
    });

    it('stays closed to HR', async () => {
      await createMyTeamInviteLink({ user: { ...integrator, role: 'HR' }, body: { role: 'MEMBER' } }, res);

      expect(status()).toBe(403);
    });

    it('still lets ADMIN invite an INTEGRATOR', async () => {
      await createMyTeamInviteLink({ user: { id: 'org-1', role: 'ADMIN' }, body: { role: 'INTEGRATOR' } }, res);

      expect(status()).toBe(201);
    });
  });

  describe('createUser', () => {
    const body = { name: 'Nova Pessoa', email: 'nova@test.com', password: 'Str0ng!Passw0rd#1' };

    it('creates the user inside the organization of the integrator', async () => {
      mockSupabaseAdmin.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'new-1' } }, error: null });
      mockPrisma.user.create.mockResolvedValue({ id: 'new-1', ...body, role: 'HR', organizationAdminId: 'org-1' });

      await createUser({ user: integrator, body: { ...body, role: 'HR' } }, res);

      expect(status()).toBe(201);
      expect(mockPrisma.user.create.mock.calls[0][0].data.organizationAdminId).toBe('org-1');
    });

    it.each(['INTEGRATOR', 'ADMIN', 'SUPERADMIN'])('cannot create %s', async (role) => {
      await createUser({ user: integrator, body: { ...body, role } }, res);

      expect(status()).toBe(403);
      expect(mockSupabaseAdmin.auth.admin.createUser).not.toHaveBeenCalled();
    });
  });
});
