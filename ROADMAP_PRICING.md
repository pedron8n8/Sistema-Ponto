# Roadmap de Evolução por Planos

## Resumo dos Planos (Criados via Stripe)

- **Starter:** Para empresas que querem sair do processo manual básico.
- **Growth:** Para empresas crescendo, que precisam de cerca virtual (GPS), terminal físico, férias e controle rigoroso de horas extras.
- **Pro:** Para operações maduras que exigem biometria com prova de vida, integrações nativas e alertas proativos (redução direta de custos).

---

## 🟢 Fase 1: Fundação Pública & Starter (Concluído)

- [x] Internacionalização i18n com seletor de linguagem persistente (PT/EN).
- [x] Reformulação da tela de Login com login social via Google e opção de criação de conta manual.
- [x] Páginas Públicas baseadas no produto real com layouts de marketing (Hero, Como Funciona, Provas Sociais, Planos).
- [x] Páginas Legais padronizadas e em i18n (Features de Privacidade, LGPD ready e Termos).
- [x] Links integrados com os planos (links dinâmicos `VITE_STRIPE_LINK_STARTER`, `GROWTH`, `PRO`).
- [x] Gestão de usuários, visualização de painel do Colaborador, log de requisição, etc.
- [x] Relatórios em CSV padrões.

---

## 🟡 Fase 2: Diferenciais Growth (Concluído)

- **Fase 2 completa:** verdadeiro

- [x] **Trilha Férias:** Aprovações de supervisor com log e histórico completo já operando.
- [x] **Geolocalização / GPS:** Registros já operam com localização em `backend/src/utils/geofence.js` (Radius/Alert vs Block Mode).
- [x] **Totem / Terminal QR:** Terminal estático via QR anti-replay já desenvolvido em backend via `TERMINAL_REGISTRY`.
- [x] **Workflow Financeiro de Horas Extras e Banco.**
- [x] **Locking Inteligente:** Bloqueio por plano ativo implementado via middleware `requirePlan(...)` no backend (rotas de férias, terminal QR e configurações de localização), além de guardas de rota no frontend.
- [x] **Traduzir a área logada interna (`/app`):** Migração concluída para `t()` com `react-i18next` nos componentes e páginas da área logada.

---

## 🔴 Fase 3: Diferenciais Pro (Concluído)

- [x] **Biometria:** Código de liveness via `face-api.js` já existe na base (limiares, deltas, detecção de falsificação).
- [x] **Alertas Proativos em Tempo Real:** Worker dedicado (`backend/src/workers/proactiveAlertWorker.js`) dispara no fim do expediente com fila/retry e envio por email/webhook usando `SMTP_*` e `PUSH_WEBHOOK_URL`.
- [x] **API Pública:** Endpoints expostos em `/api/v1/public/payroll/*` com token assinado para integração de folha sem CSV, documentados em `backend/API_PUBLIC_PRO_PAYROLL.md`.
- [x] **Feature Flags:** Rotas de painel PRO protegidas com `requirePlan('PRO')` para configuração de liveness e API (`/api/v1/admin/pro/*`).
