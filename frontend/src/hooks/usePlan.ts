import { useAuth } from '../context/AuthContext'

export type PlanCode = 'BASE' | 'STARTER' | 'GROWTH' | 'PRO'

const PLAN_LEVELS: Record<string, number> = {
  BASE: 0,
  STARTER: 1,
  GROWTH: 2,
  PRO: 3,
}

export const usePlan = () => {
  const auth = useAuth()

  const rawCurrentPlan = (auth?.profile?.currentPlan as PlanCode) || 'STARTER'
  const currentPlan = rawCurrentPlan === 'BASE' ? 'STARTER' : rawCurrentPlan
  const currentPlanStatus = auth?.profile?.currentPlanStatus || 'INACTIVE'
  const isSuperadmin = auth?.profile?.role === 'SUPERADMIN'

  // @ts-ignore
  const userLevel = PLAN_LEVELS[currentPlan] || 0

  const hasPlan = (requiredPlan: PlanCode | PlanCode[]) => {
    if (isSuperadmin) return true

    if (currentPlanStatus !== 'ACTIVE') {
      return false
    }

    const plansArray = Array.isArray(requiredPlan) ? requiredPlan : [requiredPlan]
    // @ts-ignore
    const minRequiredLevel = Math.min(...plansArray.map((p) => PLAN_LEVELS[p] || 0))

    return userLevel >= minRequiredLevel
  }

  return {
    currentPlan,
    currentPlanStatus,
    hasPlan,
    isGrowthOrBetter: hasPlan(['GROWTH', 'PRO']),
    isPro: hasPlan('PRO'),
    isStarterOrBetter: hasPlan(['STARTER', 'GROWTH', 'PRO']),
  }
}

