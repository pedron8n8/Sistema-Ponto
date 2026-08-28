import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
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
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <path d="M3 12L12 4L21 12" />
    <path d="M5 10.5V20H19V10.5" />
  </svg>
)

const TimeClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12L15.5 14" />
  </svg>
)

const HistoryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <path d="M12 8V12L14.8 13.8" />
    <path d="M20 12A8 8 0 1 1 17.7 6.3" />
    <path d="M20 4V8H16" />
  </svg>
)

const SupervisorIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <circle cx="9" cy="8.5" r="2.3" />
    <circle cx="16" cy="9.5" r="2" />
    <path d="M4.5 18C5 15.6 6.9 14.2 9 14.2C11.1 14.2 13 15.6 13.5 18" />
    <path d="M13.5 17.6C13.9 16 15.1 15 16.4 15C17.7 15 18.9 16 19.3 17.6" />
  </svg>
)

const TeamVacationIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <path d="M3.5 18.5H20.5" />
    <path d="M6 18.5C6.2 15 8.3 13 11 13C13.7 13 15.8 15 16 18.5" />
    <circle cx="11" cy="9" r="2.2" />
    <path d="M16.8 6.2L20.2 9.6" />
  </svg>
)

const AdminIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.2V16.8" />
    <path d="M7.2 12H16.8" />
  </svg>
)

const McpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <circle cx="12" cy="12" r="2.4" />
    <circle cx="5" cy="6.5" r="1.8" />
    <circle cx="19" cy="6.5" r="1.8" />
    <circle cx="12" cy="20" r="1.8" />
    <path d="M6.4 7.6L10.3 10.6" />
    <path d="M17.6 7.6L13.7 10.6" />
    <path d="M12 14.4V18.2" />
  </svg>
)

const SuperAdminIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <path d="M12 3.8L19.2 6.8V12.5C19.2 16.5 16.3 20.1 12 21.2C7.7 20.1 4.8 16.5 4.8 12.5V6.8L12 3.8Z" />
    <path d="M9.3 12.1L11.2 14L14.9 10.3" />
  </svg>
)

const ReportsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <path d="M6 3.8H14.8L18 7V20.2H6V3.8Z" />
    <path d="M14.5 3.8V7.3H18" />
    <path d="M8.5 11.5H15.5" />
    <path d="M8.5 15H15.5" />
  </svg>
)

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false" className={iconClassName}>
    <circle cx="5.5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="18.5" cy="12" r="1.4" />
  </svg>
)

type NavItem = {
  to: string
  label: string
  icon: React.ReactNode
  end?: boolean
}

// Uma "vaga" da barra inferior: o primeiro candidato disponivel vence. Se o
// plano ou o papel derruba o destino principal, cai para o proximo em vez de
// renderizar uma aba morta. Cada candidato leva o proprio rotulo curto para a
// aba nunca prometer um destino diferente do que abre.
type TabSlot = {
  to: string
  label: string
}[]

type NavSection = {
  title: string
  visible: boolean
  items: NavItem[]
}

