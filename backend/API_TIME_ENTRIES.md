# 📋 API de Registro de Ponto - Documentação

## 🔐 Autenticação

Todas as rotas requerem autenticação via Bearer Token do Supabase:

```
Authorization: Bearer <seu_token_supabase>
```

## 📍 Endpoints Disponíveis

### 1. **Clock In** - Registrar Entrada

```http
POST /api/v1/time/clock-in
Content-Type: application/json
Authorization: Bearer <token>

{
  "notes": "Iniciando trabalho do dia",
  "latitude": -23.5505,
  "longitude": -46.6333
}
```

**Campos:**
- `notes` (opcional): Anotações sobre o registro
- `latitude` e `longitude` (opcional): Coordenadas de geolocalização

**Resposta de Sucesso (201):**
```json
{
  "message": "Clock-in registrado com sucesso",
  "timeEntry": {
    "id": "uuid",
    "userId": "uuid",
    "clockIn": "2026-03-11T14:30:00.000Z",
    "notes": "Iniciando trabalho do dia",
    "ipAddress": "192.168.1.1",
    "device": "Desktop - Chrome on Windows",
    "location": {
      "lat": -23.5505,
      "lng": -46.6333,
      "timestamp": "2026-03-11T14:30:00.000Z"
    },
    "status": "PENDING",
    "user": {
      "id": "uuid",
      "name": "João Silva",
      "email": "joao@empresa.com",
      "role": "MEMBER"
    }
  }
}
```

**Erro - Ponto já aberto (400):**
```json
{
  "error": "Bad Request",
  "message": "Você já possui um ponto aberto. Faça clock-out antes de iniciar um novo registro.",
  "openEntry": {
    "id": "uuid",
    "clockIn": "2026-03-11T14:30:00.000Z",
    "notes": "Iniciando trabalho do dia"
  }
}
```

---

### 2. **Clock Out** - Registrar Saída

```http
POST /api/v1/time/clock-out
Content-Type: application/json
Authorization: Bearer <token>

{
  "notes": "Finalizando trabalho do dia"
}
```

**Campos:**
- `notes` (opcional): Anotações sobre o registro (substitui ou complementa as notas do clock-in)

**Resposta de Sucesso (200):**
```json
{
  "message": "Clock-out registrado com sucesso",
  "timeEntry": {
    "id": "uuid",
    "userId": "uuid",
    "clockIn": "2026-03-11T14:30:00.000Z",
    "clockOut": "2026-03-11T18:45:00.000Z",
    "notes": "Finalizando trabalho do dia",
    "ipAddress": "192.168.1.1",
    "device": "Desktop - Chrome on Windows",
    "location": { "lat": -23.5505, "lng": -46.6333 },
    "status": "PENDING",
    "duration": {
      "totalMs": 15300000,
      "totalMinutes": 255,
      "totalHours": "4.25",
      "formatted": "4h 15m 0s",
      "hours": 4,
      "minutes": 15,
      "seconds": 0
    },
    "user": { ... }
  }
}
```

**Erro - Sem ponto aberto (400):**
```json
{
  "error": "Bad Request",
  "message": "Não há registro de ponto aberto. Faça clock-in primeiro."
}
```

---

### 3. **Registro Atual** - Ver Ponto Aberto

```http
GET /api/v1/time/current
Authorization: Bearer <token>
```

**Resposta - Com ponto aberto:**
```json
{
  "hasOpenEntry": true,
  "entry": {
    "id": "uuid",
    "clockIn": "2026-03-11T14:30:00.000Z",
    "notes": "Iniciando trabalho",
    "elapsed": {
      "totalMs": 5400000,
      "totalMinutes": 90,
      "totalHours": "1.50",
      "formatted": "1h 30m 0s",
      "hours": 1,
      "minutes": 30,
      "seconds": 0
    },
    ...
  }
}
```

**Resposta - Sem ponto aberto:**
```json
{
  "hasOpenEntry": false,
  "entry": null
}
```

---

### 4. **Registros de Hoje**

```http
GET /api/v1/time/today
Authorization: Bearer <token>
```

