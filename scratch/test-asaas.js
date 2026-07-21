const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const http = require('http');
const asaasService = require('../asaasService');
const db = require('../db');

async function runAsaasIntegrationTests() {
  console.log('================================================================');
  console.log('🧪 INICIANDO TESTES DE INTEGRAÇÃO DA API ASAAS (SANDBOX)');
  console.log('================================================================\n');

  const testEmail = `perito.teste.${Date.now()}@exemplo.com`;
  const testCpf = '12345678909';
  const testName = 'Perito Judicial Teste Integration';
  const testPhone = '11999998888';

  // TESTE 1: Conexão REST direta com a API do Asaas (Criar Cliente)
  console.log('[TESTE 1] Testando criação/busca de cliente na API Asaas Sandbox...');
  try {
    const customer = await asaasService.createOrGetCustomer({
      name: testName,
      email: testEmail,
      cpfCnpj: testCpf,
      phone: testPhone
    });
    
    if (customer && customer.id) {
      console.log(`✅ Sucesso! Cliente gerado no Asaas Sandbox com ID: ${customer.id}`);
    } else {
      throw new Error('Retorno inválido da API do Asaas.');
    }

    // TESTE 2: Criação de Assinatura Recorrente no Asaas (Plano Anual R$ 399,20)
    console.log('\n[TESTE 2] Testando criação de Assinatura Recorrente (Plano Anual R$ 399,20)...');
    const subscription = await asaasService.createSubscription({
      customerId: customer.id,
      plan: 'annual',
      billingType: 'UNDEFINED'
    });

    if (subscription && subscription.subscriptionId) {
      console.log(`✅ Sucesso! Assinatura criada no Asaas com ID: ${subscription.subscriptionId} (Valor: R$ ${subscription.value})`);
    } else {
      throw new Error('Falha ao criar assinatura no Asaas.');
    }

    // TESTE 3: Disparo do Webhook de confirmação de pagamento
    console.log('\n[TESTE 3] Simulando recebimento de Webhook do Asaas (PAYMENT_RECEIVED)...');
    const webhookPayload = JSON.stringify({
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: `pay_${Date.now()}`,
        customer: customer.id,
        customerEmail: testEmail,
        customerName: testName,
        cpfCnpj: testCpf,
        value: 399.20
      }
    });

    const webhookOptions = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/payment/asaas-webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(webhookPayload)
      }
    };

    const webhookRes = await new Promise((resolve, reject) => {
      const req = http.request(webhookOptions, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
      });
      req.on('error', reject);
      req.write(webhookPayload);
      req.end();
    });

    if (webhookRes.status === 200 && webhookRes.data.received) {
      console.log(`✅ Sucesso! Webhook do Asaas recebido e processado com sucesso!`);
    } else {
      throw new Error(`Falha no webhook: status ${webhookRes.status}`);
    }

    // TESTE 4: Verificar se a conta do usuário foi criada com a senha temporária = CPF
    console.log('\n[TESTE 4] Verificando se a conta do usuário foi criada automaticamente com senha = CPF...');
    const userInDb = await db.findUserByEmail(testEmail);
    if (userInDb && userInDb.subscriptionActive && userInDb.mustChangePassword) {
      console.log(`✅ Sucesso! Usuário encontrado no banco:`);
      console.log(`   • E-mail: ${userInDb.email}`);
      console.log(`   • Senha Temporária (CPF): ${userInDb.plainPassword}`);
      console.log(`   • Assinatura Ativa: ${userInDb.subscriptionActive}`);
      console.log(`   • Troca Obrigatória de Senha: ${userInDb.mustChangePassword}`);
    } else {
      throw new Error('Usuário não foi criado corretamente via webhook.');
    }

    console.log('\n================================================================');
    console.log('🎉 TODOS OS TESTES DE INTEGRAÇÃO DA API ASAAS PASSARAM COM SUCESSO!');
    console.log('================================================================');

  } catch (err) {
    console.error('\n❌ ERRO NO TESTE DE INTEGRAÇÃO:', err.message);
    process.exit(1);
  }
}

runAsaasIntegrationTests();
