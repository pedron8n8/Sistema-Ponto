# 🕒 Backlog: Paridade com Pontotel

> Sistema atual cobre ~18% das funcionalidades da Pontotel.
> As fases abaixo estão ordenadas por prioridade de negócio e dependência técnica.

---

## Fase A — Métodos de Registro de Ponto `CRÍTICO`

- [X] **A-01** Reconhecimento facial no clock-in
  - Integrar biblioteca de face recognition (face-api.js)
  - Armazenar embedding facial no cadastro do usuário (nunca a foto bruta)
  - Validar identidade no momento do registro com threshold de confiança configurável


- [ ] **A-02** Registro via QR Code dinâmico por terminal
  - Gerar QR Code com validade curta (ex: 30s) rotacionado automaticamente
  - Associar QR Code ao terminal/filial para rastrear origem do registro
  - Invalidar QR após uso para evitar replay attacks


- [ ] **A-03** Funcionamento offline no app mobile
  - Armazenar marcações localmente com SQLite / AsyncStorage quando sem conexão
  - Sincronizar automaticamente ao reconectar com resolução de conflitos
  - Exibir indicador de status offline/pendente para o colaborador


- [X] **A-04** Geolocalização com cerca virtual (geofence)
  - Capturar coordenadas GPS no momento do clock-in/out
  - Validar contra raio configurável por unidade/filial
  - Rejeitar ou alertar marcações fora da cerca com log de evidência


- [X] **A-05** Registro via PIN numérico
  - PIN individual por colaborador como alternativa ao facial
  - Rate limiting: bloquear após N tentativas incorretas por período
  - Endpoint de troca de PIN com autenticação prévia
  - **Tags:** `backend`

- [X] **A-06** Prova de vida (liveness detection)
  - Detectar que é um rosto real (piscar, mover cabeça) antes de aceitar o facial
  - Impedir uso de foto estática ou deepfake no reconhecimento
  - **Tags:** `mobile` `segurança`

---

## Fase B — Engine de Cálculo de Horas `CRÍTICO`

- [X] **B-01** Cálculo automático de horas extras
  - Detectar horas além da jornada contratual do colaborador
  - Classificar: 50% (dias úteis), 100% (domingos e feriados) — CLT art. 59
  - Executar cálculo ao fechar o ponto (clock-out) e ao fechar o período
  - **Tags:** `backend`

- [X] **B-02** Banco de horas (compensação)
  - Acumular saldo positivo/negativo por colaborador
  - Respeitar limite legal de 6 meses para compensação (CLT)
  - Suportar acordos individuais e coletivos com limites customizados
  - Endpoint para gestor/RH zerar ou ajustar saldo manualmente com log de auditoria
  - **Tags:** `backend`

- [ ] **B-03** Adicional noturno automático
  - Identificar horas trabalhadas entre 22h e 5h
  - Aplicar adicional de 20% sobre hora normal — CLT art. 73
  - Considerar hora noturna reduzida (52min30s = 1h)
  - **Tags:** `backend`

- [ ] **B-04** Cálculo e validação de intervalo intrajornada
  - Detectar e descontar intervalos obrigatórios (mínimo 1h para jornadas > 6h)
  - Alertar RH quando intervalo não foi cumprido (risco trabalhista)
  - Suportar intervalos parciais conforme acordos coletivos
  - **Tags:** `backend`

- [ ] **B-05** Suporte a escalas de trabalho configuráveis
  - Modelar escalas: 5x2, 6x1, 12x36, turno fixo, turno variável
  - Calcular horas com base na escala do colaborador, não em jornada fixa
  - Permitir troca de turno entre colaboradores com aprovação do gestor
  - **Tags:** `backend`

- [ ] **B-06** Regras sindicais e acordos coletivos (CCT/ACT)
  - Permitir configuração de percentuais de HE, adicionais e regras por categoria profissional
  - Sobrepor regras-padrão CLT quando ACT/CCT for mais favorável ao trabalhador
  - **Tags:** `backend`

---

## Fase C — Conformidade Legal Brasileira `CRÍTICO`

- [ ] **C-01** Exportação no formato AFD (Portaria 671)
  - Gerar Arquivo-Fonte de Dados no layout exato exigido pelo MTE
  - Obrigatório para empresas com SREP (Sistema de Registro Eletrônico de Ponto)
  - Incluir cabeçalho, registros tipo 2/3/4/5 e rodapé conforme especificação
  - **Tags:** `backend` `legal`

- [ ] **C-02** Exportação AFDT e ACJEF
  - AFDT: Arquivo de Fonte de Dados Tratado (ponto já processado)
  - ACJEF: Arquivo de Controle de Jornada Eletrônica de Frequência
  - Ambos necessários para integração com eSocial e auditorias do MTE
  - **Tags:** `backend` `legal`

