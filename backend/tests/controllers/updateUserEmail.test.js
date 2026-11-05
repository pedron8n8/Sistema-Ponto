// Trocar o email troca o login, entao ele precisa mudar no Supabase e no banco juntos,
// e so quem gerencia o usuario alvo pode fazer isso.

const mockPrisma = require('../mocks/prisma.mock');
const { mockSupabaseAdmin } = require('../mocks/supabase.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/config/supabase', () => ({ supabaseAdmin: mockSupabaseAdmin }));

const { updateUser } = require('../../src/controllers/user.controller');

describe('updateUser: email', () => {
  const member = { id: 'user-1', email: 'old@test.com', role: 'MEMBER', organizationAdminId: 'org-1', isActive: true };
  const integrator = { id: 'int-1', role: 'INTEGRATOR', organizationAdminId: 'org-1' };
  const updateAuth = mockSupabaseAdmin.auth.admin.updateUserById;

  let mockReq;
  let mockRes;

  const emailCalls = () => updateAuth.mock.calls.filter(([, payload]) => payload.email);

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockReq = { params: { id: 'user-1' }, user: integrator, body: { email: ' New@Test.com ' } };
    mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    updateAuth.mockReset();
    updateAuth.mockResolvedValue({ error: null });
    mockPrisma.user.update.mockReset();
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.user.findUnique.mockResolvedValueOnce(member).mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  it('INTEGRATOR changes the email in Supabase and in the database', async () => {
    mockPrisma.user.update.mockResolvedValue({ ...member, email: 'new@test.com' });

    await updateUser(mockReq, mockRes);

    expect(updateAuth).toHaveBeenCalledWith('user-1', { email: 'new@test.com', email_confirm: true });
    expect(mockPrisma.user.update.mock.calls[0][0].data.email).toBe('new@test.com');
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('HR cannot change an email', async () => {
    mockReq.user = { ...integrator, role: 'HR' };

    await updateUser(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(updateAuth).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it.each(['INTEGRATOR', 'ADMIN'])('INTEGRATOR cannot change the email of a %s', async (role) => {
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...member, role });

    await updateUser(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(updateAuth).not.toHaveBeenCalled();
  });

  it('INTEGRATOR cannot change the email of someone from another organization', async () => {
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.user.findUnique.mockResolvedValueOnce({ ...member, organizationAdminId: 'org-2' });

    await updateUser(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(updateAuth).not.toHaveBeenCalled();
  });

  it('rejects an invalid email', async () => {
    mockReq.body = { email: 'not-an-email' };

    await updateUser(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(updateAuth).not.toHaveBeenCalled();
  });

  it('returns 409 when the email belongs to someone else', async () => {
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.user.findUnique.mockResolvedValueOnce(member).mockResolvedValueOnce({ id: 'other' });

    await updateUser(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(updateAuth).not.toHaveBeenCalled();
  });

  it('does not touch the database when Supabase refuses', async () => {
    updateAuth.mockResolvedValue({ error: { message: 'taken' } });

    await updateUser(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('restores the Supabase email when the database update fails', async () => {
    mockPrisma.user.update.mockRejectedValue(new Error('db down'));

    await updateUser(mockReq, mockRes);

    expect(updateAuth).toHaveBeenLastCalledWith('user-1', { email: 'old@test.com', email_confirm: true });
    expect(mockRes.status).toHaveBeenCalledWith(500);
  });

  it('skips Supabase when the email is unchanged, even for HR', async () => {
    mockReq.user = { ...integrator, role: 'HR' };
    mockReq.body = { email: 'OLD@test.com', name: 'New Name' };
    mockPrisma.user.update.mockResolvedValue(member);

    await updateUser(mockReq, mockRes);

    expect(emailCalls()).toHaveLength(0);
    expect(mockPrisma.user.update.mock.calls[0][0].data.email).toBeUndefined();
    expect(mockPrisma.user.update.mock.calls[0][0].data.name).toBe('New Name');
  });
});
