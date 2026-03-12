# 🚀 Guia de Setup Inicial - Sistema de Ponto

## Problema 1: Banco de Dados Vazio no DBeaver

### ✅ Solução

As tabelas já foram criadas! Para visualizar no DBeaver:

### 1. **Configurar Conexão no DBeaver:**

```
Host: localhost
Port: 5432
Database: sistema_ponto
Username: postgres
Password: postgres
```

### 2. **Verificar Tabelas Criadas:**

Após conectar, você deve ver estas tabelas:
- `User` - Usuários do sistema
- `TimeEntry` - Registros de ponto
- `ApprovalLog` - Histórico de aprovações
- `_prisma_migrations` - Controle de migrations

### 3. **Atualizar Visualização:**

- Clique com botão direito na conexão
- Selecione "Refresh" ou pressione F5

---

## Problema 2: Token Expirado do Supabase

### 🔑 Como Obter um Novo Token

O token JWT do Supabase expira após **1 hora**. Use nosso helper script para gerenciar tokens facilmente.

### **Opção 1: Usando o Helper Script (Recomendado) ⭐**

#### 🔐 **Fazer Login:**
```bash
node scripts/get-token.js admin@empresa.com admin123456
```

Este comando:
- ✅ Autentica no Supabase automaticamente
- ✅ Salva o token em `.token.json`
- ✅ Exibe informações formatadas (token, expiração, exemplos)
- ✅ Pronto para copiar e usar!

#### 🔄 **Renovar Token Expirado:**
```bash
node scripts/get-token.js refresh
```

Este comando:
- ✅ Lê o `refresh_token` salvo
- ✅ Solicita novo token ao Supabase
- ✅ Atualiza o arquivo `.token.json`

#### 📋 **Ver Token Atual:**
```bash
node scripts/get-token.js show
```

Este comando:
- ✅ Mostra o token salvo
- ✅ Indica se está expirado
- ✅ Fornece exemplos de uso

---

### **Opção 2: Usando o Painel do Supabase (Para criar novos usuários)**

1. Acesse: https://supabase.com/dashboard
2. Vá em **Authentication** → **Users**
3. Clique em **Add user** → **Create new user**
4. Preencha:
   - Email: `admin@empresa.com`
   - Password: `admin123456` (ou sua senha)
   - Auto Confirm User: **SIM** ✅

### **Opção 3: Criar Usuário Programaticamente**

Use o script existente:

```bash
node scripts/create-supabase-users.js
```

Este script cria automaticamente todos os usuários de desenvolvimento.

### **Opção 4: Fazer Login Manualmente via API**

Faça login via API do Supabase:

```bash
curl -X POST 'https://tgvbgwfvwwtxfhwjzwka.supabase.co/auth/v1/token?grant_type=password' \
  -H "apikey: SUA_SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@empresa.com",
    "password": "admin123456"
  }'
```

A resposta incluirá o `access_token` que você usará nas requisições.

---

## 🌱 Popular o Banco de Dados

### Passo 1: Criar Usuários no Supabase

Crie os seguintes usuários no painel do Supabase:

1. **Admin**
   - Email: `admin@empresa.com`
   - Password: `admin123`

2. **Supervisor**
   - Email: `supervisor1@empresa.com`
   - Password: `super123`

3. **Colaborador**
   - Email: `colaborador1@empresa.com`
   - Password: `colab123`

### Passo 2: Copiar IDs dos Usuários

1. No Supabase, vá em **Authentication** → **Users**
2. Copie o **ID** (UUID) de cada usuário criado
3. Exemplo: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

### Passo 3: Atualizar o Seed

Edite o arquivo `prisma/seed.js` e substitua os IDs de exemplo pelos IDs reais:

```javascript
const users = [
  {
    id: 'ID_REAL_DO_ADMIN_AQUI', // Cole o ID do Supabase
    email: 'admin@empresa.com',
    name: 'Administrador',
    role: 'ADMIN',
    supervisorId: null,
  },
  // ... outros usuários
];
```

### Passo 4: Executar o Seed

```bash
npm run prisma:seed
```

---

## 🧪 Testar o Sistema

### 1. **Fazer Login no Supabase**

```bash
curl -X POST 'https://tgvbgwfvwwtxfhwjzwka.supabase.co/auth/v1/token?grant_type=password' \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@empresa.com",
    "password": "admin123"
  }'
```

Copie o `access_token` da resposta.

### 2. **Iniciar o Servidor**

```bash
npm run dev
```

### 3. **Testar Endpoints**

**Verificar autenticação:**
```bash
curl -X GET http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer SEU_TOKEN_AQUI"
```

**Criar um usuário (Admin only):**
```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer SEU_TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "novo@empresa.com",
    "name": "Novo Usuário",
    "password": "senha123",
    "role": "MEMBER"
  }'
```

**Fazer Clock-in:**
```bash
curl -X POST http://localhost:3000/api/v1/time/clock-in \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Iniciando trabalho"
  }'
```

---

## 🔧 Comandos Úteis

### Docker
```bash
# Iniciar containers
docker-compose up -d

# Ver status
docker-compose ps

# Ver logs
docker-compose logs -f

# Parar containers
docker-compose down
```

### Prisma
```bash
# Executar migrations
npm run prisma:migrate

# Gerar Prisma Client
npm run prisma:generate

# Abrir Prisma Studio (GUI)
npm run prisma:studio

# Popular banco de dados
npm run prisma:seed
```

### Aplicação
```bash
# Desenvolvimento
npm run dev

# Produção
npm start

# Lint
npm run lint
npm run lint:fix

# Format
npm run format
```

---

## 📋 Checklist de Setup

- [x] PostgreSQL rodando no Docker
- [x] Redis rodando no Docker
- [x] Migrations executadas
- [ ] Usuários criados no Supabase
- [ ] IDs copiados para o seed.js
- [ ] Seed executado
- [ ] Servidor iniciado
- [ ] Token obtido via login
- [ ] Endpoints testados

---

## ❓ Problemas Comuns

### "Token expirado"
**Solução:** Use o helper script para renovar:
```bash
# Opção 1: Renovar token existente
node scripts/get-token.js refresh

# Opção 2: Fazer novo login
node scripts/get-token.js admin@empresa.com admin123456
```

### "Usuário não cadastrado no sistema"
**Solução:** Crie o usuário no banco local usando a API de admin ou execute o seed:
```bash
npm run prisma:seed
```

### "Cannot connect to database"
**Solução:** Verifique se o Docker está rodando:
```bash
docker-compose ps
# Se não estiver rodando:
docker-compose up -d
```

### "Tabelas não aparecem no DBeaver"
**Solução:** Refresh a conexão ou reconecte.

### "Port 5432 already in use"
**Solução:** Outro PostgreSQL está rodando. Pare-o ou mude a porta no docker-compose.yml

---

## 📚 Documentação Adicional

- [README.md](README.md) - Visão geral do projeto
- [API_TIME_ENTRIES.md](API_TIME_ENTRIES.md) - Documentação da API de registros
- [TESTING_AUTH.md](TESTING_AUTH.md) - Como testar autenticação
- [IMPROVEMENTS.md](IMPROVEMENTS.md) - Melhorias implementadas

---

## 🆘 Suporte

Se continuar com problemas:

1. Verifique os logs: `docker-compose logs -f`
2. Verifique o .env está configurado corretamente
3. Tente reiniciar os containers: `docker-compose restart`
4. Verifique se as portas estão livres: 5432 (PostgreSQL), 6379 (Redis), 3000 (API)
