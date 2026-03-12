# 🔑 Credenciais do Sistema

## Usuários Criados

### 👨‍💼 Administrador
- **Email:** admin@empresa.com
- **Senha:** admin123456
- **Role:** ADMIN
- **ID:** 70fd1122-4764-4f55-8be9-018801c4d1ce

### 👔 Supervisor 1
- **Email:** supervisor1@empresa.com
- **Senha:** super123456
- **Role:** SUPERVISOR
- **ID:** 0baa0bc9-6092-422c-a3a6-81d8dfbba261

### 👔 Supervisor 2
- **Email:** supervisor2@empresa.com
- **Senha:** super123456
- **Role:** SUPERVISOR
- **ID:** 2af82c10-3d3b-4ca5-9e42-bff7ddae4ff2

### 👤 Colaborador 1
- **Email:** colaborador1@empresa.com
- **Senha:** colab123456
- **Role:** MEMBER
- **Supervisor:** Supervisor 1
- **ID:** 50d2c9d7-ab40-44ba-8858-e161b1bb929f

### 👤 Colaborador 2
- **Email:** colaborador2@empresa.com
- **Senha:** colab123456
- **Role:** MEMBER
- **Supervisor:** Supervisor 1
- **ID:** 892eced6-7521-4d6d-8b2f-53b788c8341b

---

## 🔐 Como Fazer Login

### Via API (Supabase):
```bash
curl -X POST 'https://tgvbgwfvwwtxfhwjzwka.supabase.co/auth/v1/token?grant_type=password' \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRndmJnd2Z2d3d0eGZod2p6d2thIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTY2NTQsImV4cCI6MjA4ODgzMjY1NH0.G7wiFxrziYSMWpw0sF_VFQ7ymt4XY2g3ITeX7acNg98" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@empresa.com",
    "password": "admin123456"
  }'
```

A resposta incluirá o `access_token` que você usará nas requisições.

### Exemplo de Resposta:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "user": {
    "id": "70fd1122-4764-4f55-8be9-018801c4d1ce",
    "email": "admin@empresa.com"
  }
}
```

---

## 🔧 **Helper Script - Gerenciamento de Tokens**

Para facilitar o gerenciamento de tokens durante o desenvolvimento, use o script `get-token.js`:

### 1️⃣ **Fazer Login e Obter Token:**
```bash
node scripts/get-token.js admin@empresa.com admin123456
```

Este comando:
- ✅ Autentica no Supabase
- ✅ Salva o token em `.token.json`
- ✅ Exibe informações formatadas (access_token, refresh_token, expira em)
- ✅ Mostra exemplos de curl para usar o token

### 2️⃣ **Renovar Token Expirado:**
```bash
node scripts/get-token.js refresh
```

Este comando:
- ✅ Lê o `refresh_token` salvo em `.token.json`
- ✅ Solicita novo `access_token` ao Supabase
- ✅ Atualiza o arquivo `.token.json`
- ✅ Exibe o novo token

### 3️⃣ **Ver Token Atual:**
```bash
node scripts/get-token.js show
```

Este comando:
- ✅ Exibe o token salvo
- ✅ Mostra tempo de expiração
- ✅ Indica se o token está expirado
- ✅ Fornece exemplos de uso

### 📝 **Arquivo .token.json**
O script salva automaticamente os tokens em `.token.json`:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "v1.MRhAdJGGLYiHcw...",
  "expires_at": "2025-01-15T15:30:00.000Z",
  "user": {
    "id": "70fd1122-4764-4f55-8be9-018801c4d1ce",
    "email": "admin@empresa.com"
  }
}
```

⚠️ **Este arquivo está no `.gitignore` e NÃO deve ser commitado!**

---

## 🧪 Testando o Sistema

### 1. Iniciar o servidor:
```bash
npm run dev
```

### 2. Fazer login e obter token:
```bash
# Salve este comando em login.sh (ou execute diretamente)
TOKEN=$(curl -s -X POST 'https://tgvbgwfvwwtxfhwjzwka.supabase.co/auth/v1/token?grant_type=password' \
  -H "apikey: SUA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@empresa.com","password":"admin123456"}' | jq -r .access_token)

echo $TOKEN
```

### 3. Testar endpoint protegido:
```bash
curl -X GET http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Criar novo usuário (Admin only):
```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "novousuario@empresa.com",
    "name": "Novo Usuário",
    "password": "senha123456",
    "role": "MEMBER",
    "supervisorId": "0baa0bc9-6092-422c-a3a6-81d8dfbba261"
  }'
```

### 5. Fazer Clock-in:
```bash
curl -X POST http://localhost:3000/api/v1/time/clock-in \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Iniciando trabalho",
    "latitude": -23.5505,
    "longitude": -46.6333
  }'
```

---

## 📊 Dados de Exemplo

O banco já foi populado com:
- **5 usuários** (1 admin, 2 supervisores, 2 colaboradores)
- **3 registros de ponto** do Colaborador 1
- **1 aprovação** feita pelo Supervisor 1

Você pode visualizar estes dados:
- No DBeaver (conecte em `localhost:5432`)
- No Prisma Studio: `npm run prisma:studio`
- Via API: `GET /api/v1/time/me`

---

## ⚠️ Segurança

**IMPORTANTE:** Estas são credenciais de DESENVOLVIMENTO. Em produção:
1. Use senhas fortes e únicas
2. Não commite este arquivo no Git
3. Use variáveis de ambiente para credenciais
4. Habilite 2FA no Supabase
5. Implemente rate limiting
6. Use HTTPS

---

## 🔄 Renovar Token Expirado

Os tokens têm validade de 1 hora. Para renovar:

```bash
# Se você salvou o refresh_token
curl -X POST 'https://tgvbgwfvwwtxfhwjzwka.supabase.co/auth/v1/token?grant_type=refresh_token' \
  -H "apikey: SUA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "SEU_REFRESH_TOKEN"}'
```

Ou simplesmente faça login novamente.

---

## 📝 Notas

- Tokens expiram após 1 hora
- Refresh tokens são válidos por 30 dias
- Senhas devem ter no mínimo 6 caracteres
- Admin pode criar/editar/deletar qualquer usuário
- Supervisor pode ver apenas seus subordinados
- Member pode ver apenas seus próprios dados
