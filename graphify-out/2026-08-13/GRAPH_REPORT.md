# Graph Report - SystemaPonto  (2026-08-12)

## Corpus Check
- 151 files · ~145,469 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1484 nodes · 2835 edges · 88 communities (81 shown, 7 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 186 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `57023125`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pro.controller.js
- reportWorker.js
- SuperAdminAccountsPage.tsx
- database.js
- Manual do Usuário — OmniPunt
- useAuth
- proactiveAlertWorker.js
- api.ts
- Reports.tsx
- slack.controller.js
- scripts
- supervisor.controller.js
- user.controller.js
- SupervisorPendingItemsPage.tsx
- admin.controller.js
- dependencies
- hr.controller.js
- vacation.controller.js
- finance.controller.js
- user.routes.js
- Signup.tsx
- consent.ts
- compilerOptions
- time.controller.js
- SupervisorDashboard.tsx
- supervisor.routes.js
- ColaboradorDashboard.tsx
- AdminDashboard.tsx
- seatBilling.js
- AuthContext.tsx
- devDependencies
- devDependencies
- dependencies
- rules
- terminalQr.js
- SupervisorHoursPage.tsx
- publicApi.controller.js
- createUser
- PageMeta.tsx
- seed.js
- sendResendEmail
- geofence.js
- recalcDay.js
- src/index.js
- idempotency.middleware.js
- ShellLayout.tsx
- routes/index.js
- HrSchedulesPage.tsx
- apiFetch
- clockOut
- notifications.js
- workers/index.js
- AdminFinancePage.tsx
- seed-first-admin.js
- overtime.js
- backend/package.json
- frontend/package.json
- loading.ts
- App.tsx
- auth.middleware.js
- faceRecognition.js
- teamInviteToken.js
- timeCalculations.js
- updateUserWorkSettings
- auth.routes.js
- listSuperAdminAccountsOverview
- dependencies
- captureRequestMetadata
- chooseMyPlan
- react-leaflet
- sonner
- @supabase/supabase-js
- @tailwindcss/postcss
- vite-plugin-pwa
- MATRIZ_AUTORIZACAO_API_2026-03-26.md
- analytics.ts
- PlanSelectionPage.tsx
- HrGroupsPage.tsx
- SupervisorKpisPage.tsx
- hr.routes.js
- integrations.routes.js

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 65 edges
2. `apiFetch()` - 54 edges
3. `scripts` - 34 edges
4. `translateApiMessage()` - 25 edges
5. `prisma` - 20 edges
6. `compilerOptions` - 19 edges
7. `clockOut()` - 18 edges
8. `useTimeZone()` - 17 edges
9. `SuperAdminAccountsPage()` - 14 edges
10. `Manual do Usuário — OmniPunt` - 14 edges

## Surprising Connections (you probably didn't know these)
- `setUserPin()` --calls--> `hashPin()`  [EXTRACTED]
  backend/src/controllers/admin.controller.js → backend/src/utils/pinAuth.js
- `payUserBankHours()` --calls--> `settleBankHoursAccruals()`  [EXTRACTED]
  backend/src/controllers/admin.controller.js → backend/src/utils/bankHours.js
- `updateLocationSettings()` --calls--> `updateGeofenceConfig()`  [EXTRACTED]
  backend/src/controllers/admin.controller.js → backend/src/utils/geofence.js
- `syncInvoicesForAdmin()` --calls--> `listAdminCheckoutSessions()`  [EXTRACTED]
  backend/src/controllers/finance.controller.js → backend/src/utils/seatBilling.js
- `getMyFinanceOverview()` --calls--> `getSubscriptionSnapshot()`  [EXTRACTED]
  backend/src/controllers/finance.controller.js → backend/src/utils/seatBilling.js

## Import Cycles
- None detected.

## Communities (88 total, 7 thin omitted)

### Community 0 - "pro.controller.js"
Cohesion: 0.05
Nodes (56): createPrismaAdminRepository(), createPublicApiTokenService(), {
  issuePublicApiToken,
  verifyPublicApiToken,
  maskPublicApiToken,
}, createDefaultDependencies(), {
  createIssuePublicApiTokenUseCase,
}, { createPrismaAdminRepository }, { createPublicApiTokenService }, defaultDependencies (+48 more)

### Community 1 - "reportWorker.js"
Cohesion: 0.07
Nodes (50): canAccessBreakdownUserWithinTenant(), createExportJob(), deleteReport(), downloadReport(), fs, getDailyBreakdown(), getJobStatus(), { getUtcDateRangeForDateOnly, resolveTimeZone } (+42 more)

### Community 2 - "SuperAdminAccountsPage.tsx"
Cohesion: 0.12
Nodes (22): AdminConfigForm, AdminPlanStatus, formatDateTime(), formatUsd(), formatWorkday(), LinkedAccountsResponse, LinkedAccountUser, MARKETING_PLAN_CODE_BY_ID (+14 more)

### Community 3 - "database.js"
Cohesion: 0.13
Nodes (15): adapter, { Pool }, prisma, { PrismaClient }, { PrismaPg }, { createClient }, supabase, supabaseAdmin (+7 more)

### Community 4 - "Manual do Usuário — OmniPunt"
Cohesion: 0.04
Nodes (46): 10.1. Usuários e assentos, 10.2. Banco de horas, 10.3. Aprovações pendentes, 10.4. QR Code do terminal, 10.5. Configurações PRO, 10. Área do Admin, 11. Conceitos importantes, 12. Perguntas frequentes e problemas comuns (+38 more)

### Community 5 - "useAuth"
Cohesion: 0.15
Nodes (17): Props, ProtectedRoute(), ShellLayout(), useAuth(), PLAN_LEVELS, PlanCode, usePlan(), AdminBillingResultPage() (+9 more)

### Community 6 - "proactiveAlertWorker.js"
Cohesion: 0.08
Nodes (35): buildDispatchKey(), CLOCK_IN_LATE_MINUTES, CLOCK_IN_PRE_MINUTES, CLOCK_IN_SCAN_INTERVAL_MS, DEFAULT_OVERTIME_LIMIT_MINUTES, evaluateClockInReminder(), evaluateOvertimeThreshold(), evaluateShiftEndReminder() (+27 more)

### Community 7 - "api.ts"
Cohesion: 0.09
Nodes (34): API_BASE, apiFetchFormData(), buildIdempotencyHeaders(), FormDataRequestOptions, IDEMPOTENCY_METHODS, isPlainObject(), isPortugueseLanguage(), isRecordPayload() (+26 more)

### Community 8 - "Reports.tsx"
Cohesion: 0.11
Nodes (30): getInitialTimeZone(), TimezoneContext, TimezoneProvider(), TimezoneState, useTimeZone(), DEFAULT_VIEW_TIME_ZONE, formatDateTimeWithTimeZone(), formatDateWithTimeZone() (+22 more)

### Community 9 - "slack.controller.js"
Cohesion: 0.11
Nodes (35): setUserPin(), ACTIONS, buildControllerReq(), buildErrorText(), buildInfoForDate(), buildSlackResponse(), COMMAND_TIMEOUT_MS, crypto (+27 more)

### Community 10 - "scripts"
Cohesion: 0.06
Nodes (34): scripts, create:demo-seed, create:rh, create:staff, create:superadmin, create:user, dev, format (+26 more)

### Community 11 - "supervisor.controller.js"
Cohesion: 0.11
Nodes (31): { adjustBankHours, settleBankHoursAccruals }, applyVirtualOrgFilters(), buildFilterOptions(), buildHoursKpisPayload(), buildSupervisorScopeWhere(), buildTeamPresenceSnapshot(), DEFAULT_OVERTIME_LIMIT_MINUTES, enumerateDates() (+23 more)

### Community 12 - "user.controller.js"
Cohesion: 0.08
Nodes (29): ADMIN_PLAN_STATUSES, ALL_ROLES, buildFrontendAppUrl(), buildSeatSummary(), { buildUserPhotoUrl, normalizePhotoPath }, {
  createAdditionalSeatsCheckoutSession,
  verifyAdditionalSeatsCheckoutSession,
  listAdditionalSeatsCheckoutSessions,
  createBasePlanCheckoutSession,
  verifyBasePlanCheckoutSession,
}, createMyTeamInviteLink(), DEFAULT_ADMIN_PLAN_MONTHLY_PRICE (+21 more)

### Community 13 - "SupervisorPendingItemsPage.tsx"
Cohesion: 0.13
Nodes (21): fmtHM(), JourneyModal(), ModalEntry, Props, buildTimeline(), JourneyEntry, Segment, DayGroup (+13 more)

### Community 14 - "admin.controller.js"
Cohesion: 0.10
Nodes (29): { adjustBankHours, settleBankHoursAccruals }, adjustUserBankHours(), canManageUserWithinTenant(), changeUserSupervisor(), getBankHoursOverview(), {
  getGeofencePublicConfig,
  updateGeofenceConfig,
  LOCATION_VALIDATION_SOURCES,
  GEOFENCE_SETTING_KEY,
}, getSystemStats(), getTeamOverview() (+21 more)

### Community 15 - "dependencies"
Cohesion: 0.07
Nodes (29): dependencies, bullmq, cors, dotenv, express, helmet, ioredis, multer (+21 more)

### Community 16 - "hr.controller.js"
Cohesion: 0.21
Nodes (22): buildOrgTeamWhere(), canManageTarget(), createHrEntry(), deleteHrEntry(), formatMinutes(), getHrDaily(), getHrTeam(), getHrUserDaily() (+14 more)

### Community 17 - "vacation.controller.js"
Cohesion: 0.13
Nodes (32): ACTIVE_VACATION_STATUSES, { buildUserPhotoUrl }, canReviewVacationWithinTenant(), createVacationRequest(), encodeVacationReasonWithType(), endOfDay(), getHrVacationRequests(), getMyVacationRequests() (+24 more)

### Community 18 - "finance.controller.js"
Cohesion: 0.13
Nodes (27): buildInvoiceDataFromStripeSession(), buildPaidInvoicesWhere(), buildPersistedAdminSeatSnapshot(), ensureAdminOnly(), EXTRA_ADMIN_SEAT_MONTHLY_USD, FINANCE_SOURCE_TYPES, fromMinorCurrencyToMajor(), getMyFinanceOverview() (+19 more)

### Community 19 - "user.routes.js"
Cohesion: 0.12
Nodes (14): authMiddleware, requirePlan, roleCheck, { authMiddleware, roleCheck, requirePlan }, express, router, timeController, { authMiddleware, roleCheck, requirePlan } (+6 more)

### Community 20 - "Signup.tsx"
Cohesion: 0.17
Nodes (13): BrandWordmark(), BrandWordmarkProps, joinClassNames(), LanguageSwitcher(), LanguageSwitcherProps, normalizeLanguage(), LoadingScreenProps, PublicLayoutProps (+5 more)

### Community 21 - "consent.ts"
Cohesion: 0.25
Nodes (15): CookieConsentBanner(), acceptAll(), ConsentCategory, defaultState, getConsent(), hasDecided(), persist(), rejectAll() (+7 more)

### Community 22 - "compilerOptions"
Cohesion: 0.08
Nodes (25): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+17 more)