**Resposta:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "clockIn": "2026-03-11T08:00:00.000Z",
      "clockOut": "2026-03-11T12:00:00.000Z",
      "duration": { "formatted": "4h 0m 0s", "totalHours": "4.00" },
      ...
    },
    {
      "id": "uuid",
      "clockIn": "2026-03-11T13:00:00.000Z",
      "clockOut": "2026-03-11T18:00:00.000Z",
      "duration": { "formatted": "5h 0m 0s", "totalHours": "5.00" },
      ...
    }
  ],
  "summary": {
    "totalEntries": 2,
    "totalMinutes": 540,
    "totalHours": "9.00",
    "date": "2026-03-11"
  }
}
```

---

### 5. **Histórico Completo** - Meus Registros

```http
GET /api/v1/time/me?page=1&limit=20&status=PENDING&startDate=2026-03-01&endDate=2026-03-31
Authorization: Bearer <token>
```

**Query Parameters:**
- `page` (opcional, padrão: 1): Página atual
- `limit` (opcional, padrão: 20): Registros por página
- `status` (opcional): Filtrar por status (PENDING, APPROVED, REJECTED)
- `startDate` (opcional): Data inicial (ISO 8601)
- `endDate` (opcional): Data final (ISO 8601)

**Resposta:**
```json
{
  "entries": [
    {
      "id": "uuid",
      "userId": "uuid",
      "clockIn": "2026-03-11T08:00:00.000Z",
      "clockOut": "2026-03-11T17:00:00.000Z",
      "notes": "Trabalho normal",
      "status": "PENDING",
      "duration": { "formatted": "9h 0m 0s", "totalHours": "9.00" },
      "logs": [
        {
          "id": "uuid",
          "action": "APPROVED",
          "comment": "Aprovado",
          "timestamp": "2026-03-12T10:00:00.000Z",
          "reviewer": {
            "id": "uuid",
            "name": "Supervisor",
            "email": "supervisor@empresa.com",
            "role": "SUPERVISOR"
          }
        }
      ]
    }
  ],
  "pagination": {
    "total": 50,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  },
  "stats": {
    "total": 50,
    "pending": 10,
    "approved": 35,
    "rejected": 5
  }
}
```

---

### 6. **Detalhes de um Registro**

```http
GET /api/v1/time/:id
Authorization: Bearer <token>
```

**Resposta:**
```json
{
  "entry": {
    "id": "uuid",
    "userId": "uuid",
    "clockIn": "2026-03-11T08:00:00.000Z",
    "clockOut": "2026-03-11T17:00:00.000Z",
    "notes": "Trabalho normal",
    "ipAddress": "192.168.1.1",
    "device": "Desktop - Chrome on Windows",
    "location": { "lat": -23.5505, "lng": -46.6333 },
    "status": "APPROVED",
    "duration": { "formatted": "9h 0m 0s", "totalHours": "9.00" },
    "user": { ... },
    "logs": [ ... ]
  }
}
```

---

## 📊 Fluxo Típico de Uso

### 1. Iniciar Expediente
```bash
# Verificar se já há ponto aberto
GET /api/v1/time/current

# Se não houver, fazer clock-in
POST /api/v1/time/clock-in
{
  "notes": "Início do expediente",
  "latitude": -23.5505,
  "longitude": -46.6333
}
```

### 2. Verificar Status Durante o Dia
```bash
# Ver quanto tempo já trabalhou
GET /api/v1/time/current

# Ver todos os registros de hoje
GET /api/v1/time/today
```

### 3. Encerrar Expediente
```bash
# Fazer clock-out
POST /api/v1/time/clock-out
{
  "notes": "Fim do expediente"
}
```

### 4. Consultar Histórico
```bash
# Ver últimos registros
GET /api/v1/time/me?page=1&limit=10

# Ver registros pendentes de aprovação
GET /api/v1/time/me?status=PENDING

# Ver registros de um mês específico
GET /api/v1/time/me?startDate=2026-03-01&endDate=2026-03-31
```

---

## 🔍 Exemplos com cURL

### Clock In:
```bash
curl -X POST http://localhost:3000/api/v1/time/clock-in \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Início do trabalho",
    "latitude": -23.5505,
    "longitude": -46.6333
  }'
```

### Clock Out:
```bash
curl -X POST http://localhost:3000/api/v1/time/clock-out \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Fim do trabalho"}'
```

### Ver Histórico:
```bash
curl -X GET "http://localhost:3000/api/v1/time/me?page=1&limit=20" \
  -H "Authorization: Bearer SEU_TOKEN"
```

---

## 🔒 Controle de Acesso

- **MEMBER**: Pode registrar seus próprios pontos e ver seu histórico
- **SUPERVISOR**: Pode ver registros de seus subordinados (implementado na Fase 5)
- **ADMIN**: Pode ver todos os registros

---

## 📝 Notas Importantes

1. **Validação de Ponto Aberto**: O sistema valida se já existe um clock-in sem clock-out antes de permitir novo registro
2. **Captura Automática**: IP, User-Agent e device info são capturados automaticamente
3. **Geolocalização**: Latitude/longitude são opcionais e devem ser enviadas pelo frontend
4. **Status**: Todos os registros começam com status "PENDING" e precisam ser aprovados por supervisor/admin
5. **Duração**: É calculada automaticamente quando existe clock-out

---

## ⚡ Performance

- Índices criados em `userId`, `status`, `clockIn` para queries otimizadas
- Paginação implementada em todos os endpoints de listagem
- Queries otimizadas com `include` apenas dos dados necessários
