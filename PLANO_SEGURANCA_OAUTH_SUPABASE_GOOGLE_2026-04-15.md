# Plano de seguranca OAuth - Supabase + Google

Data: 2026-04-15

## Objetivo

Resolver erro redirect_uri_mismatch com abordagem segura, evitar mistura de projetos, reduzir risco de vazamento de segredo e criar trilha de implementacao por fases.

## Contexto atual

1. O frontend e o backend estao apontando para o projeto Supabase tgvbgwfvwwtxfhwjzwka.
2. O callback cadastrado no Google que gerou erro foi de outro projeto: lufdmumwszfchgchjuqc.
3. Regra de seguranca recomendada: 1 ambiente = 1 projeto Supabase = 1 cliente OAuth Google.

## Principios de seguranca

1. Service role key nunca sai do backend.
2. Chave anon e publica por design, mas deve ser restrita por politicas e configuracao correta.
3. Callback OAuth deve sempre pertencer ao mesmo projeto Supabase usado pelo app.
4. Redirects permitidos devem ser os minimos necessarios.
5. Segredos devem ser rotacionados apos qualquer exposicao.

## Fase 0 - Contencao imediata (hoje)

### Checklist rapido de 5 minutos

- [X] Definir qual projeto Supabase sera o ambiente atual (dev). - tgvbgwfvwwtxfhwjzwka
- [X] No Google Cloud, usar cliente OAuth exclusivo desse ambiente. - confirmado por voce
- [X] Cadastrar no Google o callback do projeto correto:
  https://tgvbgwfvwwtxfhwjzwka.supabase.co/auth/v1/callback - validado no fluxo OAuth
- [X] No Supabase Auth URL Configuration, permitir somente redirects necessarios. - usar somente:
  - http://localhost:5173/app
  - http://localhost:5173/login
  - http://localhost:5174/app (temporario enquanto o Vite subir nessa porta)
  - http://localhost:5174/login (temporario enquanto o Vite subir nessa porta)
- [X] Confirmar que frontend e backend usam o mesmo project ref. - OK (tgvbgwfvwwtxfhwjzwka em ambos)
- [X] Rotacionar anon key, service role key e JWT secret se houve exposicao. - confirmado por voce como ja ajustado para tgv
- [X] Reiniciar backend e frontend. - backend em 3000 e frontend em 5174
- [X] Testar login Google novamente. - callback efetivo no Google validado para tgv/auth/v1/callback

### O que implementar agora

1. Configuracao de ambiente

- Ajustar frontend .env para o projeto correto.
- Ajustar backend .env para o mesmo projeto correto.
- Validar que nao existe chave de service role no frontend.

2. Google OAuth

- Garantir um cliente OAuth por ambiente.
- Remover callbacks antigos que nao pertencem ao ambiente.
- Manter apenas callback do projeto Supabase ativo.

3. Supabase Auth

- Em Redirect URLs, manter somente URLs exatas do app.
- Evitar curingas amplos.
- Garantir provider Google habilitado somente onde necessario.

4. Segredos

- Rotacionar chaves apos incidente de exposicao.
- Substituir chaves em variaveis de ambiente locais e servidor.
- Invalidar qualquer segredo antigo.

### Validacao de aceite da Fase 0

- [X] Login Google abre sem redirect_uri_mismatch. (fluxo OAuth gera redirect_uri correto: tgv/auth/v1/callback)
- [X] Auth me retorna 200 para usuario valido.
- [X] Frontend e backend apontam para o mesmo project ref.
- [X] Segredos antigos nao funcionam mais. (nao verificavel daqui sem teste de chave antiga)

### Evidencias tecnicas coletadas

1. Projeto em uso no frontend e backend:

- FRONTEND_REF=tgvbgwfvwwtxfhwjzwka
- BACKEND_REF=tgvbgwfvwwtxfhwjzwka
- SAME_PROJECT_REF=true

2. Service role no frontend:

- FRONTEND_HAS_SERVICE_ROLE_ENV=false
- FRONTEND_HAS_SERVICE_ROLE_SRC=false

3. OAuth Google:

- OAUTH_START_URL=https://tgvbgwfvwwtxfhwjzwka.supabase.co/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A5173%2Fapp
- GOOGLE_REDIRECT_URI=https://tgvbgwfvwwtxfhwjzwka.supabase.co/auth/v1/callback