### Community 23 - "time.controller.js"
Cohesion: 0.11
Nodes (24): { accrueBankHours, expireBankHoursIfNeeded }, buildDefaultFaceAuth(), buildDefaultPinAuth(), { calculateDuration, getStartOfDay, getEndOfDay }, {
  calculateIncrementalOvertimeSummary,
  calculateCurrentDailyProgress,
}, { captureRequestMetadata }, { emitPunch }, {
  evaluateGeofence,
  getGeofencePublicConfig,
  getGeofenceConfig,
  LOCATION_VALIDATION_SOURCES,
} (+16 more)

### Community 24 - "SupervisorDashboard.tsx"
Cohesion: 0.11
Nodes (21): Entry, EntryDetailState, formatMinutesLabel(), formatShortDuration(), getElapsedMinutes(), getTodayBucket(), HoursKpiItem, HoursKpiResponse (+13 more)

### Community 25 - "supervisor.routes.js"
Cohesion: 0.16
Nodes (19): approveEntriesBulk(), approveEntry(), approveOvertime(), buildManagedTeamWhere(), canManageTeamUser(), getEntryDetails(), getTeamBankHoursOverview(), getTeamMembers() (+11 more)

### Community 26 - "ColaboradorDashboard.tsx"
Cohesion: 0.15
Nodes (14): BarcodeDetectorCode, BarcodeDetectorInstance, BarcodeDetectorStatic, ColaboradorDashboard(), CurrentEntryResponse, FACE_MODEL_SOURCES, FaceStatusResponse, GeofenceConfig (+6 more)

