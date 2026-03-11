/**
 * Middleware de verificação de role
 * Verifica se o usuário autenticado possui uma das roles permitidas
 *
 * @param {Array<string>} allowedRoles - Array com as roles permitidas (ex: ['ADMIN', 'SUPERVISOR'])
 * @returns {Function} Express middleware
 */
const roleCheck = (allowedRoles) => {
  return (req, res, next) => {
    // Verifica se o usuário está autenticado
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Usuário não autenticado',
      });
    }

    // Verifica se o usuário tem uma das roles permitidas
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Acesso negado. Requer uma das seguintes permissões: ${allowedRoles.join(', ')}`,
        requiredRoles: allowedRoles,
        userRole: req.user.role,
      });
    }

    next();
  };
};

module.exports = roleCheck;
