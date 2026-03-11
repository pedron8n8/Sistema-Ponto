🕒 Backend Task List: Time-Tracking System
Fase 1: Setup & Infraestrutura
[X] Task 1.1: Inicializar projeto Node.js com JavaScript e configurar eslint/prettier.
[X] Task 1.2: Configurar Docker Compose para instâncias locais de PostgreSQL e Redis (para o BullMQ).
[X] Task 1.3: Instalar e configurar Prisma ORM conectado ao banco de dados.
[X] Task 1.4: Integrar Supabase Admin SDK para validação de JWT e gerenciamento de usuários.


Fase 2: Modelagem de Dados (Prisma Schema)
[X] Task 2.1: Criar Model User (id, email, role [ADMIN, SUPERVISOR, MEMBER], supervisorId).
[X] Task 2.2: Criar Model TimeEntry (id, userId, clockIn, clockOut, notes, ipAddress, location, device, status [PENDING, APPROVED, REJECTED]).
[X] Task 2.3: Criar Model ApprovalLog para trilha de auditoria (id, timeEntryId, reviewerId, action, comment, timestamp).
[X] Task 2.4: Rodar migrations e gerar o Prisma Client.


Fase 3: Autenticação & Middlewares
[X] Task 3.1: Criar middleware authMiddleware para validar o token do Supabase.
[X] Task 3.2: Criar middleware roleCheck(['ADMIN', 'SUPERVISOR']) para controle de acesso granular às rotas.


Fase 4: Core - Registro de Ponto (Clock In/Out)
[X] Task 4.1: Endpoint POST /time/clock-in: Registra o início, captura IP/User-Agent e valida se já não existe um ponto aberto.
[X] Task 4.2: Endpoint POST /time/clock-out: Atualiza o registro atual com o timestamp de saída e notas opcionais.
[X] Task 4.3: Endpoint GET /time/me: Retorna o histórico de pontos do usuário logado (paginado).


Fase 5: Workflow de Aprovação (Supervisor)
[ ] Task 5.1: Endpoint GET /supervisor/entries: Lista registros pendentes dos membros da equipe do supervisor logado.
[ ] Task 5.2: Endpoint PATCH /supervisor/approve/:id: Altera status para 'APPROVED' e registra no ApprovalLog.
[ ] Task 5.3: Endpoint PATCH /supervisor/request-edit/:id: Altera status para 'PENDING' e adiciona comentário obrigatório do supervisor.


Fase 6: Relatórios & Background Jobs (BullMQ)
[ ] Task 6.1: Configurar Worker do BullMQ para processamento de filas de exportação.
[ ] Task 6.2: Endpoint POST /reports/export: Recebe filtros (data, equipe), adiciona job na fila para gerar CSV.
[ ] Task 6.3: Implementar lógica de geração de CSV e envio (ou disponibilização de link de download via Supabase Storage).


Fase 7: Admin & Auditoria
[ ] Task 7.1: Endpoints de CRUD para o Admin gerenciar usuários e trocar supervisores de equipe.
[ ] Task 7.2: Endpoint GET /admin/audit/:timeEntryId: Retorna todo o histórico de alterações de um registro específico.


Fase 8: Frontend - Interface do Usuário (React + Tailwind)
[ ] Task 8.1: Configurar projeto React com Tailwind CSS e suporte a PWA (Vite/PWA plugin).
[ ] Task 8.2: Implementar Fluxo de Auth (Login/Logout) integrado ao Supabase.
[ ] Task 8.3: Dashboard Colaborador: Botão de "Clock In/Out", timer de jornada atual e campo para notas.
[ ] Task 8.4: Dashboard Supervisor: Lista de aprovações pendentes com filtros por colaborador e modal de revisão (Aprovar/Rejeitar/Comentar).
[ ] Task 8.5: Dashboard Admin: Tela de gestão de usuários (CRUD) e atribuição de supervisores.
[ ] Task 8.6: Relatórios: Tela de visualização de timesheet semanal com botão para "Solicitar Exportação CSV".


Fase 9: DevOps & Deploy
[ ] Task 9.1: Criar Dockerfile multi-stage para a aplicação Node.js.
[ ] Task 9.2: Configurar docker-compose.yml unindo Backend, Redis e Postgres (para ambiente de dev).
[ ] Task 9.3: Configurar Variáveis de Ambiente (.env.example) incluindo chaves do Supabase e credenciais do banco.
[ ] Task 9.4: Setup do Supabase Storage bucket para armazenar os CSVs gerados pelo BullMQ.

Fase 10: Documentação & Onboarding (Requisito da Gestora)
[ ] Task 10.1: Criar ADMIN_GUIDE.md: Instruções de como criar novos usuários e extrair relatórios.
[ ] Task 10.2: Documentar a API no README ou usando Swagger (Fastify-Swagger se estiver usando Fastify, ou swagger-jsdoc para Express).
[ ] Task 10.3: Criar script de "Seed" no Prisma para popular o banco com o primeiro Admin e alguns supervisores de teste.