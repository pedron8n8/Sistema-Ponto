const crypto = require('crypto');
const { promisify } = require('util');

const PIN_REGEX = /^\d{4,8}$/;
const PIN_MAX_ATTEMPTS = Number(process.env.PIN_MAX_ATTEMPTS || 5);
const PIN_LOCK_MINUTES = Number(process.env.PIN_LOCK_MINUTES || 15);

const isValidPinFormat = (pin) => PIN_REGEX.test(String(pin || ''));

// scrypt async (threadpool do libuv) em vez de scryptSync: cada derivação custa
// ~50-200ms de CPU e a versão síncrona travava o event loop inteiro. No fim do
// turno, com vários pontos ao mesmo tempo, isso estourava a janela de 3s do
// Slack e o comando morria com "the app did not respond".
// Mesmos parâmetros default do scryptSync — hashes existentes seguem válidos.
const scrypt = promisify(crypto.scrypt);

const hashPin = async (pin, salt = crypto.randomBytes(16).toString('hex')) => {
  const derived = await scrypt(String(pin), salt, 64);
  return { hash: derived.toString('hex'), salt };
};

const verifyPin = async ({ pin, hash, salt }) => {
  if (!hash || !salt || !pin) return false;
  const derived = await scrypt(String(pin), salt, 64);

  try {
    return crypto.timingSafeEqual(derived, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
};

const isPinLocked = (lockedUntil) => {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
};

const getPinLockExpiry = () => {
  const lockUntil = new Date();
  lockUntil.setMinutes(lockUntil.getMinutes() + PIN_LOCK_MINUTES);
  return lockUntil;
};

module.exports = {
  isValidPinFormat,
  hashPin,
  verifyPin,
  isPinLocked,
  getPinLockExpiry,
  PIN_MAX_ATTEMPTS,
  PIN_LOCK_MINUTES,
};
