# Testando Autenticação e Middlewares

Este documento mostra como testar os middlewares de autenticação implementados.

## Endpoints Disponíveis

### 1. Health Check (sem autenticação)
```bash
GET /health
GET /api/v1/health
```

### 2. Perfil do Usuário Autenticado
```bash
GET /api/v1/auth/me
Authorization: Bearer <seu_token_supabase>
```

### 3. Perfil Completo
```bash
GET /api/v1/auth/profile
Authorization: Bearer <seu_token_supabase>
```

### 4. Rota Protegida (requer autenticação)
```bash
GET /api/v1/protected
Authorization: Bearer <seu_token_supabase>
```

### 5. Rota Administrativo (requer ADMIN)
```bash
GET /api/v1/admin-only
Authorization: Bearer <seu_token_supabase>
```

### 6. Rota Supervisor (requer ADMIN ou SUPERVISOR)
```bash
GET /api/v1/supervisor-access
Authorization: Bearer <seu_token_supabase>
```

## Exemplos com cURL

### Testar rota pública:
```bash
curl http://localhost:3000/api/v1/health
```

### Testar rota autenticada:
```bash
curl -H "Authorization: Bearer SEU_TOKEN_AQUI" \
     http://localhost:3000/api/v1/auth/me
```

### Testar rota com role específica:
```bash
curl -H "Authorization: Bearer SEU_TOKEN_AQUI" \
     http://localhost:3000/api/v1/admin-only
```

## Exemplos com JavaScript (Fetch)

### Obter perfil do usuário:
```javascript
const token = 'seu_token_supabase_aqui';

fetch('http://localhost:3000/api/v1/auth/me', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
  .then(res => res.json())
  .then(data => console.log(data));
```

## Respostas Esperadas

### Sucesso (200):
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "MEMBER",
    "supervisor": null,
    "createdAt": "2026-03-11T20:00:00.000Z"
  }
}
```

### Não autenticado (401):
```json
{
  "error": "Unauthorized",
  "message": "Token de autenticação não fornecido"
}
```

### Sem permissão (403):
```json
{
  "error": "Forbidden",
  "message": "Acesso negado. Requer uma das seguintes permissões: ADMIN",
  "requiredRoles": ["ADMIN"],
  "userRole": "MEMBER"
}
```

## Como obter um token do Supabase

1. Faça login no seu app usando o Supabase Auth
2. Obtenha o token com:
```javascript
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;
```

## Testando com Postman/Insomnia

1. Crie uma nova requisição
2. Método: GET
3. URL: `http://localhost:3000/api/v1/auth/me`
4. Headers:
   - Key: `Authorization`
   - Value: `Bearer seu_token_aqui`
5. Envie a requisição
