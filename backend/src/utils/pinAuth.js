const crypto = require('crypto');

const PIN_REGEX = /^\d{4,8}$/;
const PIN_MAX_ATTEMPTS = Number(process.env.PIN_MAX_ATTEMPTS || 5);
const PIN_LOCK_MINUTES = Number(process.env.PIN_LOCK_MINUTES || 15);

const isValidPinFormat = (pin) => PIN_REGEX.test(String(pin || ''));

const hashPin = (pin, salt = crypto.randomBytes(16).toString('hex')) => {
  const normalizedPin = String(pin);
  const hash = crypto.scryptSync(normalizedPin, salt, 64).toString('hex');
  return { hash, salt };
};

const verifyPin = ({ pin, hash, salt }) => {
  if (!hash || !salt || !pin) return false;
  const candidate = crypto.scryptSync(String(pin), salt, 64).toString('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
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
