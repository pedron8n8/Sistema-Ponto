const {
  issuePublicApiToken,
  verifyPublicApiToken,
} = require('../../src/utils/publicApiToken');

describe('publicApiToken util', () => {
  const originalSecret = process.env.PUBLIC_API_HMAC_SECRET;

  beforeEach(() => {
    process.env.PUBLIC_API_HMAC_SECRET = '1234567890abcdef1234567890abcdef';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    process.env.PUBLIC_API_HMAC_SECRET = originalSecret;
  });

  it('issues and verifies a valid token', () => {
    const issued = issuePublicApiToken({
      adminId: 'admin-123',
      issuedById: 'admin-123',
      scopes: ['payroll:read'],
      expiresInHours: 24,
    });

    const payload = verifyPublicApiToken(issued.token);

    expect(payload.adminId).toBe('admin-123');
    expect(payload.scopes).toEqual(['payroll:read']);
  });

  it('rejects token with invalid signature', () => {
    const issued = issuePublicApiToken({
      adminId: 'admin-123',
      expiresInHours: 24,
    });

    const tamperedToken = `${issued.token}tampered`;

    expect(() => verifyPublicApiToken(tamperedToken)).toThrow('Assinatura do token inválida.');
  });

  it('rejects expired token', () => {
    jest.useFakeTimers();

    const initialTime = new Date('2026-04-01T10:00:00.000Z');
    jest.setSystemTime(initialTime);

    const issued = issuePublicApiToken({
      adminId: 'admin-123',
      expiresInHours: 1,
    });

    jest.setSystemTime(new Date('2026-04-01T12:30:00.000Z'));

    expect(() => verifyPublicApiToken(issued.token)).toThrow('Token expirado.');
  });
});
