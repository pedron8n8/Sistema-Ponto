const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function getToken() {
  console.log('🔐 Fazendo login no Supabase...\n');

  const email = process.argv[2] || process.env.TEST_LOGIN_EMAIL;
  const password = process.argv[3] || process.env.TEST_LOGIN_PASSWORD;

  if (!email || !password) {
    console.error('❌ Informe email e senha via argumentos ou variáveis de ambiente.');
    console.log('Exemplo: node get-token.js usuario@empresa.com senha123');
    console.log('Ou defina TEST_LOGIN_EMAIL e TEST_LOGIN_PASSWORD no ambiente.');
    process.exitCode = 1;
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error('❌ Erro no login:', error.message);
    console.log('\n💡 Dica: Verifique se o usuário existe no Supabase Dashboard');
    return;
  }

  console.log('✅ Login realizado com sucesso!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 TOKEN DE ACESSO (copie tudo abaixo):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(data.session.access_token);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('📊 Informações do usuário:');
  console.log('  - ID:', data.user.id);
  console.log('  - Email:', data.user.email);
  console.log('  - Expira em:', new Date(data.session.expires_at * 1000).toLocaleString('pt-BR'));
  
  console.log('\n🧪 Exemplo de uso com cURL:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`curl -H "Authorization: Bearer ${data.session.access_token}" http://localhost:3000/api/v1/auth/me`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

getToken().catch(console.error);