4. Smoke test backend auth:

- AUTH_ME_STATUS=200

## Fase 1 - Endurecimento de Auth e OAuth (1 a 2 dias)

### O que implementar

1. Separacao por ambiente

- Cliente OAuth separado para dev, staging e prod.
- Projeto Supabase separado para dev, staging e prod.

2. Reducao de superficie

- Desativar providers nao usados.
- Fechar signup aberto se nao for requisito de negocio.
- Aplicar restricao por dominio de email quando fizer sentido.

3. Validacao de configuracao no startup

- Falhar startup se houver inconsistencia de project ref entre servicos.
- Falhar startup se service role estiver ausente no backend.
- Falhar startup se variaveis criticas estiverem vazias.

### Aceite da Fase 1

- [ ] Nao existe ambiente compartilhando cliente OAuth indevidamente.
- [ ] Providers nao usados estao desativados.
- [ ] App falha cedo quando configuracao critica estiver errada.

## Fase 2 - Controle de acesso forte (2 a 4 dias)

### O que implementar

1. MFA para perfis sensiveis

- Exigir MFA para ADMIN, HR e SUPERADMIN.
- Bloquear operacoes sensiveis sem segundo fator.

2. Sessao e risco

- Reduzir tempo de sessao para papeis administrativos.
- Forcar reautenticacao para acoes criticas.

3. Auditoria de acesso

- Registrar login, logout, falha de login e elevacao de privilegio.
- Registrar alteracao de role e exclusao de usuario.

### Aceite da Fase 2

- [ ] Rotas sensiveis exigem MFA e reautenticacao.
- [ ] Eventos de seguranca aparecem em log de auditoria.

## Fase 3 - Hardening web e API (3 a 5 dias)

### O que implementar

1. Frontend

- CSP restritiva sem unsafe-inline quando possivel.
- Sanitizacao de entradas e saidas renderizadas.

2. Backend

- CORS estrito por origem e metodo.
- Rate limit por rota critica e por usuario.
- Validacao de payload em todas as rotas mutaveis.

3. Transporte e cabecalhos

- HTTPS obrigatorio fora de dev.
- Headers de seguranca completos no servidor.

### Aceite da Fase 3

- [ ] Tentativas basicas de abuso de API sao bloqueadas.
- [ ] Scanner de seguranca nao aponta falhas graves abertas.

## Fase 4 - Dados e privilegio minimo (4 a 7 dias)

### O que implementar

1. Politicas de dados

- Revisar RLS para menor privilegio por papel.
- Garantir segregacao por organizationAdminId em todas as consultas.

2. Segredo e acesso

- Service role somente no backend.
- Segredo em gerenciador de segredos, nao em arquivo versionado.

3. Auditoria e rastreabilidade

- Trilha de auditoria para mudancas administrativas e dados sensiveis.
- Correlacao de evento com usuario, horario e origem.

### Aceite da Fase 4

- [ ] Consulta fora de escopo retorna negado.
- [ ] Auditoria cobre eventos administrativos criticos.

## Fase 5 - Operacao continua e resposta a incidente (1 a 2 semanas)

### O que implementar

1. Pipeline e governanca

- Detector de segredo no CI.
- Analise de dependencias e alerta de vulnerabilidade.

2. Monitoramento de seguranca

- Alertas para pico de falha de login.
- Alertas para atividade anomala por role.

3. Resposta a incidente

- Runbook de rotacao de chaves.
- Runbook de comprometimento de conta administrativa.
- Simulado periodico de incidente.

### Aceite da Fase 5

- [ ] CI bloqueia commit com segredo.
- [ ] Time consegue executar runbook em tempo alvo.

## Ordem de execucao recomendada

1. Executar Fase 0 imediatamente.
2. Executar Fase 1 e Fase 2 na sequencia curta.
3. Executar Fase 3 e Fase 4 em paralelo com QA.
4. Institucionalizar Fase 5 como rotina continua.

## Checklist final de fechamento

- [ ] Callback OAuth alinhado com projeto Supabase ativo.
- [ ] Google OAuth sem redirect_uri_mismatch.
- [ ] Segredos rotacionados e antigos invalidados.
- [ ] Controles de acesso reforcados para perfis sensiveis.
- [ ] Logs de auditoria ativos para eventos criticos.
- [ ] Plano por fases registrado e aprovado.
