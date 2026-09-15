// O buffer decide folha de pagamento, entao a LEITURA nunca pode falhar: sem
// linha, com lixo gravado ou com o banco fora do ar, o valor e 0 — que e o
// comportamento que o sistema tinha antes desta feature.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

const {
  OVERTIME_BUFFER_KEY_PREFIX,
  MAX_OVERTIME_BUFFER_MINUTES,
  DEFAULT_OVERTIME_BUFFER_MINUTES,
  resolveOrganizationAdminId,
  normalizeBufferMinutes,
  getOvertimeBufferMinutes,
} = require('../../src/utils/overtimeBuffer');

describe('resolveOrganizationAdminId', () => {
  it('usa o organizationAdminId do colaborador', () => {
    expect(resolveOrganizationAdminId({ id: 'member-1', organizationAdminId: 'admin-1' })).toBe('admin-1');
  });

  it('cai no proprio id quando nao ha organizationAdminId (o ADMIN e a empresa)', () => {
    expect(resolveOrganizationAdminId({ id: 'admin-1', organizationAdminId: null })).toBe('admin-1');
  });

  it('devolve null quando nao da para resolver', () => {
    expect(resolveOrganizationAdminId(null)).toBeNull();
    expect(resolveOrganizationAdminId({})).toBeNull();
  });
});

describe('normalizeBufferMinutes', () => {
  it('trunca para inteiro', () => {
    expect(normalizeBufferMinutes(10.9)).toBe(10);
  });

  it('limita no teto de 120 minutos', () => {
    expect(normalizeBufferMinutes(500)).toBe(MAX_OVERTIME_BUFFER_MINUTES);
    expect(MAX_OVERTIME_BUFFER_MINUTES).toBe(120);
  });

  it('trata negativo, NaN, string e ausencia como 0', () => {
    expect(normalizeBufferMinutes(-5)).toBe(0);
    expect(normalizeBufferMinutes(NaN)).toBe(0);
    expect(normalizeBufferMinutes('10')).toBe(0);
    expect(normalizeBufferMinutes(undefined)).toBe(0);
    expect(normalizeBufferMinutes(null)).toBe(0);
  });
});

describe('getOvertimeBufferMinutes', () => {
  it('le a linha da empresa pela chave com prefixo', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 10 } });

    await expect(getOvertimeBufferMinutes('admin-1')).resolves.toBe(10);
    expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledWith({
      where: { key: `${OVERTIME_BUFFER_KEY_PREFIX}admin-1` },
    });
  });

  // Regra do produto: sem configuracao o buffer vem LIGADO em 15.
  it('devolve o default de 15 quando a empresa nunca configurou', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    await expect(getOvertimeBufferMinutes('admin-1')).resolves.toBe(DEFAULT_OVERTIME_BUFFER_MINUTES);
    expect(DEFAULT_OVERTIME_BUFFER_MINUTES).toBe(15);
  });

  it('devolve o default sem consultar o banco quando nao ha empresa', async () => {
    await expect(getOvertimeBufferMinutes(null)).resolves.toBe(15);
    expect(mockPrisma.appSetting.findUnique).not.toHaveBeenCalled();
  });

  it('respeita 0 explicito gravado pelo admin (desligado)', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 0 } });

    await expect(getOvertimeBufferMinutes('admin-1')).resolves.toBe(0);
  });

  it('devolve 0 quando o valor gravado e lixo', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 'dez' } });

    await expect(getOvertimeBufferMinutes('admin-1')).resolves.toBe(0);
  });

  // Erro de configuracao nao pode impedir alguem de bater ponto, nem desligar a regra.
  it('devolve o default quando a leitura estoura, sem propagar', async () => {
    mockPrisma.appSetting.findUnique.mockRejectedValue(new Error('connection refused'));

    await expect(getOvertimeBufferMinutes('admin-1')).resolves.toBe(15);
  });
});
