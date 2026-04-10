import type { TFunction } from 'i18next'

export type MarketingPlan = {
  id: 'starter' | 'growth' | 'pro'
  name: string
  seats: string
  price: string
  description: string
  highlight?: boolean
  checkoutLink?: string
  features: string[]
}

const getPlanFeatures = (t: TFunction, plan: 'starter' | 'growth' | 'pro') => {
  if (plan === 'starter') {
    return [
      t('pricing.featureStarter1'),
      t('pricing.featureStarter2'),
      t('pricing.featureStarter3'),
      t('pricing.featureStarter4'),
    ]
  }
  if (plan === 'growth') {
    return [
      t('pricing.featureGrowth1'),
      t('pricing.featureGrowth2'),
      t('pricing.featureGrowth3'),
      t('pricing.featureGrowth4'),
    ]
  }
  return [
    t('pricing.featurePro1'),
    t('pricing.featurePro2'),
    t('pricing.featurePro3'),
    t('pricing.featurePro4'),
  ]
}

export const getMarketingPlans = (t: TFunction): MarketingPlan[] => {
  return [
    {
      id: 'starter',
      name: t('pricing.starterName'),
      seats: t('pricing.starterSeats'),
      price: t('pricing.starterPrice'),
      description: t('pricing.starterDescription'),
      checkoutLink: import.meta.env.VITE_STRIPE_LINK_STARTER as string | undefined,
      features: getPlanFeatures(t, 'starter'),
    },
    {
      id: 'growth',
      name: t('pricing.growthName'),
      seats: t('pricing.growthSeats'),
      price: t('pricing.growthPrice'),
      description: t('pricing.growthDescription'),
      checkoutLink: import.meta.env.VITE_STRIPE_LINK_GROWTH as string | undefined,
      highlight: true,
      features: getPlanFeatures(t, 'growth'),
    },
    {
      id: 'pro',
      name: t('pricing.proName'),
      seats: t('pricing.proSeats'),
      price: t('pricing.proPrice'),
      description: t('pricing.proDescription'),
      checkoutLink: import.meta.env.VITE_STRIPE_LINK_PRO as string | undefined,
      features: getPlanFeatures(t, 'pro'),
    },
  ]
}