### Community 27 - "AdminDashboard.tsx"
Cohesion: 0.08
Nodes (33): pickInitial(), sizeByVariant, UserAvatar(), UserAvatarProps, resolveApiAssetUrl(), AdminDashboard(), AdminLocationSettings, AdminPlanStatus (+25 more)

### Community 28 - "seatBilling.js"
Cohesion: 0.21
Nodes (19): buildBasePlanLineItem(), createAdditionalSeatsCheckoutSession(), createBasePlanCheckoutSession(), DEFAULT_ADMIN_SESSION_TYPES, EXTRA_ADMIN_SEAT_MONTHLY_USD, getStripeClient(), getSubscriptionSnapshot(), listAdditionalSeatsCheckoutSessions() (+11 more)

### Community 29 - "AuthContext.tsx"
Cohesion: 0.16
Nodes (18): AuthContext, AuthProvider(), AuthState, isPortugueseLanguage(), localizeMessage(), Role, SignUpPayload, UserProfile (+10 more)

### Community 30 - "devDependencies"
Cohesion: 0.11
Nodes (19): autoprefixer, devDependencies, autoprefixer, postcss, tailwindcss, @types/leaflet, @types/react, @types/react-dom (+11 more)

### Community 31 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, eslint, eslint-config-prettier, eslint-plugin-prettier, jest, nodemon, prettier, prisma (+11 more)

