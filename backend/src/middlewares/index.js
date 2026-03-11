const authMiddleware = require('./auth.middleware');
const roleCheck = require('./roleCheck.middleware');

module.exports = {
  authMiddleware,
  roleCheck,
};