const ShellLayout = ({ children }: { children: React.ReactNode }) => {
  const { profile, profileError, signOut } = useAuth()
  const { isGrowthOrBetter, isPro } = usePlan()
  const { viewTimeZone, setViewTimeZone } = useTimeZone()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const moreSheetRef = useRef<HTMLDivElement>(null)
  const { t: i18nT, i18n } = useTranslation()
  const isPt = i18n.resolvedLanguage?.toLowerCase().startsWith('pt')
  const t = (en: string, pt: string) => i18nT(isPt ? pt : en)
  const parsedProfileError = splitMessageLink(profileError || '')
  const isSuperAdmin = profile?.role === 'SUPERADMIN'
  const isAdmin = profile?.role === 'ADMIN' || profile?.role === 'SUPERADMIN'
  const isOnlyAdmin = profile?.role === 'ADMIN'
  // INTEGRATOR é HR com um degrau a mais: alcança tudo que o HR alcança.
  const isHrLevel = profile?.role === 'HR' || profile?.role === 'INTEGRATOR'
  const canManageProSettings = profile?.role === 'ADMIN' || isHrLevel
  // INTEGRATOR nao ve a secao Admin (visible: isOnlyAdmin), mas gerencia conexoes MCP.
  const canManageMcp = profile?.role === 'ADMIN' || profile?.role === 'INTEGRATOR'
  const isSupervisor = profile?.role === 'SUPERVISOR' || isHrLevel || isAdmin
  const isHrOrAdmin = isHrLevel || isAdmin
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
        { to: '/app/colaborador/saldo', label: t('Balance', 'Saldo'), icon: <ReportsIcon /> }, // Usando o icone de relatorios
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
      title: t('HR', 'RH'),
      visible: isHrOrAdmin,
      items: [
        {
          to: '/app/hr/daily',
          label: t('Daily time', 'Tempo diário'),
          icon: <HistoryIcon />,
        },
        {
          to: '/app/hr/schedules',
          label: t('Schedules', 'Jornadas'),
          icon: <SupervisorIcon />,
        },
        {
          to: '/app/hr/groups',
          label: t('Teams & groups', 'Equipes e grupos'),
          icon: <SupervisorIcon />,
        },
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
    {
      title: t('Integrations', 'Integracoes'),
      visible: canManageMcp,
      items: [
        {
          to: '/app/admin/mcp',
          label: t('MCP / AI', 'MCP / IA'),
          icon: <McpIcon />,
        },
      ],
    },
  ]

  // Barra inferior do celular: no maximo 4 destinos + "Mais".
  // Os candidatos sao resolvidos contra navSections, entao papel e plano ja
  // decidiram o que existe -- nada aqui reimplementa permissao.
  const memberTabSlots: TabSlot[] = [
    [{ to: '/app/colaborador', label: t('Clock', 'Ponto') }],
    [{ to: '/app/colaborador/historico', label: t('History', 'Historico') }],
    // Saldo resolve contra o item de menu do banco de horas; Relatorios fica
    // como fallback caso esse item saia de navSections.
    [
      { to: '/app/colaborador/saldo', label: t('Balance', 'Saldo') },
      { to: '/app/relatorios', label: t('Reports', 'Relatorios') },
    ],
    [
      { to: '/app/colaborador/ferias', label: t('Vacations', 'Ferias') },
      { to: '/app', label: t('Overview', 'Geral') },
    ],
  ]

  const supervisorTabSlots: TabSlot[] = [
    [
      { to: '/app/hr/groups', label: t('Team', 'Equipe') },
      { to: '/app/supervisor/overview', label: t('Team', 'Equipe') },
    ],
    [{ to: '/app/supervisor/pending-items', label: t('Pending', 'Pendencias') }],
    [{ to: '/app/colaborador', label: t('Clock', 'Ponto') }],
    [{ to: '/app/relatorios', label: t('Reports', 'Relatorios') }],
  ]

  // SUPERADMIN nao enxerga a secao Admin (visible: isOnlyAdmin), por isso cada
  // vaga tem o equivalente alcancavel por ele como alternativa.
  const adminTabSlots: TabSlot[] = [
    [
      { to: '/app/admin/pending-approvals', label: t('Pending', 'Pendencias') },
      { to: '/app/supervisor/pending-items', label: t('Pending', 'Pendencias') },
    ],
    [
      { to: '/app/admin/users', label: t('Users', 'Usuarios') },
      { to: '/app/superadmin/accounts', label: t('Accounts', 'Contas') },
    ],
    [{ to: '/app/colaborador', label: t('Clock', 'Ponto') }],
    [
      { to: '/app/admin/financeiro', label: t('Finance', 'Financeiro') },
      { to: '/app/relatorios', label: t('Reports', 'Relatorios') },
    ],
  ]

  const tabSlots = isAdmin ? adminTabSlots : isSupervisor ? supervisorTabSlots : memberTabSlots

  const visibleItems = navSections.filter((section) => section.visible).flatMap((section) => section.items)
  const takenPaths = new Set<string>()
  const bottomTabs = tabSlots
    .map((slot) => {
      for (const candidate of slot) {
        if (takenPaths.has(candidate.to)) continue
        const item = visibleItems.find((visible) => visible.to === candidate.to)
        if (!item) continue
        takenPaths.add(item.to)
        return { ...item, label: candidate.label }
      }
      return null
    })
    .filter((tab): tab is NavItem => tab !== null)

  const moreSections = navSections
    .filter((section) => section.visible)
    .map((section) => ({ ...section, items: section.items.filter((item) => !takenPaths.has(item.to)) }))
    .filter((section) => section.items.length > 0)

  const isItemActive = (item: NavItem) =>
    item.end ? location.pathname === item.to : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  const moreIsActive = moreSections.some((section) => section.items.some(isItemActive))

  // Fechar sempre devolve o foco para a aba "Mais": sem isso o foco volta para o
  // <body> e o leitor de tela recomeca a pagina do zero.
  const closeMore = useCallback(() => {
    setMoreOpen(false)
    moreButtonRef.current?.focus()
  }, [])

  // Enquanto a folha esta aberta ela e o unico conteudo alcancavel: Escape fecha,
  // o foco entra no primeiro item e o Tab circula dentro dela.
  useEffect(() => {
    if (!moreOpen) return

    const sheet = moreSheetRef.current
    if (!sheet) return

    const focusables = () =>
      Array.from(
        sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      )

    const firstFocusable = focusables()[0]
    if (firstFocusable) firstFocusable.focus()
    else sheet.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMore()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusables()
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !sheet.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !sheet.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [moreOpen, closeMore])

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <div className="flex">
        <aside className="peer/sidebar group/sidebar fixed left-0 top-0 z-20 hidden h-screen border-r border-white/80 bg-white/85 p-2 shadow-[0_18px_35px_-25px_rgba(15,23,42,0.55)] backdrop-blur transition-all duration-300 md:block md:w-[4.5rem] md:hover:w-64 md:focus-within:w-64">
          <div className="flex h-full min-h-0 flex-col">
            <Link
              to="/app/perfil-completo"
              className="mb-4 flex shrink-0 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-700 transition hover:bg-slate-100"
              title={t('Open complete profile', 'Abrir perfil completo')}
            >
              <UserAvatar name={profile?.name} photoUrl={profile?.photoUrl} size="sm" />
              <div className="truncate transition-all duration-200 md:max-w-0 md:opacity-0 md:group-hover/sidebar:max-w-[170px] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[170px] md:group-focus-within/sidebar:opacity-100">
                <BrandWordmark className="text-xl" />
              </div>
            </Link>

            <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1">
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

            <div className="mt-auto shrink-0 rounded-2xl border border-slate-200 bg-white/80 p-3 text-slate-700 transition-all duration-200 md:max-h-0 md:overflow-hidden md:opacity-0 md:group-hover/sidebar:max-h-[18rem] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-h-[18rem] md:group-focus-within/sidebar:opacity-100">
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

              <nav
                aria-label={t('Main navigation', 'Navegacao principal')}
                className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-white/80 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_26px_-22px_rgba(15,23,42,0.75)] backdrop-blur md:hidden"
              >
                {bottomTabs.map((item) => (
                  <NavLink
                    key={`tab-${item.to}`}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold transition ${
                        isActive ? 'text-teal-700' : 'text-slate-500'
                      }`
                    }
                  >
                    {item.icon}
                    <span className="w-full truncate text-center leading-tight">{item.label}</span>
                  </NavLink>
                ))}

                {moreSections.length > 0 ? (
                  <button
                    type="button"
                    ref={moreButtonRef}
                    onClick={() => setMoreOpen(true)}
                    aria-expanded={moreOpen}
                    aria-haspopup="dialog"
                    aria-label={t('More navigation', 'Mais navegacao')}
                    className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold transition ${
                      moreIsActive ? 'text-teal-700' : 'text-slate-500'
                    }`}
                  >
                    <MoreIcon />
                    <span className="w-full truncate text-center leading-tight">{t('More', 'Mais')}</span>
                  </button>
                ) : null}
              </nav>

              {moreOpen && moreSections.length > 0 ? (
                <div className="fixed inset-0 z-40 md:hidden">
                  <button
                    type="button"
                    aria-label={t('Close the more-navigation sheet', 'Fechar a folha de navegacao')}
                    onClick={closeMore}
                    className="absolute inset-0 h-full w-full bg-slate-900/40"
                  />
                  <div
                    ref={moreSheetRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('More navigation', 'Mais navegacao')}
                    tabIndex={-1}
                    className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-3xl border-t border-white/80 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-18px_35px_-25px_rgba(15,23,42,0.55)]"
                  >
                    <div aria-hidden="true" className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />
                    <div className="space-y-4">
                      {moreSections.map((section) => (
                        <div key={`more-${section.title}`} className="space-y-1">
                          <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                            {section.title}
                          </p>
                          {section.items.map((item) => (
                            <NavLink
                              key={`more-${item.to}`}
                              to={item.to}
                              end={item.end}
                              onClick={closeMore}
                              className={({ isActive }) =>
                                `flex min-h-[44px] items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition ${
                                  isActive ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
                                }`
                              }
                            >
                              {item.icon}
                              <span className="truncate">{item.label}</span>
                            </NavLink>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

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

              {/* A barra inferior e fixed: sem esta folga a ultima linha de cada pagina fica embaixo dela. */}
              <main className="pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8">{children}</main>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ShellLayout
