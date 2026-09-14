const { prisma } = require('../config/database');

// A chave carrega o escopo: nao ha tabela nova, e o mesmo mecanismo da geofence
// (utils/geofence.js) com um sufixo por empresa. Ao contrario da geofence, NAO
// ha cache em singleton de processo: aquele padrao assume um valor global e
// aqui o valor e por tenant.
const OVERTIME_BUFFER_KEY_PREFIX = 'overtimeBuffer:';

// Acima disto deixa de ser tolerancia de relogio e vira jornada nao remunerada.
const MAX_OVERTIME_BUFFER_MINUTES = 120;

/** A empresa de um usuario: um ADMIN e a propria empresa, e seus colaboradores apontam para ele. */
const resolveOrganizationAdminId = (user) => {
  if (!user) return null;
  return user.organizationAdminId || user.id || null;
};

/**
 * Inteiro truncado, limitado a 0..120. Nao numero, negativo ou NaN viram 0.
 * Usado na LEITURA, onde o dado ja esta gravado e o calculo nao pode falhar.
 * A ESCRITA (admin.controller) recusa fora da faixa em vez de truncar.
 */
const normalizeBufferMinutes = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_OVERTIME_BUFFER_MINUTES, Math.floor(value));
};

const buildOvertimeBufferKey = (organizationAdminId) =>
  `${OVERTIME_BUFFER_KEY_PREFIX}${organizationAdminId}`;

/**
 * Buffer vigente da empresa, em minutos. Nunca lanca: ausencia, valor invalido
 * ou falha de leitura viram 0, porque um erro de configuracao nao pode impedir
 * alguem de bater ponto.
 */
const getOvertimeBufferMinutes = async (organizationAdminId) => {
  if (!organizationAdminId) return 0;

  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: buildOvertimeBufferKey(organizationAdminId) },
    });

    return normalizeBufferMinutes(row?.value?.bufferMinutes);
  } catch (error) {
    console.warn('[overtimeBuffer] Nao foi possivel ler o buffer da empresa:', error.message);
    return 0;
  }
};

module.exports = {
  OVERTIME_BUFFER_KEY_PREFIX,
  MAX_OVERTIME_BUFFER_MINUTES,
  resolveOrganizationAdminId,
  normalizeBufferMinutes,
  buildOvertimeBufferKey,
  getOvertimeBufferMinutes,
};
