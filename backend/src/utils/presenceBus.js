const { EventEmitter } = require('events');

// ponytail: bus in-process. O docker-compose roda um único container de API
// (backendponto), então todas as conexões SSE vivem no mesmo processo.
// Se virar cluster/multi-réplica, trocar por Redis pub/sub (ioredis já é dependência).
const presenceBus = new EventEmitter();
presenceBus.setMaxListeners(0); // 1 listener por conexão SSE aberta

const emitPunch = (userId) => {
  presenceBus.emit('punch', { userId });
};

module.exports = { presenceBus, emitPunch };