### Community 32 - "dependencies"
Cohesion: 0.11
Nodes (19): face-api.js, dependencies, face-api.js, i18next, i18next-browser-languagedetector, leaflet, react, react-dom (+11 more)

### Community 33 - "rules"
Cohesion: 0.12
Nodes (17): env, es2021, node, extends, parserOptions, ecmaVersion, sourceType, plugins (+9 more)

### Community 34 - "terminalQr.js"
Cohesion: 0.16
Nodes (16): issueTerminalQr(), consumedFallback, consumeReplayKey(), consumeTerminalQrToken(), crypto, findTerminal(), fromBase64Url(), issueTerminalQrToken() (+8 more)

### Community 35 - "SupervisorHoursPage.tsx"
Cohesion: 0.31
Nodes (8): TIME_ZONE_OPTIONS, formatMinutesLabel(), formatMinutesToHours(), parseHoursToMinutes(), SupervisorHoursPage(), TeamBankHoursOverviewItem, TeamMember, TeamWorkSettingsForm

### Community 36 - "publicApi.controller.js"
Cohesion: 0.21
Nodes (15): buildPayrollFilters(), calculateFinancialSummary(), getPayrollSummary(), getPayrollTimeEntries(), listScopedPayrollUsers(), parseDateFilter(), PAYROLL_USER_ROLES, { prisma } (+7 more)

