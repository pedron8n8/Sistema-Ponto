import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTimeZone } from '../context/TimezoneContext'
import { usePlan } from '../hooks/usePlan'
import { TIME_ZONE_OPTIONS } from '../lib/timezone'
import { splitMessageLink } from '../lib/errorMessage'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher'
import BrandWordmark from './BrandWordmark'
import UserAvatar from './UserAvatar'
import DualClock from './DualClock'

const iconClassName = 'h-5 w-5 shrink-0'

const OverviewIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={iconClassName}>
    <path d="M3 12L12 4L21 12" />
    <path d="M5 10.5V20H19V10.5" />
  </svg>
)

const TimeClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={iconClassName}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12L15.5 14" />
  </svg>
)

const HistoryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={iconClassName}>
    <path d="M12 8V12L14.8 13.8" />
    <path d="M20 12A8 8 0 1 1 17.7 6.3" />
    <path d="M20 4V8H16" />
  </svg>
)

const SupervisorIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={iconClassName}>
    <circle cx="9" cy="8.5" r="2.3" />
    <circle cx="16" cy="9.5" r="2" />
    <path d="M4.5 18C5 15.6 6.9 14.2 9 14.2C11.1 14.2 13 15.6 13.5 18" />
    <path d="M13.5 17.6C13.9 16 15.1 15 16.4 15C17.7 15 18.9 16 19.3 17.6" />
  </svg>
)

const TeamVacationIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={iconClassName}>
    <path d="M3.5 18.5H20.5" />
    <path d="M6 18.5C6.2 15 8.3 13 11 13C13.7 13 15.8 15 16 18.5" />
    <circle cx="11" cy="9" r="2.2" />
    <path d="M16.8 6.2L20.2 9.6" />
  </svg>
)

const AdminIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={iconClassName}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.2V16.8" />
    <path d="M7.2 12H16.8" />
  </svg>
)

const SuperAdminIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={iconClassName}>
    <path d="M12 3.8L19.2 6.8V12.5C19.2 16.5 16.3 20.1 12 21.2C7.7 20.1 4.8 16.5 4.8 12.5V6.8L12 3.8Z" />
    <path d="M9.3 12.1L11.2 14L14.9 10.3" />
  </svg>
)

const ReportsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={iconClassName}>
    <path d="M6 3.8H14.8L18 7V20.2H6V3.8Z" />
    <path d="M14.5 3.8V7.3H18" />
    <path d="M8.5 11.5H15.5" />
    <path d="M8.5 15H15.5" />
  </svg>
)

type NavItem = {
  to: string
  label: string
  icon: React.ReactNode
  end?: boolean
}

type NavSection = {
  title: string
  visible: boolean
  items: NavItem[]
}

const ShellLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, profileError, signOut } = useAuth()
  const { isGrowthOrBetter, isPro } = usePlan()
  const { viewTimeZone, setViewTimeZone } = useTimeZone()
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const parsedProfileError = splitMessageLink(profileError || '')
  const isSuperAdmin = profile?.role === 'SUPERADMIN'
  const isAdmin = profile?.role === 'ADMIN' || profile?.role === 'SUPERADMIN'
  const isOnlyAdmin = profile?.role === 'ADMIN'
  const canManageProSettings = profile?.role === 'ADMIN' || profile?.role === 'HR'
  const isSupervisor = profile?.role === 'SUPERVISOR' || profile?.role === 'HR' || isAdmin
  const navSections: NavSection[] = [
    {
      title: t('General', 'Geral'),
      visible: true,
      items: [
        { to: '/app', label: t('Overview', 'Visao geral'), icon: <OverviewIcon />, end: true },
        { to: '/app/relatorios', label: t('Reports', 'Relatorios'), icon: <ReportsIcon /> },
      ],
    },
    {
      title: t('Member', 'Colaborador'),
      visible: true,
      items: [
        { to: '/app/colaborador', label: t('Time clock', 'Ponto'), icon: <TimeClockIcon /> },
        { to: '/app/colaborador/historico', label: t('History', 'Historico'), icon: <HistoryIcon /> },
        ...(isGrowthOrBetter
          ? [
              {
                to: '/app/colaborador/ferias',
                label: t('My vacations', 'Minhas Ferias'),
                icon: <TeamVacationIcon />, // Usando o icone de equipe
              },
            ]
          : []),
      ],
    },
    {
      title: t('Supervisor', 'Supervisor'),
      visible: isSupervisor,
      items: [
        {
          to: '/app/supervisor/overview',
          label: t('Supervisor Overview', 'Supervisor Overview'),
          icon: <SupervisorIcon />,
        },
        {
          to: '/app/supervisor/kpis',
          label: t('Supervisor KPIs', 'Supervisor KPIs'),
          icon: <SupervisorIcon />,
        },
        {
          to: '/app/supervisor/hours',
          label: t('Supervisor Hours', 'Supervisor Horas'),
          icon: <SupervisorIcon />,
        },
        {
          to: '/app/supervisor/pending-items',
          label: t('Supervisor Pendings', 'Supervisor Pendings'),
          icon: <SupervisorIcon />,
        },
        ...(isGrowthOrBetter
          ? [
              {
                to: '/app/ferias-equipe',
                label: t('Team vacation', 'Ferias equipe'),
                icon: <TeamVacationIcon />,
              },
            ]
          : []),
      ],
    },
    {
      title: t('SuperAdmin', 'SuperAdmin'),
      visible: isSuperAdmin,
      items: [
        {
          to: '/app/superadmin/accounts',
          label: t('Accounts & MRR', 'Contas e MRR'),
          icon: <SuperAdminIcon />,
        },
      ],
    },
    {
      title: t('Admin', 'Admin'),
      visible: isOnlyAdmin,
      items: [
        {
          to: '/app/admin/users',
          label: t('Users & seats', 'Usuarios e assentos'),
          icon: <AdminIcon />,
        },
        {
          to: '/app/admin/bank-hours',
          label: t('Bank hours', 'Banco de horas'),
          icon: <AdminIcon />,
        },
        {
          to: '/app/admin/pending-approvals',
          label: t('Pending approvals', 'Pendencias aprovacao'),
          icon: <AdminIcon />,
        },
        ...(isOnlyAdmin
          ? [
              {
                to: '/app/admin/financeiro',
                label: t('Finance', 'Financeiro'),
                icon: <AdminIcon />,
              },
              {
                to: '/app/admin/comprar-assentos',
                label: t('Buy seats', 'Comprar assentos'),
                icon: <AdminIcon />,
              },
            ]
          : []),
        ...(isGrowthOrBetter
          ? [
              {
                to: '/app/admin/qr-code',
                label: t('Admin QR Code', 'Admin QR Code'),
                icon: <AdminIcon />,
              },
            ]
          : []),
        ...(isPro && canManageProSettings
          ? [
              {
                to: '/app/admin/pro-settings',
                label: t('Pro settings', 'Config PRO'),
                icon: <AdminIcon />,
              },
            ]
          : []),
      ],
    },
  ]

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <div className="flex">
        <aside className="peer/sidebar group/sidebar fixed left-0 top-0 z-20 hidden h-screen border-r border-white/80 bg-white/85 p-2 shadow-[0_18px_35px_-25px_rgba(15,23,42,0.55)] backdrop-blur transition-all duration-300 md:block md:w-[4.5rem] md:hover:w-64 md:focus-within:w-64">
          <div className="flex h-full flex-col">
            <Link
              to="/app/perfil-completo"
              className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-700 transition hover:bg-slate-100"
              title={t('Open complete profile', 'Abrir perfil completo')}
            >
              <UserAvatar name={profile?.name} photoUrl={profile?.photoUrl} size="sm" />
              <div className="truncate transition-all duration-200 md:max-w-0 md:opacity-0 md:group-hover/sidebar:max-w-[170px] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[170px] md:group-focus-within/sidebar:opacity-100">
                <BrandWordmark className="text-xl" />
              </div>
            </Link>

            <nav className="space-y-3">
              {navSections
                .filter((section) => section.visible)
                .map((section) => (
                  <div key={section.title} className="space-y-1">
                    <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 transition-all duration-200 md:max-w-0 md:opacity-0 md:group-hover/sidebar:max-w-[180px] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[180px] md:group-focus-within/sidebar:opacity-100">
                      {section.title}
                    </p>
                    {section.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition ${
                            isActive ? 'bg-teal-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                          }`
                        }
                        title={item.label}
                      >
                        {item.icon}
                        <span className="truncate transition-all duration-200 md:max-w-0 md:opacity-0 md:group-hover/sidebar:max-w-[180px] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[180px] md:group-focus-within/sidebar:opacity-100">
                          {item.label}
                        </span>
                      </NavLink>
                    ))}
                  </div>
                ))}
            </nav>

            <div className="mt-auto rounded-2xl border border-slate-200 bg-white/80 p-3 text-slate-700 transition-all duration-200 md:max-h-0 md:overflow-hidden md:opacity-0 md:group-hover/sidebar:max-h-[18rem] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-h-[18rem] md:group-focus-within/sidebar:opacity-100">
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{t('TZ', 'Fuso')}</p>
                  <select
                    value={viewTimeZone}
                    onChange={(event) => setViewTimeZone(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                  >
                    {TIME_ZONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{t('Language', 'Idioma')}</p>
                  <div className="mt-1 inline-block">
                    <LanguageSwitcher />
                  </div>
                </div>

                <button
                  onClick={signOut}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 hover:border-slate-300"
                >
                  {t('Sign out', 'Sair')}
                </button>
              </div>
            </div>
          </div>
        </aside>

        <div className="w-full transition-all duration-300 md:pl-[5.3rem] md:peer-hover/sidebar:pl-[16.8rem] md:peer-focus/sidebar:pl-[16.8rem]">
          <div className="px-5 pt-6 sm:px-8">
            <div className="mx-auto w-full max-w-7xl">
              <div className="fixed right-4 top-4 z-50 hidden items-center gap-3 md:flex xl:right-6 xl:top-5">
                <DualClock variant="mini" className="rounded-full border border-white/80 bg-white/85 px-3 py-1 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.85)]" />
                <div className="group/profile relative">
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-full border border-white/80 bg-white/85 p-1 pr-3 text-xs font-semibold text-slate-700 shadow-[0_10px_24px_-24px_rgba(15,23,42,0.85)] transition hover:border-slate-200"
                    aria-label={t('Profile actions', 'Acoes de perfil')}
                  >
                    <UserAvatar name={profile?.name} photoUrl={profile?.photoUrl} size="sm" />
                    <span>{profile?.name?.split(' ')[0] ?? t('Profile', 'Perfil')}</span>
                  </button>

                  <div className="pointer-events-none absolute right-0 top-[calc(100%+0.5rem)] z-40 w-48 rounded-2xl border border-slate-200 bg-white p-2 opacity-0 shadow-[0_16px_35px_-24px_rgba(15,23,42,0.65)] transition-all duration-150 group-hover/profile:pointer-events-auto group-hover/profile:translate-y-0 group-hover/profile:opacity-100 group-focus-within/profile:pointer-events-auto group-focus-within/profile:translate-y-0 group-focus-within/profile:opacity-100">
                    <Link
                      to="/app/perfil-completo"
                      className="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      {t('Complete Profile', 'Perfil Completo')}
                    </Link>
                    <button
                      onClick={signOut}
                      className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      {t('Sign out', 'Sair')}
                    </button>
                  </div>
                </div>
              </div>

              <nav className="mb-4 flex gap-2 overflow-x-auto rounded-2xl border border-white/80 bg-white/80 p-2 shadow-[0_10px_26px_-25px_rgba(15,23,42,0.6)] backdrop-blur md:hidden">
                {navSections
                  .filter((section) => section.visible)
                  .flatMap((section) => section.items)
                  .map((item) => (
                    <NavLink
                      key={`mobile-${item.to}`}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition ${
                          isActive ? 'bg-teal-700 text-white' : 'bg-white text-slate-600'
                        }`
                      }
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
              </nav>

              <div className="mb-4 rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[0_10px_26px_-25px_rgba(15,23,42,0.6)] backdrop-blur md:hidden">
                <div className="mb-3 flex items-center gap-3">
                  <UserAvatar name={profile?.name} photoUrl={profile?.photoUrl} size="sm" />
                  <div>
                    <BrandWordmark className="text-lg" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{t('TZ', 'Fuso')}</label>
                  <select
                    value={viewTimeZone}
                    onChange={(event) => setViewTimeZone(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                  >
                    {TIME_ZONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <label className="mt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{t('Language', 'Idioma')}</label>
                  <div>
                    <LanguageSwitcher />
                  </div>
                  <button
                    onClick={signOut}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700"
                  >
                    {t('Sign out', 'Sair')}
                  </button>
                </div>
              </div>

              {profileError ? (
                <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">
                  {parsedProfileError.text || profileError}
                  {parsedProfileError.url ? (
                    <>
                      {' '}
                      <a
                        href={parsedProfileError.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline decoration-amber-500 underline-offset-2 hover:text-amber-950"
                      >
                        {t('here', 'aqui')}
                      </a>
                    </>
                  ) : null}{' '}
                  {t('Contact the administrator to enable access.', 'Entre em contato com o administrador para habilitar o acesso.')}
                </div>
              ) : null}

              <main className="pb-8">{children}</main>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ShellLayout
