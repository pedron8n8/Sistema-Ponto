const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { USER_PHOTO_DIR, ensureUserPhotoDir } = require('../utils/userPhoto');

const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUserPhotoDir();
    cb(null, USER_PHOTO_DIR);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeUserId = String(req.user?.id || 'user').replace(/[^a-zA-Z0-9_-]/g, '');
    const random = crypto.randomBytes(6).toString('hex');
    cb(null, `${safeUserId}-${Date.now()}-${random}${extension}`);
  },
});

const photoUpload = multer({
  storage,
  limits: {
    fileSize: MAX_PHOTO_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error('Formato de imagem inválido. Envie JPG, PNG ou WEBP.'));
      return;
    }

    cb(null, true);
  },
});

module.exports = {
  photoUpload,
  MAX_PHOTO_SIZE_BYTES,
};
