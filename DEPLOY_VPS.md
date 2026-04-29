# Deploy na VPS

Este projeto agora usa dois containers:

- `backend`, que aponta para o Postgres e o Redis já existentes na VPS e sobe na porta 3001 para evitar conflito com a 3000.
- `frontend`, que serve o build estático e faz proxy de `/api/v1` e `/uploads` para o backend.

## Arquivos de ambiente

1. Copie `.env.example` da raiz para `.env` e preencha os dados de backend e frontend: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `PORT` (3001), `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e os links opcionais de Stripe.
2. O `docker-compose.yml` raiz usa esse `.env` tanto para o runtime do backend quanto para os argumentos de build do frontend.

## Subir em produção

Na raiz do repositório:

```bash
docker compose up -d --build
```

## Observações

- O arquivo `backend/docker-compose.yml` foi deixado apenas para subir o backend isoladamente.
- Nenhum compose deste projeto cria Postgres ou Redis locais.