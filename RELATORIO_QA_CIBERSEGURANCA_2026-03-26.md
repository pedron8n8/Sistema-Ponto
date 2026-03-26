# Relatorio de QA e Ciberseguranca

Data: 2026-03-26
Ambiente validado:
- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## Parte 1 - Escopo Executado

Foram executados testes:
- Funcionais (API e fluxo base)
- Autenticacao e autorizacao (RBAC)
- Seguranca de API (OWASP API Top 10, foco pratico)
- Resiliencia de entrada (payload invalido, tamanho de body, metodos HTTP)
- Endpoints sensiveis (download de relatorio, auth, admin/supervisor)
- Dependencias (npm audit backend e frontend)
- Testes automatizados existentes (backend e frontend)

## Parte 2 - O Que Foi Corrigido (Confirmado em Reteste)

### 2.1 Vazamento de detalhes em auth
Status: Corrigido

Antes:
- Resposta de token invalido expunha detalhes tecnicos.

Agora:
- Resposta retorna apenas erro generico de autenticacao.

Evidencia de codigo:
- backend/src/middlewares/auth.middleware.js

### 2.2 Vazamento de stack trace em JSON invalido
Status: Corrigido

Antes:
- JSON malformado retornava stack interna.

Agora:
- Retorna 400 com mensagem controlada, sem stack.

Evidencia de codigo:
- backend/src/index.js

### 2.3 CORS permissivo
Status: Corrigido

Antes:
- CORS liberado globalmente.

Agora:
- Origens nao permitidas retornam 403.
- Origem permitida (localhost:5173) responde normalmente.

Evidencia de codigo:
- backend/src/index.js

### 2.4 Ausencia de rate limiting
Status: Corrigido

Antes:
- Burst de requests nao disparava protecao.

Agora:
- Burst retorna 429 para parte das requisicoes.

Evidencia de codigo:
- backend/src/middlewares/rateLimit.middleware.js
- backend/src/index.js

### 2.5 Validacao frouxa de status em /time/me
Status: Corrigido

Antes:
- status invalido era ignorado silenciosamente.

Agora:
- status invalido retorna 400 com mensagem explicita.

Evidencia de codigo:
- backend/src/controllers/time.controller.js

## Parte 3 - O Que Permanece em Aberto

### 3.1 Dependencias com vulnerabilidades altas
Status: Pendente
Severidade: Alta

Backend (npm audit --omit=dev):
- Total: 12
- High: 7
- Moderate: 5
- Destaques: prisma (cadeia com hono/effect), xlsx

Frontend (npm audit --omit=dev):
- Total: 3
- High: 1
- Low: 2
- Destaque: node-fetch transitivo via face-api.js

### 3.2 Suite de testes backend quebrada
Status: Pendente
Severidade: Alta

Falhas principais:
- tests/routes/routes.integration.test.js
  - clock-in esperado 201, recebido 403
  - clock-out esperado 200, recebido 403
  - caso de ponto aberto esperado 400, recebido 500
  - timeout em reports/list
- tests/middlewares/auth.middleware.test.js
  - cenarios esperados 401/403 recebendo 500
  - next() nao chamado no cenario valido

### 3.3 Frontend sem suite de testes
Status: Pendente
Severidade: Media

- npm test: script inexistente
- npm run build: concluido com sucesso

### 3.4 Segredos em .md (aceite temporario)
Status: Aceite de risco temporario (nao tratado por decisao atual)
Severidade: Critica (se for para repositorio/producao)

Arquivos com exposicao:
- backend/CREDENTIALS.md
- backend/logins.md

Observacao:
- Apesar de fora de escopo de correcoes nesta rodada, manter esses dados versionados continua sendo risco operacional.

## Parte 4 - Controles Que Continuam Passando

- RBAC principal:
  - MEMBER bloqueado em /api/v1/admin/stats e /api/v1/users
  - SUPERVISOR bloqueado em /api/v1/admin-only
- IDOR basico em /api/v1/users/:id com MEMBER bloqueado (403)
- Download de relatorio sem token retorna 401
- Tentativa de path traversal em download retorna 400
- TRACE e PUT em /health retornam 404
- Payload oversized retorna 413
- JWT adulterado retorna 401

## Parte 5 - Plano de Acao em Partes

### Parte A (imediata)
1. Corrigir testes quebrados de auth middleware e rotas de ponto.
2. Ajustar testes de integracao para refletir requisitos atuais de seguranca (ex.: fatores adicionais, rate limit, CORS).

### Parte B (curto prazo)
1. Tratar vulnerabilidades High com menor risco de quebra primeiro.
2. Montar plano de upgrade de prisma/hono/effect com validação em staging.
3. Definir mitigacao formal para xlsx (sem fix automatico no audit atual).

### Parte C (qualidade de seguranca)
1. Adicionar suite de testes frontend.
2. Incluir gate em CI: lint + tests + audit + verificacao minima de seguranca.

## Parte 6 - Checklist Atualizado

- [x] Sem stack trace em respostas HTTP
- [x] Mensagens de erro genericas para auth
- [x] CORS restrito por ambiente
- [x] Rate limiting habilitado e testado
- [x] Validacao estrita de status em /time/me
- [ ] npm audit sem highs sem mitigacao documentada
- [ ] Testes backend essenciais passando
- [ ] Suite frontend de testes existente

## Parte 7 - Conclusao Atual

O sistema evoluiu em hardening de runtime (CORS, rate limit, respostas seguras, validacao de entrada). O maior risco remanescente esta concentrado em dependencias vulneraveis e estabilidade da suite de testes automatizados.

Recomendacao: seguir pela Parte A do plano imediatamente, depois executar a Parte B com controle de regressao.