### Community 37 - "createUser"
Cohesion: 0.18
Nodes (17): buildPersistedAdminSeatSnapshot(), confirmAdditionalSeatsCheckout(), createUser(), deleteUser(), ensureAdminPlanRecord(), getMyCompleteProfile(), getUserById(), listAdminSeatAssignments() (+9 more)

### Community 38 - "PageMeta.tsx"
Cohesion: 0.17
Nodes (15): ensureDescriptionMeta(), normalizeHtmlLanguage(), PageMeta(), PageMetaProps, PublicLayout(), getMarketingPlans(), getPlanFeatures(), MarketingPlan (+7 more)

### Community 39 - "seed.js"
Cohesion: 0.18
Nodes (14): adapter, ADMIN_PLAN_CATALOG, buildSeedPaidInvoices(), EXTRA_ADMIN_SEAT_MONTHLY_USD, main(), normalizeEmail(), normalizeText(), parsedExtraAdminSeatMonthlyUsd (+6 more)

### Community 40 - "sendResendEmail"
Cohesion: 0.17
Nodes (11): resolveFromAddress(), sendResendEmail(), sendSlackDM(), buildClockInMessage(), buildClockInSupervisorEmail(), buildShiftEndSupervisorEmail(), buildShiftEndSupervisorMessage(), buildShiftEndUserMessage() (+3 more)

### Community 41 - "geofence.js"
Cohesion: 0.25
Nodes (13): getLocationSettings(), getGeofenceSettings(), evaluateGeofence(), getGeofenceConfig(), getGeofencePublicConfig(), haversineDistanceMeters(), initGeofenceConfig(), readEnvGeofenceConfig() (+5 more)

### Community 42 - "recalcDay.js"
Cohesion: 0.22
Nodes (11): getMyBankHours(), accrueBankHours(), addMonths(), clampPositiveInteger(), expireBankHoursIfNeeded(), { prisma }, settleBankHoursAccruals(), { accrueBankHours } (+3 more)

### Community 43 - "src/index.js"
Cohesion: 0.07
Nodes (31): allowedOrigins, app, cors, corsOptions, defaultAllowedOrigins, { ensureUserPhotoDir }, express, helmet (+23 more)

### Community 44 - "idempotency.middleware.js"
Cohesion: 0.24
Nodes (13): attachFinalizeHandler(), buildActorScope(), buildPayloadHash(), buildStorageKey(), crypto, IDEMPOTENCY_METHODS, idempotencyMiddleware(), isPlainObject() (+5 more)

### Community 45 - "ShellLayout.tsx"
Cohesion: 0.15
Nodes (7): DualClock(), DualClockProps, formatTime(), getBrowserTimeZone(), getZoneShortLabel(), NavItem, NavSection

### Community 46 - "routes/index.js"
Cohesion: 0.15
Nodes (12): adminRoutes, authRoutes, express, hrRoutes, integrationsRoutes, publicRoutes, reportRoutes, router (+4 more)

### Community 47 - "HrSchedulesPage.tsx"
Cohesion: 0.23
Nodes (11): emptyForm, formatMinutesToHours(), from12h(), HOURS_12, HrMember, HrSchedulesPage(), MINUTES_60, parseHoursToMinutes() (+3 more)

### Community 48 - "apiFetch"
Cohesion: 0.13
Nodes (21): apiFetch(), AdminCheckoutThankYouPage(), AdminPendingApprovalsPage(), defaultStats, EntriesStats, EntryStatus, ReviewAction, TimeEntry (+13 more)

### Community 49 - "clockOut"
Cohesion: 0.19
Nodes (20): buildLocationPayload(), calculateFinancialSummary(), clockIn(), clockOut(), getCurrentEntry(), getGeofenceErrorMessage(), getMyTimeEntries(), getQrErrorMessage() (+12 more)

### Community 50 - "notifications.js"
Cohesion: 0.35
Nodes (11): createEmailTransporter(), getEnabledOvertimeChannels(), isEmailConfigured(), isEmailEnabled(), isPushConfigured(), isPushEnabled(), nodemailer, parseBoolean() (+3 more)

