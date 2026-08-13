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

    if (req.user.role === 'SUPERADMIN') {
      return next();
    }

    // INTEGRATOR alcança tudo que HR alcança. Expandir aqui evita repetir
    // 'INTEGRATOR' em cada guard de rota do sistema.
    const allowed = allowedRoles.includes('HR')
      ? [...allowedRoles, 'INTEGRATOR']
      : allowedRoles;

    // Verifica se o usuário tem uma das roles permitidas
    if (!allowed.includes(req.user.role)) {
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
