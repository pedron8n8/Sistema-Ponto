# API Publica PRO - Integracao de Folha

## Objetivo

Permitir que administradores PRO exportem dados de ponto direto para o sistema de folha sem gerar arquivo CSV.

## Requisitos

- Conta ADMIN com plano PRO ativo.
- Token de integracao emitido no painel:
  - `POST /api/v1/admin/pro/public-api/token`
- Header em todas as chamadas publicas:

```http
Authorization: Bearer <token_publico_assinado>
```

## Emissao do Token

```http
POST /api/v1/admin/pro/public-api/token
Authorization: Bearer <token_supabase_admin>
Content-Type: application/json

{
  "expiresInHours": 24,
  "scopes": ["payroll:read"]
}
```

Resposta esperada:

```json
{
  "message": "Token da API publica emitido com sucesso.",
  "token": "<token>",
  "expiresAt": "2026-04-01T13:00:00.000Z",
  "ttlHours": 24,
  "scopes": ["payroll:read"],
  "integration": {
    "basePath": "/api/v1/public/payroll",
    "endpoints": {
      "timeEntries": "/api/v1/public/payroll/time-entries",
      "summary": "/api/v1/public/payroll/summary"
    }
  }
}
```

## Endpoints Publicos

### 1) Time Entries

```http
GET /api/v1/public/payroll/time-entries?startDate=2026-03-01&endDate=2026-03-31&status=APPROVED&page=1&limit=200
Authorization: Bearer <token_publico_assinado>
```

Query params:
- `startDate` e `endDate` obrigatorios (`YYYY-MM-DD`)
- `status` opcional: `PENDING`, `APPROVED`, `REJECTED`
- `includePending=true` opcional (quando `status` nao for informado)
- `userId` opcional (somente se estiver no escopo do admin dono do token)
- `page` opcional (padrao 1)
- `limit` opcional (padrao 100, max 500)

### 2) Summary

```http
GET /api/v1/public/payroll/summary?startDate=2026-03-01&endDate=2026-03-31
Authorization: Bearer <token_publico_assinado>
```

Retorna consolidado diario por colaborador com totais de minutos e valores financeiros.

## Observacoes de Seguranca

- O token e assinado com `PUBLIC_API_HMAC_SECRET`.
- O escopo do token fica restrito ao `organizationAdminId` do ADMIN emissor.
- A API publica valida plano PRO ativo antes de retornar dados.
- Recomenda-se rotacionar token periodicamente via endpoint de emissao.