### Community 51 - "workers/index.js"
Cohesion: 0.22
Nodes (9): Redis, { createProactiveAlertWorker }, { createReportWorker }, redis, startWorkers(), createProactiveAlertWorker(), processClockInScanJob(), processDispatchJob() (+1 more)

### Community 52 - "AdminFinancePage.tsx"
Cohesion: 0.25
Nodes (10): AdminFinancePage(), FinanceInvoice, FinanceInvoicesResponse, FinanceOverviewResponse, FinanceSyncResponse, formatCurrency(), formatDateTime(), sourceTypeLabel() (+2 more)

### Community 53 - "seed-first-admin.js"
Cohesion: 0.22
Nodes (9): adapter, { createClient }, ensureDefaultAdminPlan(), { Pool }, prisma, { PrismaClient }, { PrismaPg }, seedFirstAdmin() (+1 more)

### Community 54 - "overtime.js"
Cohesion: 0.42
Nodes (9): calculateCurrentDailyProgress(), calculateIncrementalOvertimeSummary(), calculateOvertimeSummary(), DEFAULT_DAILY_WORK_MINUTES, formatDateKey(), getHolidaySet(), resolveBreakMinutes(), resolveContractDailyMinutes() (+1 more)

### Community 55 - "backend/package.json"
Cohesion: 0.22
Nodes (8): author, description, keywords, license, main, name, type, version

### Community 56 - "frontend/package.json"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, preview, type, version

### Community 57 - "loading.ts"
Cohesion: 0.29
Nodes (8): GlobalLoadingOverlay(), LoadingScreen(), listeners, LoadingListener, notifyListeners(), startGlobalLoading(), stopGlobalLoading(), subscribeGlobalLoading()

### Community 58 - "App.tsx"
Cohesion: 0.17
Nodes (9): App(), Language, LanguageContext, LanguageContextState, LanguageProvider(), normalizeLanguage(), toI18nLanguage(), root (+1 more)

### Community 59 - "auth.middleware.js"
Cohesion: 0.24
Nodes (13): authMiddleware(), buildAdminSeatPurchaseUrl(), normalizeLegacyPlanCode(), { prisma }, provisionBuyerAdminIfMissing(), provisionInvitedTeamMemberIfMissing(), resolveInviteTokenFromMetadata(), resolveProvisionedName() (+5 more)

### Community 60 - "faceRecognition.js"
Cohesion: 0.32
Nodes (5): enrollMyFace(), DEFAULT_THRESHOLD, euclideanDistance(), normalizeEmbedding(), verifyFaceMatch()

### Community 61 - "teamInviteToken.js"
Cohesion: 0.25
Nodes (13): crypto, decodePayload(), DEFAULT_TTL_HOURS, encodePayload(), ensureInviteSecret(), INVITABLE_ROLES, issueTeamInviteToken(), MAX_TTL_HOURS (+5 more)

### Community 63 - "updateUserWorkSettings"
Cohesion: 0.52
Nodes (6): updateUserWorkSettings(), updateTeamMemberWorkSettings(), normalizeHourlyRate(), normalizeMinutes(), normalizeTime(), normalizeTimeZone()

### Community 64 - "auth.routes.js"
Cohesion: 0.29
Nodes (6): { authMiddleware, roleCheck }, { buildUserPhotoUrl }, express, { prisma }, router, { verifyTeamInviteToken }

### Community 65 - "listSuperAdminAccountsOverview"
Cohesion: 0.33
Nodes (6): createMyAdditionalSeatsCheckout(), fromMinorCurrencyToMajor(), listSuperAdminAccountsOverview(), toIsoFromUnixSeconds(), toNumber(), toPositiveInteger()

### Community 66 - "dependencies"
Cohesion: 0.33
Nodes (5): dependencies, pg, @prisma/adapter-pg, pg, @prisma/adapter-pg

### Community 67 - "captureRequestMetadata"
Cohesion: 0.70
Nodes (4): captureRequestMetadata(), getClientIP(), getDeviceInfo(), getLocation()

