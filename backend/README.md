# Sistema de Ponto - Backend

Sistema de controle de ponto eletrônico com aprovação hierárquica e geração de relatórios.

## 🚀 Tecnologias

- **Node.js** + **Express** - Framework web
- **Prisma ORM** - Gerenciamento de banco de dados
- **PostgreSQL** - Banco de dados relacional
- **Redis** + **BullMQ** - Filas de processamento
- **Supabase** - Autenticação e gerenciamento de usuários
- **Docker** - Containerização

## 📋 Pré-requisitos

- Node.js 20+ instalado
- Docker e Docker Compose instalados
- Conta no Supabase (para autenticação)

## 🔧 Instalação

1. **Clone o repositório e instale as dependências:**

```bash
npm install
```

2. **Configure as variáveis de ambiente:**

Copie o arquivo `.env.example` para `.env` e preencha com suas credenciais:

```bash
cp .env.example .env
```

Edite o arquivo `.env` e configure:
- URL e chaves do Supabase
- Credenciais do PostgreSQL (se necessário)
- Senha do Redis (se necessário)

3. **Inicie os serviços com Docker:**

```bash
docker-compose up -d
```

Isso irá iniciar:
- PostgreSQL na porta 5432
- Redis na porta 6379

4. **Execute as migrations do Prisma:**

```bash
npm run prisma:migrate
```

5. **Gere o Prisma Client:**

```bash
npm run prisma:generate
```

## 🎯 Executando o projeto

### Modo desenvolvimento (com hot-reload):

```bash
npm run dev
```

### Modo produção:

```bash
npm start
```

O servidor estará disponível em `http://localhost:3000`

## 🧪 Scripts disponíveis

- `npm run dev` - Inicia o servidor em modo desenvolvimento com nodemon
- `npm start` - Inicia o servidor em modo produção
- `npm run lint` - Executa o ESLint
- `npm run lint:fix` - Corrige problemas do ESLint automaticamente
- `npm run format` - Formata o código com Prettier
- `npm run prisma:generate` - Gera o Prisma Client
- `npm run prisma:migrate` - Executa as migrations do banco de dados
- `npm run prisma:studio` - Abre o Prisma Studio (GUI para o banco)

## 📁 Estrutura do Projeto

```
backend/
├── prisma/
│   └── schema.prisma       # Schema do banco de dados
├── src/
│   ├── config/            # Configurações (Supabase, DB, Redis)
│   ├── controllers/       # Controladores das rotas
│   ├── middlewares/       # Middlewares (auth, validation, etc)
│   ├── routes/           # Definição das rotas
│   ├── services/         # Lógica de negócio
│   ├── utils/            # Utilitários e helpers
│   └── index.js          # Ponto de entrada da aplicação
├── .env                  # Variáveis de ambiente (não commitado)
├── .env.example          # Exemplo de variáveis de ambiente
├── docker-compose.yml    # Configuração do Docker
└── package.json

```

## 🔐 Autenticação

O sistema utiliza Supabase para autenticação. Os tokens JWT são validados nos middlewares antes de acessar rotas protegidas.

## 📊 Banco de Dados

### Modelos principais:

- **User** - Usuários do sistema (Admin, Supervisor, Member)
- **TimeEntry** - Registros de ponto
- **ApprovalLog** - Histórico de aprovações/rejeições

## 🐳 Docker

Para parar os containers:

```bash
docker-compose down
```

Para reiniciar os containers:

```bash
docker-compose restart
```

Para ver os logs:

```bash
docker-compose logs -f
```

## 📝 Próximos Passos

Consulte o arquivo `instruction.md` para ver o roadmap completo do projeto, incluindo as próximas fases de desenvolvimento.

## 🤝 Contribuindo

1. Sempre execute `npm run lint` antes de commitar
2. Use `npm run format` para manter o código formatado
3. Execute as migrations após alterações no schema Prisma
4. Mantenha a documentação atualizada

## 📄 Licença

ISC
