const fs = require('fs');
const path = require('path');

const USER_PHOTO_DIR = path.resolve(__dirname, '../../uploads/user-photos');

const ensureUserPhotoDir = () => {
  if (!fs.existsSync(USER_PHOTO_DIR)) {
    fs.mkdirSync(USER_PHOTO_DIR, { recursive: true });
  }
};

const normalizePhotoPath = (photoPath) => {
  if (!photoPath) return null;
  const normalized = String(photoPath).replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const buildUserPhotoUrl = (req, photoPath) => {
  const normalizedPath = normalizePhotoPath(photoPath);
  if (!normalizedPath) return null;

  const origin = `${req.protocol}://${req.get('host')}`;
  return `${origin}${normalizedPath}`;
};

module.exports = {
  USER_PHOTO_DIR,
  ensureUserPhotoDir,
  normalizePhotoPath,
  buildUserPhotoUrl,
};