### Community 68 - "chooseMyPlan"
Cohesion: 0.50
Nodes (4): chooseMyPlan(), parseBooleanFlag(), resolveAppReturnPath(), resolveSelfServicePlanSelection()

### Community 82 - "analytics.ts"
Cohesion: 0.33
Nodes (8): applyConsent(), disableAnalytics(), initAnalyticsGate(), injectGoogleAnalytics(), measurementId, removeNode(), CONSENT_EVENT, ConsentState

### Community 83 - "PlanSelectionPage.tsx"
Cohesion: 0.32
Nodes (7): ChoosePlanResponse, clampSeatLimit(), PLAN_CONFIG, PlanConfig, PlanId, PlanSelectionPage(), resolveReturnPath()

### Community 84 - "HrGroupsPage.tsx"
Cohesion: 0.33
Nodes (6): HrGroupsPage(), isManageableRole(), MANAGEABLE_ROLES, ManageableRole, Role, User

### Community 85 - "SupervisorKpisPage.tsx"
Cohesion: 0.33
Nodes (6): formatMinutesLabel(), HoursKpiItem, HoursKpiResponse, HoursKpiTimelineItem, KpiPeriod, SupervisorKpisPage()

### Community 86 - "hr.routes.js"
Cohesion: 0.33
Nodes (5): updateHrWorkSettings(), { authMiddleware, roleCheck }, express, {
  getHrTeam,
  getHrDaily,
  getHrUserDaily,
  updateHrEntry,
  createHrEntry,
  deleteHrEntry,
  updateHrWorkSettings,
}, router

### Community 87 - "integrations.routes.js"
Cohesion: 0.40
Nodes (4): express, router, slackController, slackOAuthController

## Knowledge Gaps
- **619 isolated node(s):** `node`, `es2021`, `eslint:recommended`, `ecmaVersion`, `sourceType` (+614 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `prisma` connect `database.js` to `pro.controller.js`, `reportWorker.js`, `auth.routes.js`, `publicApi.controller.js`, `proactiveAlertWorker.js`, `slack.controller.js`, `recalcDay.js`, `supervisor.controller.js`, `user.controller.js`, `admin.controller.js`, `hr.controller.js`, `vacation.controller.js`, `finance.controller.js`, `time.controller.js`, `auth.middleware.js`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `useAuth` to `SuperAdminAccountsPage.tsx`, `SupervisorHoursPage.tsx`, `PageMeta.tsx`, `api.ts`, `Reports.tsx`, `ShellLayout.tsx`, `SupervisorPendingItemsPage.tsx`, `HrSchedulesPage.tsx`, `apiFetch`, `PlanSelectionPage.tsx`, `Signup.tsx`, `AdminFinancePage.tsx`, `HrGroupsPage.tsx`, `SupervisorKpisPage.tsx`, `SupervisorDashboard.tsx`, `ColaboradorDashboard.tsx`, `AdminDashboard.tsx`, `AuthContext.tsx`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `apiFetch()` connect `apiFetch` to `SuperAdminAccountsPage.tsx`, `SupervisorHoursPage.tsx`, `useAuth`, `api.ts`, `Reports.tsx`, `SupervisorPendingItemsPage.tsx`, `HrSchedulesPage.tsx`, `PlanSelectionPage.tsx`, `AdminFinancePage.tsx`, `HrGroupsPage.tsx`, `Signup.tsx`, `SupervisorKpisPage.tsx`, `SupervisorDashboard.tsx`, `ColaboradorDashboard.tsx`, `AdminDashboard.tsx`, `AuthContext.tsx`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `node`, `es2021`, `eslint:recommended` to the rest of the system?**
  _619 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pro.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05217391304347826 - nodes in this community are weakly interconnected._
- **Should `reportWorker.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06638714185883997 - nodes in this community are weakly interconnected._
- **Should `SuperAdminAccountsPage.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.1225296442687747 - nodes in this community are weakly interconnected._