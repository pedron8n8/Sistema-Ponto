Analise **todo o codebase do projeto** — rotas, componentes, modelos de dados, fluxos de autenticação, design system (cores, tipografia, espaçamentos), e a proposta de valor central do app de controle de ponto.

Com base nessa análise completa, crie os seguintes arquivos/páginas totalmente integrados ao projeto existente:

---

**0. INTERNACIONALIZAÇÃO (i18n) — configurar antes de tudo**

Instale e configure  **i18next + react-i18next + i18next-browser-languagedetector** :

bash

```bash
npminstall i18next react-i18next i18next-browser-languagedetector
```

Estrutura de arquivos:

```
src/
  i18n/
    index.ts          ← configuração do i18next
    locales/
      en.json         ← textos em inglês (idioma padrão)
      pt.json         ← textos em português
```

Configuração em `src/i18n/index.ts`:

* Idioma padrão: `en`
* Detector automático via `i18next-browser-languagedetector`
* Fallback para `en` se idioma não suportado
* Importar e inicializar no `main.tsx` antes do render

No  **header fixo** , adicionar um seletor de idioma discreto (ex: `EN | PT`) que chama `i18n.changeLanguage()` e persiste a escolha no `localStorage`.

Todos os textos das páginas abaixo devem usar `t('chave')` — **nenhum texto hardcoded em português ou inglês** nos componentes.

---

**1. LANDING PAGE (`/`)**

* Hero section com headline impactante (ex:  *"Stop using spreadsheets. Track your team's attendance in real time."* )
* Subheadline com benefício principal
* CTA primário ("Get started free") e CTA secundário ("View pricing")
* Seção de features visuais com ícones — extraída das funcionalidades reais do app
* Seção "How it works" (3 passos simples)
* Seção de depoimentos/prova social (placeholders realistas)
* Seção de pricing embutida com link direto ao checkout
* CTA final antes do footer
* Header fixo com: logo, nav (Features | Pricing | Login), botão "Sign up" e **seletor de idioma `EN | PT`**
* Footer com links para Privacy Policy, Terms of Service, Pricing e Contact

**2. AUTENTICAÇÃO**

* Botão **Sign in with Google** (OAuth) integrado ao Supabase Auth já existente
* Botão **Sign in with email/password**
* Botão **Create account**
* Todos os labels via `t()`, visualmente consistentes com o design system atual

**3. PÁGINA DE PRICING (`/pricing`)**

Três planos mensais em cards comparativos:

| Plan    | Seats   | Price  |
| ------- | ------- | ------ |
| Starter | 3 seats | $30/mo |
| Growth  | 5 seats | $40/mo |
| Pro     | 7 seats | $50/mo |

* Destaque visual no plano Growth como "Most Popular"
* Cada card com features extraídas do app real
* Botão "Subscribe now" com link direto ao checkout da Stripe via variáveis de ambiente:
  * `VITE_STRIPE_LINK_STARTER`
  * `VITE_STRIPE_LINK_GROWTH`
  * `VITE_STRIPE_LINK_PRO`
* Todos os textos dos planos traduzíveis via `t()`

**4. PÁGINA DE PRIVACIDADE (`/privacy`)**

* Política de privacidade profissional em inglês (idioma padrão), traduzível
* Cobrindo: data collection, usage, storage, cookies, user rights (GDPR/LGPD-ready)
* Alinhada com os dados reais do app (attendance records, face recognition via face-api.js, geolocation via Leaflet, Supabase auth)

**5. PÁGINA DE TERMOS DE USO (`/terms`)**

* Terms of Service cobrindo: acceptable use, responsibilities, cancellation, refund policy, limitation of liability
* Traduzível via i18n

---

**REQUISITOS TÉCNICOS:**

* Stack: React 19 + TypeScript + Vite + TailwindCSS v4 + react-router-dom v7
* i18n: i18next + react-i18next, idioma padrão `en`, suporte a `pt`
* **Zero texto hardcoded** nos componentes — tudo via `t('namespace.key')`
* Responsivo mobile-first
* SEO básico com meta tags por página (title + description também traduzíveis)
* Usar os mesmos componentes UI já existentes no projeto
* Prefixar variáveis de ambiente com `VITE_` (padrão Vite)
* Não quebrar nenhuma rota ou funcionalidade existente
