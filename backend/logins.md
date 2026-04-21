LOGINS DE TESTE (TODOS OS PLANOS)

Comando para recriar tudo (Supabase + banco local):

npm run reset:seed-logins:all-plans

Senha padrao:

- Teste@123456

Voce pode sobrescrever por ambiente com:

- SEED_DEFAULT_PASSWORD

Tambem pode trocar dominio padrao com:

- SEED_EMAIL_DOMAIN (padrao: empresa.com)

-----------------------------------------------------
STARTER

- ADMIN: starter.admin@empresa.com / Teste@123456
- HR: starter.hr@empresa.com / Teste@123456
- SUPERVISOR: starter.supervisor@empresa.com / Teste@123456
- MEMBER: starter.member@empresa.com / Teste@123456

GROWTH

- ADMIN: growth.admin@empresa.com / Teste@123456
- HR: growth.hr@empresa.com / Teste@123456
- SUPERVISOR: growth.supervisor@empresa.com / Teste@123456
- MEMBER: growth.member@empresa.com / Teste@123456

PRO

- ADMIN: pro.admin@empresa.com / Teste@123456
- HR: pro.hr@empresa.com / Teste@123456
- SUPERVISOR: pro.supervisor@empresa.com / Teste@123456
- MEMBER: pro.member@empresa.com / Teste@123456

SUPERADMIN

- NAO e alterado pelos scripts reset:seed-logins e reset:seed-logins:all-plans
- Configure somente no backend/.env
- Variaveis: SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD, SEED_SUPERADMIN_NAME
- Para criar/atualizar SUPERADMIN manualmente: npm run create:superadmin

-----------------------------------------------------

Overrides opcionais por plano/role:

- SEED_<PLAN_CODE>_<ROLE>_EMAIL
- SEED_<PLAN_CODE>_<ROLE>_PASSWORD
- SEED_<PLAN_CODE>_<ROLE>_NAME

Exemplos:

- SEED_STARTER_ADMIN_EMAIL
- SEED_GROWTH_HR_PASSWORD
- SEED_PRO_MEMBER_NAME
