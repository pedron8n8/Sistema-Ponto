# 🛠️ Scripts Utilitários

Scripts auxiliares para gerenciar o sistema durante o desenvolvimento.

---

## 📝 Lista de Scripts

### 1. **get-token.js** - Gerenciamento de Tokens JWT

Script para facilitar o login e renovação de tokens do Supabase.

#### **Comandos:**

##### 🔐 **Login (obter novo token):**
```bash
node scripts/get-token.js <email> <senha>
```

**Exemplo:**
```bash
node scripts/get-token.js admin@empresa.com admin123456
```

**O que faz:**
- ✅ Autentica no Supabase
- ✅ Salva o token em `.token.json`
- ✅ Exibe informações formatadas (access_token, refresh_token, expira em)
- ✅ Mostra exemplos de uso com curl

---

##### 🔄 **Refresh (renovar token expirado):**
```bash
node scripts/get-token.js refresh
```

**O que faz:**
- ✅ Lê o `refresh_token` salvo em `.token.json`
- ✅ Solicita novo `access_token` ao Supabase
- ✅ Atualiza o arquivo `.token.json`
- ✅ Exibe o novo token

---

##### 📋 **Show (ver token atual):**
```bash
node scripts/get-token.js show
```

**O que faz:**
- ✅ Exibe o token salvo
- ✅ Mostra tempo de expiração
- ✅ Indica se o token está expirado
- ✅ Fornece exemplos de uso

---

### 2. **create-supabase-users.js** - Criação de Usuários no Supabase

Script para criar automaticamente todos os usuários de desenvolvimento no Supabase.

#### **Comando:**
```bash
node scripts/create-supabase-users.js
```

**O que faz:**
- ✅ Cria 5 usuários no Supabase (1 admin, 2 supervisores, 2 colaboradores)
- ✅ Exibe os IDs gerados para cada usuário
- ✅ Confirma emails automaticamente

**Usuários criados:**
- `admin@empresa.com` (ADMIN)
- `supervisor1@empresa.com` (SUPERVISOR)
- `supervisor2@empresa.com` (SUPERVISOR)
- `colaborador1@empresa.com` (MEMBER)
- `colaborador2@empresa.com` (MEMBER)

---

## 📂 Arquivo .token.json

O script `get-token.js` salva os tokens em `.token.json`:

```json
{
  "access_token": "eyJhbGciOiJFUzI1NiIs...",
  "refresh_token": "vb2g24iyp4kp...",
  "expires_at": "2025-01-15T15:30:00.000Z",
  "user": {
    "id": "70fd1122-4764-4f55-8be9-018801c4d1ce",
    "email": "admin@empresa.com"
  }
}
```

⚠️ **Este arquivo está no `.gitignore` e NÃO deve ser commitado!**

---

## 🔒 Segurança

- **NUNCA** commite o arquivo `.token.json`
- **NUNCA** compartilhe seus tokens
- Tokens expiram após **1 hora** (3600 segundos)
- Refresh tokens são válidos por **30 dias**
- Use apenas em ambiente de desenvolvimento local

---

## 🆘 Problemas Comuns

### "Token expirado"
**Solução:** Use o comando refresh:
```bash
node scripts/get-token.js refresh
```

### "Nenhum token salvo"
**Solução:** Faça login primeiro:
```bash
node scripts/get-token.js admin@empresa.com admin123456
```

### "Invalid refresh token"
**Solução:** O refresh token também expirou (30 dias). Faça login novamente:
```bash
node scripts/get-token.js admin@empresa.com admin123456
```

---

## 📚 Mais Informações

Para mais detalhes sobre credenciais e configuração, consulte:
- [CREDENTIALS.md](../CREDENTIALS.md) - Lista completa de credenciais
- [SETUP_GUIDE.md](../SETUP_GUIDE.md) - Guia de configuração do projeto
