// evaluateOvertimeThreshold precisa respeitar a mesma tolerancia (buffer) da
// empresa que o clock-out, o recalculo do dia e o painel de presenca ja
// respeitam: dentro do buffer, sem alerta; acima, o excedente inteiro.

const mockPrisma = require('../mocks/prisma.mock');

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn().mockResolvedValue({}) })),
  Worker: jest.fn(),
}));
jest.mock('../../src/config/redis', () => ({
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
}));
jest.mock('../../src/config/database', () => ({ prisma: require('../mocks/prisma.mock') }));
jest.mock('../../src/utils/notifications', () => ({
  sendOvertimeThresholdNotification: jest.fn(),
  getEnabledOvertimeChannels: jest.fn(() => ['IN_APP']),
}));
jest.mock('../../src/utils/slackNotifier', () => ({ sendSlackDM: jest.fn() }));
jest.mock('../../src/utils/resendNotifier', () => ({ sendResendEmail: jest.fn() }));

const { Queue } = require('bullmq');
const redis = require('../../src/config/redis');
const { getEnabledOvertimeChannels } = require('../../src/utils/notifications');
const { evaluateOvertimeThreshold } = require('../../src/workers/proactiveAlertWorker');

const queueInstance = Queue.mock.results[0].value;

// Formata "HH:MM" de um total de minutos, para simular o fim de jornada em UTC.
const minutesToHHMM = (totalMinutes) => {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}`;
};

const nowUtcMinutes = () => {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes();
};

// role SUPERADMIN atalha resolveEffectivePlan (sempre PRO/ACTIVE), isolando
// o teste da regra de plano — o que esta sob teste aqui e so o buffer.
const buildMember = ({ contractDailyMinutes = 480, bankHoursLimitMinutes = 100, organizationAdminId = 'admin-1' }) => ({
  id: 'member-1',
  name: 'Membro',
  email: 'membro@test.com',
  role: 'SUPERADMIN',
  timeZone: 'UTC',
  // Janela padrao de alerta de fim de turno: ate 90min depois do fim conta
  // como "perto do fim do turno". 10 minutos atras cai bem dentro dela.
  workdayEndTime: minutesToHHMM(nowUtcMinutes() - 10),
  contractDailyMinutes,
  bankHoursLimitMinutes,
  slackUserId: null,
  organizationAdminId,
});

describe('evaluateOvertimeThreshold com buffer da empresa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    getEnabledOvertimeChannels.mockReturnValue(['IN_APP']);
    queueInstance.add.mockResolvedValue({});
  });

  it('nao dispara quando o excedente cabe inteiro dentro do buffer da empresa', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 100 } });

    // limite=100 -> threshold=80 (80% de 100). Excedente bruto de 90 supera o
    // threshold, mas cabe dentro do buffer de 100: gatilho nao ativa.
    const member = buildMember({ contractDailyMinutes: 480, bankHoursLimitMinutes: 100 });
    const rawExcess = 90;
    const openEntry = {
      id: 'entry-1',
      userId: member.id,
      clockIn: new Date(Date.now() - (480 + rawExcess) * 60000),
    };

    const outcome = await evaluateOvertimeThreshold({
      openEntry,
      member,
      now: new Date(),
      workedMinutesByUser: {},
      bufferMinutesByOrg: new Map(),
    });

    expect(outcome).toBe('skipped');
    expect(queueInstance.add).not.toHaveBeenCalled();
  });

  it('dispara com o excedente inteiro (nao o excedente menos o buffer) quando ultrapassa o buffer', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 100 } });

    const member = buildMember({ contractDailyMinutes: 480, bankHoursLimitMinutes: 100 });
    const rawExcess = 110;
    const openEntry = {
      id: 'entry-1',
      userId: member.id,
      clockIn: new Date(Date.now() - (480 + rawExcess) * 60000),
    };

    const outcome = await evaluateOvertimeThreshold({
      openEntry,
      member,
      now: new Date(),
      workedMinutesByUser: {},
      bufferMinutesByOrg: new Map(),
    });

    expect(outcome).toBe('enqueued');
    expect(queueInstance.add).toHaveBeenCalledTimes(1);
    // Gatilho, nao desconto: paga os 110 minutos inteiros, nao 10 (110-100).
    expect(queueInstance.add.mock.calls[0][1].alertPayload.overtimeMinutes).toBe(110);
  });

  it('sem buffer configurado mantem o comportamento de hoje (alerta pelo excedente bruto)', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);

    const member = buildMember({ contractDailyMinutes: 480, bankHoursLimitMinutes: 100 });
    const rawExcess = 90; // acima do threshold (80), sem buffer para segurar
    const openEntry = {
      id: 'entry-1',
      userId: member.id,
      clockIn: new Date(Date.now() - (480 + rawExcess) * 60000),
    };

    const outcome = await evaluateOvertimeThreshold({
      openEntry,
      member,
      now: new Date(),
      workedMinutesByUser: {},
      bufferMinutesByOrg: new Map(),
    });

    expect(outcome).toBe('enqueued');
    expect(queueInstance.add.mock.calls[0][1].alertPayload.overtimeMinutes).toBe(90);
  });

  it('le o buffer da empresa uma vez por organizationAdminId, mesmo com dois membros', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: { bufferMinutes: 100 } });

    const sharedCache = new Map();
    const memberA = buildMember({ organizationAdminId: 'admin-shared' });
    const memberB = { ...buildMember({ organizationAdminId: 'admin-shared' }), id: 'member-2' };

    const openEntryFor = (member) => ({
      id: `entry-${member.id}`,
      userId: member.id,
      clockIn: new Date(Date.now() - (480 + 10) * 60000),
    });

    await evaluateOvertimeThreshold({
      openEntry: openEntryFor(memberA),
      member: memberA,
      now: new Date(),
      workedMinutesByUser: {},
      bufferMinutesByOrg: sharedCache,
    });
    await evaluateOvertimeThreshold({
      openEntry: openEntryFor(memberB),
      member: memberB,
      now: new Date(),
      workedMinutesByUser: {},
      bufferMinutesByOrg: sharedCache,
    });

    expect(mockPrisma.appSetting.findUnique).toHaveBeenCalledTimes(1);
  });
});
