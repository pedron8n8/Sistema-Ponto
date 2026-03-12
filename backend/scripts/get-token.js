const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/**
 * Script para fazer login e obter um novo token
 */

async function login(email, password) {
  try {
    console.log(`🔐 Fazendo login com: ${email}...\n`);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('❌ Erro ao fazer login:', error.message);
      return null;
    }

    console.log('✅ Login realizado com sucesso!\n');
    console.log('📋 Informações da sessão:');
    console.log('─────────────────────────────────────────────────────');
    console.log(`👤 Usuário: ${data.user.email}`);
    console.log(`🆔 ID: ${data.user.id}`);
    console.log(`🔑 Access Token: ${data.session.access_token.substring(0, 50)}...`);
    console.log(`🔄 Refresh Token: ${data.session.refresh_token.substring(0, 50)}...`);
    console.log(`⏰ Expira em: ${data.session.expires_in} segundos (${Math.floor(data.session.expires_in / 60)} minutos)`);
    console.log(`📅 Expira às: ${new Date(data.session.expires_at * 1000).toLocaleString('pt-BR')}`);
    console.log('─────────────────────────────────────────────────────\n');

    console.log('💾 Token completo (copie e use nas requisições):\n');
    console.log(data.session.access_token);
    console.log('\n');

    console.log('📝 Exemplo de uso:');
    console.log('─────────────────────────────────────────────────────');
    console.log(`curl http://localhost:3000/api/v1/auth/me \\`);
    console.log(`  -H "Authorization: Bearer ${data.session.access_token.substring(0, 30)}..."`);
    console.log('─────────────────────────────────────────────────────\n');

    // Salvar em arquivo .token para facilitar
    const fs = require('fs');
    const tokenData = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: data.user.user_metadata?.role,
      },
    };

    fs.writeFileSync('.token.json', JSON.stringify(tokenData, null, 2));
    console.log('💾 Token salvo em .token.json\n');

    return data;
  } catch (error) {
    console.error('❌ Erro inesperado:', error.message);
    return null;
  }
}

async function refreshToken(refreshToken) {
  try {
    console.log('🔄 Renovando token...\n');

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) {
      console.error('❌ Erro ao renovar token:', error.message);
      return null;
    }

    console.log('✅ Token renovado com sucesso!\n');
    console.log('🔑 Novo Access Token:');
    console.log(data.session.access_token);
    console.log('\n');

    // Atualizar arquivo
    const fs = require('fs');
    const tokenData = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: data.user.user_metadata?.role,
      },
    };

    fs.writeFileSync('.token.json', JSON.stringify(tokenData, null, 2));
    console.log('💾 Token atualizado em .token.json\n');

    return data;
  } catch (error) {
    console.error('❌ Erro inesperado:', error.message);
    return null;
  }
}

// Processa argumentos da linha de comando
const args = process.argv.slice(2);
const command = args[0];

if (command === 'refresh') {
  // Renovar token existente
  const fs = require('fs');
  try {
    const tokenFile = fs.readFileSync('.token.json', 'utf8');
    const tokenData = JSON.parse(tokenFile);
    refreshToken(tokenData.refresh_token);
  } catch (error) {
    console.error('❌ Erro ao ler .token.json. Faça login primeiro.');
  }
} else if (command === 'show') {
  // Mostrar token atual
  const fs = require('fs');
  try {
    const tokenFile = fs.readFileSync('.token.json', 'utf8');
    const tokenData = JSON.parse(tokenFile);
    const expiresAt = new Date(tokenData.expires_at * 1000);
    const now = new Date();
    const isExpired = expiresAt < now;

    console.log('📋 Token atual:');
    console.log('─────────────────────────────────────────────────────');
    console.log(`👤 Usuário: ${tokenData.user.email} (${tokenData.user.role || 'N/A'})`);
    console.log(`🆔 ID: ${tokenData.user.id}`);
    console.log(`📅 Expira em: ${expiresAt.toLocaleString('pt-BR')}`);
    console.log(`⏰ Status: ${isExpired ? '❌ EXPIRADO' : '✅ VÁLIDO'}`);
    console.log('─────────────────────────────────────────────────────\n');

    if (isExpired) {
      console.log('⚠️  Token expirado! Execute: node scripts/get-token.js refresh\n');
    } else {
      console.log('🔑 Access Token:\n');
      console.log(tokenData.access_token);
      console.log('\n');
    }
  } catch (error) {
    console.error('❌ Nenhum token salvo. Faça login primeiro.');
  }
} else {
  // Login com email e senha
  const email = args[0] || 'admin@empresa.com';
  const password = args[1] || 'admin123456';

  login(email, password);
}