- [ ] **C-03** Conformidade com Portaria 671 — REP-C (Registro por Programa)
  - Implementar hash de integridade em cada registro de ponto (SHA-256)
  - Logs imutáveis: nenhuma alteração sem trilha de auditoria completa
  - Carimbo de tempo (timestamp) confiável — considerar integração com servidor NTP
  - **Tags:** `backend` `legal` `segurança`

- [ ] **C-04** Integração com feriados nacionais e estaduais
  - Consumir API pública (ex: brasilapi.com.br/feriados) ou manter base própria
  - Diferenciar feriados nacionais, estaduais e municipais por UF/cidade da filial
  - Usar na engine de cálculo de horas extras (100%) e em relatórios
  - **Tags:** `backend`

- [ ] **C-05** Adequação LGPD — retenção, anonimização e exclusão
  - Definir TTL para dados biométricos (embeddings faciais) — não armazenar indefinidamente
  - Implementar fluxo de exclusão de dados a pedido do titular (direito ao esquecimento)
  - Anonimizar dados em relatórios exportados quando não necessário identificar o colaborador
  - **Tags:** `backend` `legal` `segurança`

---

## Fase D — Dashboard & Monitoramento em Tempo Real `ALTA`

- [ ] **D-01** Dashboard de presença em tempo real
  - WebSocket ou SSE para atualização sem reload de página
  - Mostrar status de cada colaborador: presente, ausente, em intervalo, HE ativa
  - Filtros por filial, departamento e equipe
  - **Tags:** `backend` `frontend`

- [ ] **D-02** KPIs de horas: previsto x realizado x extras
  - Gráficos comparando jornada contratual vs horas efetivamente trabalhadas vs extras
  - Visão por colaborador, equipe e período (diário, semanal, mensal)
  - **Tags:** `frontend`

- [ ] **D-03** Alertas proativos de custo de horas extras
  - Notificar gestor quando colaborador atingir X% do limite de HE configurado
  - Enviar alerta antes do fechamento do período (ex: ao atingir 80% do limite)
  - Suportar notificação por e-mail e/ou push (mobile)
  - **Tags:** `backend`

- [ ] **D-04** Mapa de colaboradores externos
  - Exibir última posição conhecida de colaboradores externos em campo (Mapbox ou Google Maps)
  - Atualizar a cada clock-in/out ou via heartbeat configurável
  - **Tags:** `frontend` `backend`

---

## Fase E — Módulo de Férias `ALTA`

- [ ] **E-01** Solicitação e aprovação de férias (workflow completo)
  - Fluxo: colaborador solicita → supervisor aprova/recusa → RH confirma
  - Notificações por e-mail a cada mudança de status
  - Histórico de todas as solicitações por colaborador
  - **Tags:** `backend`

- [ ] **E-02** Validação automática de período aquisitivo e concessivo (CLT)
  - Calcular período aquisitivo (12 meses de trabalho)
  - Validar período concessivo (12 meses para gozar após aquisição)
  - Suportar férias fracionadas em até 3 períodos — CLT art. 134-A
  - Calcular abono de 1/3 constitucional
  - **Tags:** `backend` `legal`

- [ ] **E-03** Calendário de férias da equipe para o gestor
  - Visualização mensal/anual mostrando sobreposições
  - Alertar quando equipe ficaria abaixo de X% de presença
  - **Tags:** `frontend`

- [ ] **E-04** Alerta de vencimento de férias
  - Notificar RH e gestor 60, 30 e 15 dias antes do vencimento do período concessivo
  - Listar colaboradores em risco de perder férias em relatório mensal automático
  - **Tags:** `backend`

---

## Fase F — Gestão de Custos com Horas Extras `ALTA`

- [ ] **F-01** Solicitação de horas extras com justificativa prévia
  - Gestor solicita HE antes de acontecer; colaborador aceita/recusa
  - Suportar justificativas por texto ou áudio (upload de arquivo de áudio)
  - HE não solicitada previamente entra como pendente de justificativa posterior
  - **Tags:** `backend`

- [ ] **F-02** Previsão de custo de HE antes do fechamento
  - Calcular custo estimado de horas extras da equipe em tempo real no período corrente
  - Projeção até o fim do mês baseada na tendência atual
  - Exibir impacto financeiro estimado em reais (requer salário base configurado)
  - **Tags:** `backend` `frontend`

- [ ] **F-03** Análise e ranking de motivos de custos extras
  - Categorizar HE aprovadas por motivo (demanda extra, cobertura de ausência, etc.)
  - Relatório mensal com ranking dos motivos mais recorrentes por equipe
  - **Tags:** `frontend`

---

## Fase G — Multi-unidade & Estrutura Organizacional `MÉDIA`

- [ ] **G-01** Hierarquia: Empresa → Filial → Departamento → Equipe
  - Criar models `Company`, `Branch`, `Department`, `Team` no schema Prisma
  - Relacionar `User` à hierarquia com herança de permissões
  - Filtros em todos os endpoints respeitando o nível de acesso do solicitante
  - **Tags:** `backend`

