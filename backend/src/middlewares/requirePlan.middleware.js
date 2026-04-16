const requirePlan = (requiredPlans) => {
  return (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Usuário não autenticado.',
        });
      }

      // SUPERADMIN has access to everything
      if (user.role === 'SUPERADMIN') {
        return next();
      }

      const rawCurrentPlan = String(user.currentPlan || 'STARTER').trim().toUpperCase();
      const currentPlan = rawCurrentPlan === 'BASE' ? 'STARTER' : rawCurrentPlan;
      const currentPlanStatus = user.currentPlanStatus || 'INACTIVE';

      if (currentPlanStatus !== 'ACTIVE') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Plano atual inativo ou com pendências.',
          planCode: currentPlan,
        });
      }

      const plansArray = Array.isArray(requiredPlans)
        ? requiredPlans
        : [requiredPlans];

      const PLAN_LEVELS = {
        BASE: 0,
        STARTER: 1,
        GROWTH: 2,
        PRO: 3,
      };

      const userPlanLevel = PLAN_LEVELS[currentPlan] || 0;
      
      // Compara se o nível do plano do usuário é >= ao menor nível exigido
      const minRequiredLevel = Math.min(
        ...plansArray.map((p) => PLAN_LEVELS[p] || 0)
      );

      if (userPlanLevel < minRequiredLevel) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Esta funcionalidade requer um plano ${plansArray.join(' ou ')}.`,
          code: 'UPGRADE_REQUIRED',
        });
      }

      next();
    } catch (error) {
      console.error('❌ Erro no middleware requirePlan:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

module.exports = requirePlan;
