# Matriz de Autorizacao da API

Data: 2026-03-26
Base URL: http://localhost:3000/api/v1

Criterio de classificacao:
- BLOQUEADO: status 401 ou 403
- PERMITIDO: qualquer outro status HTTP
- LIMITADO: status 429 (rate limit, nao representa regra de autorizacao)
- ERRO_CLIENTE: falha local sem resposta HTTP

Resumo:
- Endpoints verificados: 64
- Bloqueios sem token: 62
- Bloqueios MEMBER: 41
- Bloqueios SUPERVISOR: 28
- Bloqueios HR: 12
- Bloqueios ADMIN: 2
- Endpoints com alguma ocorrencia de LIMITADO (429): 0

## Tabela completa

| Endpoint | Metodo | Sem token | MEMBER | SUPERVISOR | HR | ADMIN |
|---|---|---|---|---|---|---|
| GET /health | GET | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/health | GET | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/protected | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/admin-only | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) |
| GET /api/v1/supervisor-access | GET | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (200) | BLOQUEADO (403) | PERMITIDO (200) |
| GET /api/v1/auth/me | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/auth/profile | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/users/me/face | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| POST /api/v1/users/me/face/enroll | POST | BLOQUEADO (401) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) |
| DELETE /api/v1/users/me/face | DELETE | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/users | GET | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/users/:id | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| POST /api/v1/users | POST | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (400) |
| PATCH /api/v1/users/:id | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) |
| DELETE /api/v1/users/:id | DELETE | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (404) |
| POST /api/v1/time/terminal/qr | POST | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) |
| POST /api/v1/time/clock-in | POST | BLOQUEADO (401) | PERMITIDO (400) | BLOQUEADO (403) | BLOQUEADO (403) | BLOQUEADO (403) |
| POST /api/v1/time/clock-out | POST | BLOQUEADO (401) | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | BLOQUEADO (403) |
| GET /api/v1/time/current | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/time/today | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/time/geofence | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/time/me | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/time/bank-hours/me | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/time/:id/notes | PATCH | BLOQUEADO (401) | PERMITIDO (400) | PERMITIDO (404) | PERMITIDO (404) | PERMITIDO (404) |
| GET /api/v1/time/:id | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | BLOQUEADO (403) | PERMITIDO (200) |
| GET /api/v1/supervisor/team | GET | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/supervisor/presence | GET | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/supervisor/kpis/hours | GET | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/supervisor/entries | GET | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/supervisor/entries/:id | GET | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/supervisor/approve/:id | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) |
| PATCH /api/v1/supervisor/reject/:id | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) |
| PATCH /api/v1/supervisor/request-edit/:id | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) |
| PATCH /api/v1/supervisor/team/:userId/bank-hours | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (400) | PERMITIDO (400) |
| GET /api/v1/supervisor/team/bank-hours/overview | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/supervisor/team/:userId/bank-hours/pay | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/supervisor/team/:userId/work-settings | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (400) | PERMITIDO (400) |
| GET /api/v1/supervisor/presence/stream | GET | BLOQUEADO (401) | BLOQUEADO (403) | ERRO_CLIENTE (-1) | ERRO_CLIENTE (-1) | ERRO_CLIENTE (-1) |
| POST /api/v1/reports/export | POST | BLOQUEADO (401) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) |
| GET /api/v1/reports/status/:jobId | GET | BLOQUEADO (401) | PERMITIDO (404) | PERMITIDO (404) | PERMITIDO (404) | PERMITIDO (404) |
| GET /api/v1/reports/list | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/reports/download/:filename | GET | BLOQUEADO (401) | PERMITIDO (404) | PERMITIDO (404) | PERMITIDO (404) | PERMITIDO (404) |
| GET /api/v1/reports/daily-breakdown | GET | BLOQUEADO (401) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) |
| DELETE /api/v1/reports/:filename | DELETE | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (404) |
| GET /api/v1/admin/stats | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/admin/team-overview | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/admin/audit/:timeEntryId | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/admin/users/:userId/entries | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/admin/users/:userId/supervisor | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/admin/users/:userId/pin | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| DELETE /api/v1/admin/users/:userId/pin | DELETE | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/admin/users/:userId/bank-hours | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (400) | PERMITIDO (400) |
| GET /api/v1/admin/bank-hours/overview | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/admin/users/:userId/bank-hours/pay | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/admin/users/:userId/work-settings | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (400) | PERMITIDO (400) |
| GET /api/v1/admin/location-settings | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/admin/location-settings | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| GET /api/v1/vacations/me | GET | BLOQUEADO (401) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
| POST /api/v1/vacations/request | POST | BLOQUEADO (401) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) | PERMITIDO (400) |
| GET /api/v1/vacations/team/requests | GET | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (200) | BLOQUEADO (403) | PERMITIDO (200) |
| GET /api/v1/vacations/hr/requests | GET | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) |
| PATCH /api/v1/vacations/:id/supervisor-review | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (400) | BLOQUEADO (403) | PERMITIDO (400) |
| PATCH /api/v1/vacations/:id/hr-review | PATCH | BLOQUEADO (401) | BLOQUEADO (403) | BLOQUEADO (403) | PERMITIDO (400) | PERMITIDO (400) |
| GET /api/v1/vacations/team/calendar | GET | BLOQUEADO (401) | BLOQUEADO (403) | PERMITIDO (200) | PERMITIDO (200) | PERMITIDO (200) |