- [ ] **G-02** Gestão de múltiplos terminais de ponto por filial
  - Model `Terminal` associado a uma `Branch`
  - Gerar QR Codes e PINs únicos por terminal
  - Registrar em qual terminal cada clock-in foi realizado
  - **Tags:** `backend`

- [ ] **G-03** Relatórios consolidados por nível organizacional
  - Endpoints com agregação por filial, departamento ou equipe
  - Exportação CSV/AFD segmentada por unidade para RH distribuído
  - **Tags:** `backend`

---

## Fase H — Timesheet & Gestão de Tarefas `MÉDIA`

- [ ] **H-01** Modelar `Project` e `Task` no schema Prisma
  - `Project`: id, name, companyId, startDate, endDate, status
  - `Task`: id, projectId, name, estimatedMinutes
  - `TimeEntryTask`: relação N:N entre `TimeEntry` e `Task` com minutos apontados
  - **Tags:** `backend`

- [ ] **H-02** Apontamento de tempo por tarefa durante o turno
  - Colaborador associa o clock-in ativo a uma tarefa/projeto
  - Timer visual na interface mostrando tempo corrente na tarefa
  - Possibilidade de trocar de tarefa sem fazer clock-out
  - **Tags:** `backend` `frontend`

- [ ] **H-03** Relatório de horas por projeto: planejado x realizado
  - Drill-down: projeto → tarefas → colaboradores
  - Exportação CSV com granularidade diária
  - **Tags:** `frontend`

---

## Fase I — App Mobile (iOS & Android) `MÉDIA`

- [ ] **I-01** Estrutura base do app (React Native ou Flutter)
  - Autenticação via Supabase (reutilizar JWT já existente no backend)
  - Navegação: tela de clock-in, histórico, notificações
  - **Tags:** `mobile`

- [ ] **I-02** Tela de clock-in com todos os métodos
  - Facial, PIN, QR Code (câmera) em uma única tela unificada
  - Fallback automático entre métodos se o preferencial falhar
  - **Tags:** `mobile`

- [ ] **I-03** Notificações push
  - Push para: aprovação/rejeição de ponto, solicitação de HE, férias aprovadas, alertas de gestor
  - Integrar FCM (Firebase Cloud Messaging) ou APNs
  - **Tags:** `mobile` `backend`

- [ ] **I-04** Publicação nas stores (Google Play & App Store)
  - Configurar assinatura, ícones, screenshots e descrições
  - Pipeline de CI/CD para builds automáticos (ex: EAS Build / Fastlane)
  - **Tags:** `mobile` `infra`

---

## Fase J — Integrações com Sistemas Externos `BAIXA`

- [ ] **J-01** Integração com sistemas de folha de pagamento via API
  - Expor endpoint padronizado para sistemas como Domínio, Totvs, SAP HCM
  - Documentação OpenAPI completa dos campos exportados
  - **Tags:** `backend`

- [ ] **J-02** Webhooks para eventos de ponto
  - Disparar webhook configurável nos eventos: clock-in, clock-out, aprovação, rejeição
  - Payload padronizado com retry automático em caso de falha
  - **Tags:** `backend`

- [ ] **J-03** SSO corporativo (SAML / OIDC)
  - Permitir login via provedores corporativos (Azure AD, Google Workspace, Okta)
  - Mapear grupos do provedor para roles do sistema (ADMIN, SUPERVISOR, MEMBER)
  - **Tags:** `backend` `segurança`

---

## Resumo por categoria

| Fase | Área                          | Tarefas | Prioridade |
|------|-------------------------------|---------|------------|
| A    | Métodos de registro           | 6       | Crítico    |
| B    | Engine de cálculo de horas    | 6       | Crítico    |
| C    | Conformidade legal BR         | 5       | Crítico    |
| D    | Dashboard & tempo real        | 4       | Alta       |
| E    | Módulo de férias              | 4       | Alta       |
| F    | Gestão de custos / HE         | 3       | Alta       |
| G    | Multi-unidade / Hierarquia    | 3       | Média      |
| H    | Timesheet & tarefas           | 3       | Média      |
| I    | App mobile                    | 4       | Média      |
| J    | Integrações externas          | 3       | Baixa      |
| **Total** |                          | **41**  |            |

---

## O que já está implementado (não refazer)

- [x] Clock-in / clock-out via API REST com captura de IP e User-Agent
- [x] Validação de JWT via Supabase Admin SDK
- [x] Controle de acesso granular por role (ADMIN, SUPERVISOR, MEMBER)
- [x] Workflow de aprovação supervisor → ApprovalLog (trilha de auditoria completa)
- [x] Histórico paginado de pontos por usuário (`GET /time/me`)
- [x] Exportação CSV via fila BullMQ (processamento assíncrono)
- [x] CRUD de usuários e troca de supervisor pelo ADMIN
- [x] Testes unitários e de integração (controllers, middlewares, routes)