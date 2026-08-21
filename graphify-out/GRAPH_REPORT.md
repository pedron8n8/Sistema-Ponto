# Graph Report - SystemaPonto  (2026-08-19)

## Corpus Check
- 173 files · ~165,929 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1682 nodes · 3304 edges · 86 communities (80 shown, 6 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 239 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `23928e74`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pro.controller.js
- reportWorker.js
- auth.middleware.js
- database.js
- Manual do Usuário — OmniPunt
- App.tsx
- proactiveAlertWorker.js
- apiFetch
- SupervisorDashboard.tsx
- slack.controller.js
- scripts
- buildHoursKpisPayload
- user.controller.js
- SupervisorPendingItemsPage.tsx
- admin.controller.js
- dependencies
- hr.controller.js
- vacation.controller.js
- finance.controller.js
- user.routes.js
- ShellLayout.tsx
- upload.middleware.js
- compilerOptions
- time.controller.js
- _shared.js
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
- SuperAdminAccountsPage.tsx
- seed.js
- mcp.controller.js
- oauthProvider.js
- recalcDay.js
- src/index.js
- teamInviteToken.js
- supervisor.controller.js
- routes/index.js
- HrSchedulesPage.tsx
- HrDailyTimePage.tsx
- server.js
- geofence.js
- Overview.tsx
- AdminFinancePage.tsx
- seed-first-admin.js
- overtime.js
- backend/package.json
- frontend/package.json
- loading.ts
- consent.ts
- catalog/index.js
- faceRecognition.js
- updateUserWorkSettings
- timeCalculations.js
- rateLimit.middleware.js
- SupervisorKpisPage.tsx
- pinAuth.js
- dependencies
- captureRequestMetadata
- bridge.js
- react-leaflet
- sonner
- @supabase/supabase-js
- @tailwindcss/postcss
- vite-plugin-pwa
- MATRIZ_AUTORIZACAO_API_2026-03-26.md
- DualClock.tsx
- integrations.routes.js
- buildUserPhotoUrl
- roles.js

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 69 edges
2. `apiFetch()` - 57 edges
3. `scripts` - 35 edges
4. `prisma` - 25 edges
5. `translateApiMessage()` - 25 edges
6. `compilerOptions` - 19 edges
7. `clockOut()` - 18 edges
8. `useTimeZone()` - 17 edges
9. `isHrLevel()` - 16 edges
10. `SuperAdminAccountsPage()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `buildHoursKpisPayload()` --indirect_call--> `date()`  [INFERRED]
  backend/src/controllers/supervisor.controller.js → backend/src/mcp/catalog/_shared.js
- `canManageUserWithinTenant()` --calls--> `isHrLevel()`  [EXTRACTED]
  backend/src/controllers/admin.controller.js → backend/src/utils/roles.js
- `setUserPin()` --calls--> `hashPin()`  [EXTRACTED]
  backend/src/controllers/admin.controller.js → backend/src/utils/pinAuth.js
- `getBankHoursOverview()` --calls--> `isHrLevel()`  [EXTRACTED]
  backend/src/controllers/admin.controller.js → backend/src/utils/roles.js
- `updateLocationSettings()` --calls--> `updateGeofenceConfig()`  [EXTRACTED]
  backend/src/controllers/admin.controller.js → backend/src/utils/geofence.js

## Import Cycles
- None detected.

## Communities (86 total, 6 thin omitted)

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
Nodes (47): Redis, attachFinalizeHandler(), buildActorScope(), buildPayloadHash(), buildStorageKey(), crypto, IDEMPOTENCY_METHODS, idempotencyMiddleware() (+39 more)

### Community 2 - "auth.middleware.js"
Cohesion: 0.21
Nodes (15): attachCurrentPlan(), authMiddleware(), buildAdminSeatPurchaseUrl(), normalizeLegacyPlanCode(), { prisma }, provisionBuyerAdminIfMissing(), provisionInvitedTeamMemberIfMissing(), resolveInviteTokenFromMetadata() (+7 more)

### Community 3 - "database.js"
Cohesion: 0.13
Nodes (15): adapter, { Pool }, prisma, { PrismaClient }, { PrismaPg }, { createClient }, supabase, supabaseAdmin (+7 more)

### Community 4 - "Manual do Usuário — OmniPunt"
Cohesion: 0.04
Nodes (46): 10.1. Usuários e assentos, 10.2. Banco de horas, 10.3. Aprovações pendentes, 10.4. QR Code do terminal, 10.5. Configurações PRO, 10. Área do Admin, 11. Conceitos importantes, 12. Perguntas frequentes e problemas comuns (+38 more)

### Community 5 - "App.tsx"
Cohesion: 0.08
Nodes (33): Props, ProtectedRoute(), ShellLayout(), useAuth(), PLAN_LEVELS, PlanCode, usePlan(), AdminBillingResultPage() (+25 more)

### Community 6 - "proactiveAlertWorker.js"
Cohesion: 0.06
Nodes (60): createEmailTransporter(), getEnabledOvertimeChannels(), isEmailConfigured(), isEmailEnabled(), isPushConfigured(), isPushEnabled(), nodemailer, parseBoolean() (+52 more)

### Community 7 - "apiFetch"
Cohesion: 0.10
Nodes (35): apiFetch(), apiFetchFormData(), buildIdempotencyHeaders(), FormDataRequestOptions, IDEMPOTENCY_METHODS, isPlainObject(), isPortugueseLanguage(), isRecordPayload() (+27 more)

### Community 8 - "SupervisorDashboard.tsx"
Cohesion: 0.06
Nodes (54): getInitialTimeZone(), TimezoneContext, TimezoneProvider(), TimezoneState, useTimeZone(), API_BASE, DEFAULT_VIEW_TIME_ZONE, formatDateTimeWithTimeZone() (+46 more)

### Community 9 - "slack.controller.js"
Cohesion: 0.11
Nodes (35): setUserPin(), ACTIONS, buildControllerReq(), buildErrorText(), buildInfoForDate(), buildSlackResponse(), COMMAND_TIMEOUT_MS, crypto (+27 more)

### Community 10 - "scripts"
Cohesion: 0.06
Nodes (35): scripts, create:demo-seed, create:rh, create:staff, create:superadmin, create:user, dev, format (+27 more)

### Community 11 - "buildHoursKpisPayload"
Cohesion: 0.17
Nodes (17): applyVirtualOrgFilters(), buildFilterOptions(), buildHoursKpisPayload(), buildSupervisorScopeWhere(), buildTeamPresenceSnapshot(), enumerateDates(), extractCoordinatesFromLocation(), formatDateBucket() (+9 more)

### Community 12 - "user.controller.js"
Cohesion: 0.07
Nodes (32): ADMIN_PLAN_STATUSES, ALL_ROLES, buildFrontendAppUrl(), buildSeatSummary(), { buildUserPhotoUrl, normalizePhotoPath }, {
  createAdditionalSeatsCheckoutSession,
  verifyAdditionalSeatsCheckoutSession,
  listAdditionalSeatsCheckoutSessions,
  createBasePlanCheckoutSession,
  verifyBasePlanCheckoutSession,
}, createMyAdditionalSeatsCheckout(), createMyTeamInviteLink() (+24 more)

### Community 13 - "SupervisorPendingItemsPage.tsx"
Cohesion: 0.08
Nodes (30): fmtHM(), JourneyModal(), ModalEntry, Props, buildTimeline(), JourneyEntry, Segment, defaultStats (+22 more)

### Community 14 - "admin.controller.js"
Cohesion: 0.11
Nodes (28): { adjustBankHours, settleBankHoursAccruals }, canManageUserWithinTenant(), changeUserSupervisor(), getBankHoursOverview(), {
  getGeofencePublicConfig,
  updateGeofenceConfig,
  LOCATION_VALIDATION_SOURCES,
  GEOFENCE_SETTING_KEY,
}, getSystemStats(), getTeamOverview(), getTimeEntryAuditLog() (+20 more)

### Community 15 - "dependencies"
Cohesion: 0.06
Nodes (31): dependencies, bullmq, cors, dotenv, express, helmet, ioredis, @modelcontextprotocol/sdk (+23 more)

### Community 16 - "hr.controller.js"
Cohesion: 0.06
Nodes (64): buildOrgTeamWhere(), canManageTarget(), createHrEntry(), deleteHrEntry(), formatMinutes(), getHrDaily(), getHrTeam(), getHrUserDaily() (+56 more)

### Community 17 - "vacation.controller.js"
Cohesion: 0.13
Nodes (32): ACTIVE_VACATION_STATUSES, { buildUserPhotoUrl }, canReviewVacationWithinTenant(), createVacationRequest(), encodeVacationReasonWithType(), endOfDay(), getHrVacationRequests(), getMyVacationRequests() (+24 more)

### Community 18 - "finance.controller.js"
Cohesion: 0.13
Nodes (27): buildInvoiceDataFromStripeSession(), buildPaidInvoicesWhere(), buildPersistedAdminSeatSnapshot(), ensureAdminOnly(), EXTRA_ADMIN_SEAT_MONTHLY_USD, FINANCE_SOURCE_TYPES, fromMinorCurrencyToMajor(), getMyFinanceOverview() (+19 more)

### Community 19 - "user.routes.js"
Cohesion: 0.09
Nodes (20): authMiddleware, requirePlan, roleCheck, { authMiddleware, roleCheck }, { buildUserPhotoUrl }, express, { prisma }, router (+12 more)

### Community 20 - "ShellLayout.tsx"
Cohesion: 0.09
Nodes (19): BrandWordmark(), BrandWordmarkProps, joinClassNames(), LanguageSwitcher(), LanguageSwitcherProps, normalizeLanguage(), LoadingScreen(), LoadingScreenProps (+11 more)

### Community 21 - "upload.middleware.js"
Cohesion: 0.19
Nodes (11): ALLOWED_MIME_TYPES, crypto, multer, path, photoUpload, storage, { USER_PHOTO_DIR, ensureUserPhotoDir }, ensureUserPhotoDir() (+3 more)

### Community 22 - "compilerOptions"
Cohesion: 0.08
Nodes (25): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+17 more)

### Community 23 - "time.controller.js"
Cohesion: 0.13
Nodes (24): { accrueBankHours, expireBankHoursIfNeeded }, buildDefaultFaceAuth(), buildDefaultPinAuth(), buildLocationPayload(), { calculateDuration, getStartOfDay, getEndOfDay }, calculateFinancialSummary(), {
  calculateIncrementalOvertimeSummary,
  calculateCurrentDailyProgress,
}, { captureRequestMetadata } (+16 more)

### Community 24 - "_shared.js"
Cohesion: 0.13
Nodes (31): { SUPERVISOR_UP, str, obj }, { SUPERVISOR_UP, HR_UP, ADMIN_UP, str, int, bool, obj, NO_ARGS, SCOPE_NOTE }, { HR_UP, ADMIN_UP, str, int, obj, NO_ARGS, paging, enumOf }, {
  ALL_ROLES, ADMIN_UP,
  str, obj, NO_ARGS, date, enumOf, ENTRY_STATUS, SCOPE_NOTE,
}, {
  ADMIN_UP, GROWTH_UP, PRO_ONLY,
  str, int, num, bool, obj, NO_ARGS, enumOf,
}, ADMIN_UP, ALL_ROLES, bool() (+23 more)

### Community 25 - "supervisor.routes.js"
Cohesion: 0.18
Nodes (16): adjustUserBankHours(), adjustTeamMemberBankHours(), approveEntry(), approveOvertime(), canManageTeamUser(), getEntryDetails(), isElevatedRole(), loadEntryForOvertimeDecision() (+8 more)

### Community 26 - "ColaboradorDashboard.tsx"
Cohesion: 0.15
Nodes (14): BarcodeDetectorCode, BarcodeDetectorInstance, BarcodeDetectorStatic, ColaboradorDashboard(), CurrentEntryResponse, FACE_MODEL_SOURCES, FaceStatusResponse, GeofenceConfig (+6 more)

### Community 27 - "AdminDashboard.tsx"
Cohesion: 0.12
Nodes (20): AdminDashboard(), AdminLocationSettings, AdminPlanStatus, AdminSeatPayload, BankHoursOverviewItem, formatMinutesLabel(), formatMinutesToHours(), InvitableRole (+12 more)

### Community 28 - "seatBilling.js"
Cohesion: 0.21
Nodes (19): buildBasePlanLineItem(), createAdditionalSeatsCheckoutSession(), createBasePlanCheckoutSession(), DEFAULT_ADMIN_SESSION_TYPES, EXTRA_ADMIN_SEAT_MONTHLY_USD, getStripeClient(), getSubscriptionSnapshot(), listAdditionalSeatsCheckoutSessions() (+11 more)

### Community 29 - "AuthContext.tsx"
Cohesion: 0.16
Nodes (19): AuthContext, AuthProvider(), AuthState, isPortugueseLanguage(), localizeMessage(), Role, SignUpPayload, UserProfile (+11 more)

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
Cohesion: 0.36
Nodes (7): formatMinutesLabel(), formatMinutesToHours(), parseHoursToMinutes(), SupervisorHoursPage(), TeamBankHoursOverviewItem, TeamMember, TeamWorkSettingsForm

### Community 36 - "publicApi.controller.js"
Cohesion: 0.21
Nodes (15): buildPayrollFilters(), calculateFinancialSummary(), getPayrollSummary(), getPayrollTimeEntries(), listScopedPayrollUsers(), parseDateFilter(), PAYROLL_USER_ROLES, { prisma } (+7 more)

### Community 37 - "createUser"
Cohesion: 0.14
Nodes (22): buildPersistedAdminSeatSnapshot(), chooseMyPlan(), confirmAdditionalSeatsCheckout(), createUser(), deleteUser(), ensureAdminPlanRecord(), getMyCompleteProfile(), getUserById() (+14 more)

### Community 38 - "SuperAdminAccountsPage.tsx"
Cohesion: 0.06
Nodes (45): ensureDescriptionMeta(), normalizeHtmlLanguage(), PageMeta(), PageMetaProps, PublicLayout(), PublicLayoutProps, getMarketingPlans(), getPlanFeatures() (+37 more)

### Community 39 - "seed.js"
Cohesion: 0.18
Nodes (14): adapter, ADMIN_PLAN_CATALOG, buildSeedPaidInvoices(), EXTRA_ADMIN_SEAT_MONTHLY_USD, main(), normalizeEmail(), normalizeText(), parsedExtraAdminSeatMonthlyUsd (+6 more)

### Community 40 - "mcp.controller.js"
Cohesion: 0.19
Nodes (26): badRequest(), catalog, createConnection(), decideAuthorizationRequest(), deleteConnection(), fail(), forbidden(), getAuthorizationRequest() (+18 more)

### Community 41 - "oauthProvider.js"
Cohesion: 0.14
Nodes (19): clientsStore, crypto, {
  InvalidGrantError,
  InvalidClientError,
  InvalidTokenError,
  InvalidTargetError,
  ServerError,
}, isAcceptableResource(), issueTokenPair(), RFC-8707, { prisma }, provider (+11 more)

### Community 42 - "recalcDay.js"
Cohesion: 0.23
Nodes (10): getMyBankHours(), accrueBankHours(), addMonths(), clampPositiveInteger(), expireBankHoursIfNeeded(), { prisma }, { accrueBankHours }, { calculateIncrementalOvertimeSummary } (+2 more)

### Community 43 - "src/index.js"
Cohesion: 0.08
Nodes (24): allowedOrigins, app, cors, corsOptions, defaultAllowedOrigins, { ensureUserPhotoDir }, express, { getOAuthProtectedResourceMetadataUrl } (+16 more)

### Community 44 - "teamInviteToken.js"
Cohesion: 0.25
Nodes (13): crypto, decodePayload(), DEFAULT_TTL_HOURS, encodePayload(), ensureInviteSecret(), INVITABLE_ROLES, issueTeamInviteToken(), MAX_TTL_HOURS (+5 more)

### Community 45 - "supervisor.controller.js"
Cohesion: 0.09
Nodes (28): { adjustBankHours, settleBankHoursAccruals }, approveEntriesBulk(), buildManagedTeamWhere(), buildTeamEntriesScope(), BULK_ENTRY_INCLUDE, classifyBulkEntries(), collectSubtreeIds(), DEFAULT_OVERTIME_LIMIT_MINUTES (+20 more)

### Community 46 - "routes/index.js"
Cohesion: 0.14
Nodes (13): adminRoutes, authRoutes, express, hrRoutes, integrationsRoutes, mcpRoutes, publicRoutes, reportRoutes (+5 more)

### Community 47 - "HrSchedulesPage.tsx"
Cohesion: 0.23
Nodes (11): emptyForm, formatMinutesToHours(), from12h(), HOURS_12, HrMember, HrSchedulesPage(), MINUTES_60, parseHoursToMinutes() (+3 more)

### Community 48 - "HrDailyTimePage.tsx"
Cohesion: 0.27
Nodes (11): AddEntryForm(), DateRow, EntryEditor(), formatMinutes(), fromLocalInput(), HrEntry, HrMember, pad() (+3 more)

### Community 49 - "server.js"
Cohesion: 0.16
Nodes (17): { callApi }, catalog, createMcpServer(), handleMcpRequest(), INSTRUCTIONS, {
  ListToolsRequestSchema,
  CallToolRequestSchema,
}, loadActor(), normalizePlan() (+9 more)

### Community 50 - "geofence.js"
Cohesion: 0.23
Nodes (14): getLocationSettings(), getGeofenceSettings(), evaluateGeofence(), getGeofenceConfig(), getGeofencePublicConfig(), haversineDistanceMeters(), initGeofenceConfig(), LOCATION_VALIDATION_SOURCES (+6 more)

### Community 51 - "Overview.tsx"
Cohesion: 0.19
Nodes (11): pickInitial(), sizeByVariant, UserAvatar(), UserAvatarProps, ApprovalLog, Overview(), TimeEntry, CompleteProfile (+3 more)

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
Cohesion: 0.33
Nodes (7): GlobalLoadingOverlay(), listeners, LoadingListener, notifyListeners(), startGlobalLoading(), stopGlobalLoading(), subscribeGlobalLoading()

### Community 58 - "consent.ts"
Cohesion: 0.09
Nodes (31): App(), CookieConsentBanner(), Language, LanguageContext, LanguageContextState, LanguageProvider(), normalizeLanguage(), toI18nLanguage() (+23 more)

### Community 59 - "catalog/index.js"
Cohesion: 0.22
Nodes (7): allScopes(), byName, GROUPS, scopesForTools(), shared, toolNames(), TOOLS

### Community 60 - "faceRecognition.js"
Cohesion: 0.32
Nodes (5): enrollMyFace(), DEFAULT_THRESHOLD, euclideanDistance(), normalizeEmbedding(), verifyFaceMatch()

### Community 61 - "updateUserWorkSettings"
Cohesion: 0.52
Nodes (6): updateUserWorkSettings(), updateTeamMemberWorkSettings(), normalizeHourlyRate(), normalizeMinutes(), normalizeTime(), normalizeTimeZone()

### Community 62 - "timeCalculations.js"
Cohesion: 0.16
Nodes (14): getCurrentEntry(), getMyTimeEntries(), getTimeEntryById(), getTodayEntries(), resolveBreakMinutes(), resolveStoredBreakMinutes(), resolveWorkedMinutes(), resumeBreak() (+6 more)

### Community 63 - "rateLimit.middleware.js"
Cohesion: 0.28
Nodes (8): buildClientKey(), crypto, MAX_REQUESTS, RATE_LIMIT_MESSAGES, rateLimitMiddleware(), requestLog, resolveRateLimitLanguage(), WINDOW_MS

### Community 64 - "SupervisorKpisPage.tsx"
Cohesion: 0.33
Nodes (6): formatMinutesLabel(), HoursKpiItem, HoursKpiResponse, HoursKpiTimelineItem, KpiPeriod, SupervisorKpisPage()

### Community 65 - "pinAuth.js"
Cohesion: 0.28
Nodes (8): crypto, getPinLockExpiry(), hashPin(), PIN_LOCK_MINUTES, PIN_MAX_ATTEMPTS, { promisify }, scrypt, verifyPin()

### Community 66 - "dependencies"
Cohesion: 0.33
Nodes (5): dependencies, pg, @prisma/adapter-pg, pg, @prisma/adapter-pg

### Community 67 - "captureRequestMetadata"
Cohesion: 0.70
Nodes (4): captureRequestMetadata(), getClientIP(), getDeviceInfo(), getLocation()

### Community 68 - "bridge.js"
Cohesion: 0.53
Nodes (5): buildRequest(), callApi(), REQUEST_TIMEOUT_MS, resolveInternalBase(), resolvePathTemplate()

### Community 82 - "DualClock.tsx"
Cohesion: 0.53
Nodes (5): DualClock(), DualClockProps, formatTime(), getBrowserTimeZone(), getZoneShortLabel()

### Community 83 - "integrations.routes.js"
Cohesion: 0.40
Nodes (4): express, router, slackController, slackOAuthController

### Community 84 - "buildUserPhotoUrl"
Cohesion: 0.50
Nodes (5): deleteMyPhoto(), removePhotoFileIfExists(), uploadMyPhoto(), buildUserPhotoUrl(), normalizePhotoPath()

### Community 85 - "roles.js"
Cohesion: 0.50
Nodes (3): HR_LEVEL_ROLES, HR_MANAGEABLE_ROLES, INTEGRATOR_MANAGEABLE_ROLES

## Knowledge Gaps
- **707 isolated node(s):** `node`, `es2021`, `eslint:recommended`, `ecmaVersion`, `sourceType` (+702 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `prisma` connect `database.js` to `pro.controller.js`, `reportWorker.js`, `auth.middleware.js`, `publicApi.controller.js`, `proactiveAlertWorker.js`, `mcp.controller.js`, `slack.controller.js`, `oauthProvider.js`, `recalcDay.js`, `user.controller.js`, `supervisor.controller.js`, `admin.controller.js`, `hr.controller.js`, `vacation.controller.js`, `finance.controller.js`, `server.js`, `user.routes.js`, `time.controller.js`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `App.tsx` to `SupervisorKpisPage.tsx`, `SupervisorHoursPage.tsx`, `SuperAdminAccountsPage.tsx`, `apiFetch`, `SupervisorDashboard.tsx`, `SupervisorPendingItemsPage.tsx`, `HrSchedulesPage.tsx`, `HrDailyTimePage.tsx`, `Overview.tsx`, `ShellLayout.tsx`, `AdminFinancePage.tsx`, `ColaboradorDashboard.tsx`, `AdminDashboard.tsx`, `AuthContext.tsx`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `apiFetch()` connect `apiFetch` to `SupervisorKpisPage.tsx`, `SupervisorHoursPage.tsx`, `App.tsx`, `SuperAdminAccountsPage.tsx`, `SupervisorDashboard.tsx`, `SupervisorPendingItemsPage.tsx`, `HrSchedulesPage.tsx`, `HrDailyTimePage.tsx`, `Overview.tsx`, `AdminFinancePage.tsx`, `ShellLayout.tsx`, `ColaboradorDashboard.tsx`, `AdminDashboard.tsx`, `AuthContext.tsx`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `node`, `es2021`, `eslint:recommended` to the rest of the system?**
  _707 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pro.controller.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05217391304347826 - nodes in this community are weakly interconnected._
- **Should `reportWorker.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07058823529411765 - nodes in this community are weakly interconnected._
- **Should `database.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1286549707602339 - nodes in this community are weakly interconnected._