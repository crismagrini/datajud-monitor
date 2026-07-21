const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Carregar variáveis de ambiente de um arquivo .env se ele existir (zero dependências adicionais)
if (fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const parts = line.split('=');
    if (parts.length > 1) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key && !key.startsWith('#')) {
        process.env[key] = val.replace(/(^["']|["']$)/g, ''); // remove aspas se existirem
      }
    }
  });
}

const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-monitor-datajud-12345';

// Middleware para validar token JWT nas rotas protegidas
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Faça login para continuar.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const dbUser = await db.findUserByEmail(payload.email);
    if (!dbUser) {
      return res.status(404).json({ error: 'Usuário não localizado.' });
    }
    
    // Inibe acesso a recursos se a conta estiver banida na blacklist
    const isBanned = await db.isEmailBlacklisted(dbUser.email);
    if (isBanned) {
      return res.status(403).json({ error: 'CONTA_BANIDA', message: 'Sua conta foi banida do sistema pelo administrador.' });
    }

    // Inibe acesso se estiver bloqueado temporariamente
    if (dbUser.blockedUntil) {
      const blockDate = new Date(dbUser.blockedUntil);
      if (blockDate > new Date()) {
        return res.status(403).json({ error: 'CONTA_BLOQUEADA', message: `Acesso temporariamente bloqueado pelo administrador até ${blockDate.toLocaleString('pt-BR')}.` });
      }
    }

    // Validação do Período de Testes (Trial de 7 dias)
    const createdDate = new Date(dbUser.createdAt || new Date());
    const diffTime = Math.abs(new Date() - createdDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > 7) {
      const activeSub = !!dbUser.subscriptionActive;
      const extended = !!dbUser.trialExtended;
      
      if (!activeSub && !extended) {
        return res.status(403).json({ 
          error: 'CONTA_BLOQUEADA_TRIAL', 
          message: 'Seu período de testes de 7 dias expirou. Faça uma assinatura para reabilitar seu acesso ou entre em contato com o suporte.' 
        });
      }
    }

    // Inibe acesso a recursos protegidos se a conta não estiver verificada
    if (dbUser.verified === false && req.path !== '/api/auth/verify-email') {
      return res.status(403).json({ error: 'CONTA_NAO_VERIFICADA', message: 'E-mail pendente de verificação.' });
    }

    req.user = dbUser;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Sua sessão expirou ou o token é inválido.' });
  }
}

const app = express();
// A Hostinger define a porta dinamicamente na variável de ambiente PORT
const PORT = process.env.PORT || 3000;

// Chave pública padrão do CNJ Datajud obtida da documentação oficial
const DEFAULT_API_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

// Chave da API Groq para análise de IA (configurada via variável de ambiente GROQ_API_KEY)
const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, 'public')));

// Rota para a aplicação (painel)
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Rota de Cadastro de Usuário
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, cpf } = req.body;

  if (!email || !password || !name || !cpf) {
    return res.status(400).json({ error: 'E-mail, senha, nome completo e CPF são obrigatórios.' });
  }

  const emailClean = email.trim().toLowerCase();

  try {
    const isBanned = await db.isEmailBlacklisted(emailClean);
    if (isBanned) {
      return res.status(403).json({ error: 'Este e-mail está banido pelo administrador e não pode ser cadastrado.' });
    }

    const existingUser = await db.findUserByEmail(emailClean);
    if (existingUser) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    await db.createUser({
      email: emailClean,
      password: hashedPassword,
      plainPassword: password, // Armazena a senha plana para consulta do desenvolvedor
      name: name.trim(),
      cpf: cpf.trim().replace(/[^0-9]/g, ''),
      verified: false,
      verificationCode: verificationCode,
      createdAt: new Date().toISOString()
    });
    
    console.log(`[Verificação de E-mail] Código gerado para ${emailClean}: ${verificationCode}`);
    res.status(201).json({ 
      message: 'Cadastro realizado com sucesso!',
      _testVerificationCode: verificationCode // Helper para simular recebimento do e-mail no frontend
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha interna ao criar usuário.' });
  }
});

// Rota de Login de Usuário
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
  }

  const emailClean = email.trim().toLowerCase();
  
  try {
    const isBanned = await db.isEmailBlacklisted(emailClean);
    if (isBanned) {
      return res.status(403).json({ error: 'Este e-mail está banido do sistema.' });
    }

    const user = await db.findUserByEmail(emailClean);
    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    if (user.blockedUntil) {
      const blockDate = new Date(user.blockedUntil);
      if (blockDate > new Date()) {
        return res.status(403).json({ 
          error: 'ACESSO_BLOQUEADO', 
          message: `Seu acesso está temporariamente bloqueado pelo administrador até ${blockDate.toLocaleString('pt-BR')}.` 
        });
      }
    }

    // Validação do Período de Testes (Trial de 7 dias)
    const createdDate = new Date(user.createdAt || new Date());
    const diffTime = Math.abs(new Date() - createdDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > 7) {
      const activeSub = !!user.subscriptionActive;
      const extended = !!user.trialExtended;
      
      if (!activeSub && !extended) {
        return res.status(403).json({ 
          error: 'CONTA_BLOQUEADA_TRIAL', 
          message: 'Seu período de testes de 7 dias expirou. Faça uma assinatura para reabilitar seu acesso ou entre em contato com o suporte.' 
        });
      }
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ 
      token, 
      email: user.email, 
      verified: user.verified !== false,
      _testVerificationCode: user.verificationCode
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha interna ao realizar login.' });
  }
});

// Rota para verificar a senha do usuário ativo (para confirmação de exclusão - PROTEGIDA)
app.post('/api/auth/verify-password', authenticateToken, async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'O parâmetro "password" é obrigatório.' });
  }

  try {
    const user = await db.findUserByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não localizado.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    res.json({ valid: isPasswordValid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha interna ao verificar senha.' });
  }
});

// Rota para verificar o código de ativação do e-mail (PROTEGIDA)
app.post('/api/auth/verify-email', authenticateToken, async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'O código de verificação é obrigatório.' });
  }
  
  try {
    const user = await db.findUserByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não localizado.' });
    }
    
    if (user.verificationCode !== code.trim()) {
      return res.status(400).json({ error: 'Código de verificação incorreto.' });
    }
    
    await db.updateUser(req.user.email, { verified: true });
    res.json({ message: 'E-mail verificado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha interna ao verificar e-mail.' });
  }
});

// Rota para exclusão integral da conta e dados (PROTEGIDA)
app.post('/api/auth/delete-account', authenticateToken, async (req, res) => {
  const { password, email } = req.body;
  if (!password || !email) {
    return res.status(400).json({ error: 'Senha e e-mail de confirmação são obrigatórios.' });
  }
  
  const emailClean = email.trim().toLowerCase();
  if (emailClean !== req.user.email) {
    return res.status(400).json({ error: 'O e-mail de confirmação não confere com o usuário logado.' });
  }
  
  try {
    const user = await db.findUserByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não localizado.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Senha incorreta. A deleção foi cancelada.' });
    }
    
    await db.deleteUser(req.user.email);
    
    console.log(`[Segurança] Conta excluída permanentemente: ${emailClean}`);
    res.json({ message: 'Conta e dados excluídos permanentemente.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha interna ao excluir a conta.' });
  }
});

// Rota para buscar as publicações no Radar de Nomeações (PROTEGIDA)
app.get('/api/radar/notifications', authenticateToken, async (req, res) => {
  try {
    // Auto-limpeza: purga os registros antigos fictícios se existirem
    await db.purgeMockRadarItems();

    const userRadar = await db.getRadarForUser(req.user.email);
    res.json(userRadar);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha ao carregar radar de nomeações.' });
  }
});

// Rota para marcar publicação do radar como importada (PROTEGIDA)
app.post('/api/radar/import', authenticateToken, async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'O ID da nomeação é obrigatório.' });
  }

  try {
    await db.markRadarAsImported(id, req.user.email);
    res.json({ message: 'Nomeação marcada como importada.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha ao marcar nomeação como importada.' });
  }
});

// Rota para varrer tribunais no Datajud em busca de nomeações reais do perito (PROTEGIDA)
app.post('/api/radar/scan', authenticateToken, async (req, res) => {
  const user = req.user;
  // Tribunais mais relevantes para nomeação de peritos
  const tribunals = ['tjsp', 'tjrj', 'tjmg', 'tjrs', 'tjpr', 'tjsc', 'tjba', 'tjpe', 'tjce', 'tjdft', 'trf1', 'trf3', 'trf4', 'trt2', 'trt15'];
  const clientApiKey = req.headers['x-api-key'];
  const apiKey = clientApiKey && clientApiKey.trim() !== '' ? clientApiKey : (process.env.DATAJUD_API_KEY || DEFAULT_API_KEY);

  try {
    const existingIds = await db.getExistingRadarIds(user.email);

    async function scanTribunal(tribunal) {
      const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${tribunal}/_search`;
      const query = {
        size: 30,
        query: {
          bool: {
            should: [
              { match: { "partes.nome": user.name } }
            ],
            minimum_should_match: 1
          }
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `APIKey ${apiKey}`
          },
          body: JSON.stringify(query),
          signal: controller.signal
        });

        if (!response.ok) return { tribunal, hits: [] };

        const data = await response.json();
        return { tribunal, hits: data.hits?.hits || [] };
      } catch {
        return { tribunal, hits: [] };
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const results = [];
    for (const tribunal of tribunals) {
      results.push({ status: 'fulfilled', value: await scanTribunal(tribunal) });
    }

    let totalFound = 0;
    const tribunalsWithResults = [];
    const newItems = [];

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;

      const { tribunal, hits } = result.value;

      if (hits.length === 0) continue;
      tribunalsWithResults.push(tribunal.toUpperCase());

      for (const hit of hits) {
        const src = hit._source;
        const movimentos = src.movimentos || [];

        // Procura movimento que contenha "nomea" no nome (nomeação judicial)
        const nomeacaoMov = movimentos.find(m =>
          m.nome && (
            m.nome.toLowerCase().includes('nomea') ||
            m.nome.toLowerCase().includes('perito') ||
            m.nome.toLowerCase().includes('honorário')
          )
        );

        if (!nomeacaoMov) continue;

        const itemId = `radar_${user.email.replace(/[^a-zA-Z0-9]/g, '_')}_${src.numeroProcesso.replace(/[^0-9]/g, '')}`;
        if (existingIds.has(itemId)) continue;

        const complementos = nomeacaoMov.complementosTabelados
          ? nomeacaoMov.complementosTabelados.map(c => `${c.nome}: ${c.valor}`).join('; ')
          : '';

        const trecho = `${nomeacaoMov.nome}${complementos ? ' - ' + complementos : ''}`;

        newItems.push({
          id: itemId,
          userEmail: user.email,
          numeroProcesso: src.numeroProcesso,
          tribunal: tribunal,
          diario: `Diário da Justiça - ${tribunal.toUpperCase()}`,
          dataPublicacao: nomeacaoMov.dataHora ? nomeacaoMov.dataHora.slice(0, 10) : new Date().toISOString().slice(0, 10),
          trecho: trecho,
          honorariosSugeridos: null,
          objetoSugerido: 'Nomeação Judicial',
          linkPublicacao: `https://www.cnj.jus.br/processo/${src.numeroProcesso}`,
          imported: false
        });

        existingIds.add(itemId);
        totalFound++;
      }
    }

    if (newItems.length > 0) {
      await db.insertRadarItems(newItems);
    }

    const userItems = await db.getRadarForUser(user.email);

    res.json({
      found: totalFound,
      tribunalsScanned: tribunals.length,
      tribunalsWithResults: tribunalsWithResults,
      items: userItems,
      lastScan: new Date().toISOString()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha interna ao varrer tribunais no radar.' });
  }
});

// Rota de proxy para consultas à API do Datajud (PROTEGIDA)
app.post('/api/search', authenticateToken, async (req, res) => {
  const { tribunal, query, timeout } = req.body;

  if (!tribunal) {
    return res.status(400).json({ error: 'O parâmetro "tribunal" é obrigatório.' });
  }

  if (!query) {
    return res.status(400).json({ error: 'O parâmetro "query" (Elasticsearch Query DSL) é obrigatório.' });
  }

  // Verifica se o cliente enviou uma API Key personalizada no header
  const clientApiKey = req.headers['x-api-key'];
  const apiKey = clientApiKey && clientApiKey.trim() !== '' ? clientApiKey : (process.env.DATAJUD_API_KEY || DEFAULT_API_KEY);

  const url = `https://api-publica.datajud.cnj.jus.br/api_publica_${tribunal.toLowerCase()}/_search`;

  // Define timeout com base no parâmetro do cliente, padrão de 30 segundos
  const requestTimeout = timeout ? parseInt(timeout) : 30000;

  console.log(`[Proxy] Direcionando busca para o tribunal: ${tribunal.toUpperCase()} (Timeout: ${requestTimeout}ms)`);
  console.log(`[Proxy] Chave utilizada: ${apiKey.substring(0, 8)}...`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `APIKey ${apiKey}`
      },
      body: JSON.stringify(query),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      console.error(`[Proxy] Erro da API CNJ (${response.status}):`, data);
      const statusCode = (response.status === 401 || response.status === 403) ? 502 : response.status;
      return res.status(statusCode).json({
        error: 'Erro retornado pela API do Datajud.',
        details: data
      });
    }

    res.json(data);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`[Proxy] Timeout de ${requestTimeout}ms atingido ao consultar CNJ para tribunal ${tribunal.toUpperCase()}`);
      return res.status(408).json({
        error: 'Tempo limite esgotado ao tentar se comunicar com o Datajud (API pública lenta).',
        details: `O servidor do tribunal demorou mais do que o limite permitido (${requestTimeout / 1000}s) para responder.`
      });
    }
    console.error('[Proxy] Erro de rede ou servidor ao consultar CNJ:', error);
    res.status(500).json({
      error: 'Falha interna ao tentar se comunicar com o Datajud.',
      details: error.message
    });
  }
});

// Rota para análise de processos com IA (Groq) - a chave fica no servidor
app.post('/api/ai/analyze', authenticateToken, async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'O parâmetro "prompt" é obrigatório.' });
  }

  console.log('[AI Proxy] Enviando prompt para Groq. Tamanho:', prompt.length);

  let model = 'llama-3.3-70b-versatile';
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      console.log(`[AI Proxy] Chamando o modelo Groq: ${model} (Tentativa ${attempts}/${maxAttempts})`);
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 1200
        })
      });

      const data = await response.json();

      // Se bater no limite de taxa, tenta fazer fallback se estiver no 70B, senão espera e tenta novamente
      if (response.status === 429) {
        if (model === 'llama-3.3-70b-versatile') {
          console.warn(`[AI Proxy Rate Limit] Limite de tokens atingido para llama-3.3-70b-versatile. Fazendo fallback automático para llama-3.1-8b-instant...`);
          model = 'llama-3.1-8b-instant';
          attempts = 0; // reseta tentativas para o novo modelo
          continue;
        }
        const delaySec = data.error?.message?.match(/in (\d+\.\d+)s/)?.[1] || 7;
        const waitMs = Math.ceil(parseFloat(delaySec) * 1000) + 500;
        console.warn(`[AI Proxy Rate Limit] Limite de tokens atingido. Aguardando ${waitMs}ms para tentar novamente (Tentativa ${attempts}/${maxAttempts})...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        console.error('[AI Proxy] Erro da API Groq:', data);
        if (model === 'llama-3.3-70b-versatile') {
          console.warn(`[AI Proxy Error] Erro com llama-3.3-70b-versatile. Fazendo fallback para llama-3.1-8b-instant...`);
          model = 'llama-3.1-8b-instant';
          attempts = 0;
          continue;
        }
        const statusCode = (response.status === 401 || response.status === 403) ? 502 : response.status;
        return res.status(statusCode).json({
          error: 'Erro retornado pela API Groq. Verifique a variável GROQ_API_KEY no painel do Render.',
          details: data
        });
      }

      return res.json(data);
    } catch (error) {
      console.error('[AI Proxy] Exceção na chamada ao Groq:', error);
      if (model === 'llama-3.3-70b-versatile') {
        console.warn(`[AI Proxy Exception] Exceção com llama-3.3-70b-versatile: ${error.message}. Fazendo fallback automático para llama-3.1-8b-instant...`);
        model = 'llama-3.1-8b-instant';
        attempts = 0;
        continue;
      }
      if (attempts >= maxAttempts) {
        return res.status(500).json({
          error: 'Falha interna ao consultar a API Groq.',
          details: error.message
        });
      }
      console.warn(`[AI Proxy Connection] Falha de conexão. Aguardando 2s para tentar novamente (Tentativa ${attempts}/${maxAttempts})...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  res.status(500).json({ error: 'Falha ao processar a requisição no Groq após várias tentativas.' });
});

// Rota para extração de texto de arquivo PDF usando pdf-parse (stateless - PROTEGIDA)
app.post('/api/parse-pdf', authenticateToken, async (req, res) => {
  const { pdfBase64 } = req.body;

  if (!pdfBase64) {
    return res.status(400).json({ error: 'O parâmetro "pdfBase64" contendo o arquivo em base64 é obrigatório.' });
  }

  try {
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const { PDFParse } = require('pdf-parse');
    
    console.log(`[PDF Parser] Iniciando extração de texto de PDF (Tamanho do buffer: ${pdfBuffer.length} bytes)`);
    
    const parser = new PDFParse({ data: pdfBuffer });
    const data = await parser.getText();
    
    const pdfText = data.text || '';
    const numPages = data.total || 0;

    res.json({
      text: pdfText,
      numPages: numPages
    });
  } catch (error) {
    console.error('[PDF Parser] Falha ao extrair texto do PDF:', error);
    res.status(500).json({
      error: 'Erro ao processar e extrair o texto do arquivo PDF.',
      details: error.message
    });
  }
});

// === MIDDLEWARE E ROTAS DE CONTROLE DO DESENVOLVEDOR (DEV PANEL) ===

const DEV_JWT_SECRET = 'dev-secret-key-datajud-monitor-98765';

async function authenticateDevToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Autenticação de desenvolvedor necessária.' });
  }

  try {
    const payload = jwt.verify(token, DEV_JWT_SECRET);
    if (payload.role !== 'dev') {
      return res.status(403).json({ error: 'Acesso negado. Apenas desenvolvedores autorizados.' });
    }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Sessão de desenvolvedor expirou ou é inválida.' });
  }
}

// 1. Rota de autenticação do Desenvolvedor
app.post('/api/dev/auth', async (req, res) => {
  const { password } = req.body;
  const devPassword = process.env.DEV_PASSWORD || 'Lgintel';

  if (password === devPassword) {
    const token = jwt.sign({ role: 'dev' }, DEV_JWT_SECRET, { expiresIn: '2h' });
    return res.json({ token });
  } else {
    return res.status(401).json({ error: 'Senha de desenvolvedor incorreta.' });
  }
});

// 2. Rota para obter todos os usuários
app.get('/api/dev/users', authenticateDevToken, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    // Remove o hash de senha para segurança extra nas respostas, mas expõe plainPassword e dados básicos
    const sanitized = users.map(u => ({
      email: u.email,
      name: u.name,
      cpf: u.cpf,
      verified: u.verified !== false,
      verificationCode: u.verificationCode,
      plainPassword: u.plainPassword || 'Não registrada',
      blockedUntil: u.blockedUntil || null,
      createdAt: u.createdAt
    }));
    res.json(sanitized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

// 3. Rota para alterar senha de um usuário
app.post('/api/dev/users/update-password', authenticateDevToken, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-mail e nova senha são obrigatórios.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.updateUser(email, { 
      password: hashedPassword, 
      plainPassword: password 
    });
    res.json({ message: 'Senha do usuário atualizada com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar senha.' });
  }
});

// 4. Rota para atualizar bloqueio de acesso por data
app.post('/api/dev/users/update-block', authenticateDevToken, async (req, res) => {
  const { email, blockedUntil } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }

  try {
    await db.updateUser(email, { blockedUntil: blockedUntil || null });
    res.json({ message: 'Bloqueio de acesso atualizado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao configurar bloqueio de data.' });
  }
});

// 4.1 Rota para atualizar a extensão de testes (trial) do usuário
app.post('/api/dev/users/update-trial-extended', authenticateDevToken, async (req, res) => {
  const { email, trialExtended } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }

  try {
    await db.updateUser(email, { trialExtended: !!trialExtended });
    res.json({ message: 'Extensão de testes atualizada com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao configurar extensão de testes.' });
  }
});

// 5. Rota para deletar usuário
app.post('/api/dev/users/delete', authenticateDevToken, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }

  try {
    await db.deleteUser(email);
    res.json({ message: 'Usuário e seus dados de radar excluídos com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar usuário.' });
  }
});

// 6. Rota para obter blacklist
app.get('/api/dev/blacklist', authenticateDevToken, async (req, res) => {
  try {
    const blacklist = await db.getBlacklist();
    res.json(blacklist);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao obter blacklist.' });
  }
});

// 7. Rota para adicionar na blacklist
app.post('/api/dev/blacklist/add', authenticateDevToken, async (req, res) => {
  const { email, reason } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }

  try {
    await db.addToBlacklist(email, reason);
    res.json({ message: 'E-mail banido e adicionado na blacklist!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao banir e-mail.' });
  }
});

// 8. Rota para remover da blacklist
app.post('/api/dev/blacklist/remove', authenticateDevToken, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'E-mail é obrigatório.' });
  }

  try {
    await db.removeFromBlacklist(email);
    res.json({ message: 'E-mail perdoado e removido da blacklist com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao remover da blacklist.' });
  }
});

// === INTEGRAÇÃO STRIPE (PAGAMENTOS & ASSINATURAS) ===
const Stripe = require('stripe');
const stripeKey = process.env.STRIPE_SECRET_KEY;
let stripe = null;
if (stripeKey) {
  stripe = new Stripe(stripeKey);
}

// 1. Rota para iniciar a checkout session (pode ser real ou simulada)
app.post('/api/payment/create-checkout-session', async (req, res) => {
  const { plan, email } = req.body;
  if (!email || !plan) {
    return res.status(400).json({ error: 'Plano e e-mail são obrigatórios.' });
  }

  // Se a chave da Stripe não estiver configurada no .env, inicia o fluxo simulado (sandbox)
  if (!stripe) {
    console.log(`[Stripe Sandbox] Redirecionando ${email} para checkout simulado do plano ${plan}.`);
    return res.json({ url: `/mock-checkout.html?plan=${plan}&email=${encodeURIComponent(email)}` });
  }

  try {
    const priceId = plan === 'annual' 
      ? process.env.STRIPE_ANNUAL_PRICE_ID 
      : process.env.STRIPE_MONTHLY_PRICE_ID;

    if (!priceId) {
      return res.status(400).json({ error: 'IDs de preço da Stripe não configurados no servidor.' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'pix'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      customer_email: email,
      success_url: `${req.headers.origin}/app?checkout=success`,
      cancel_url: `${req.headers.origin}/`,
      metadata: { plan, email }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[Stripe Error]', err);
    res.status(500).json({ error: 'Erro ao gerar checkout do Stripe.' });
  }
});

// 2. Rota de confirmação do checkout simulado (sandbox)
app.post('/api/payment/mock-confirm', async (req, res) => {
  const { email, plan } = req.body;
  if (!email || !plan) {
    return res.status(400).json({ error: 'Plano e e-mail são obrigatórios.' });
  }

  try {
    const expiresDate = new Date();
    if (plan === 'annual') {
      expiresDate.setFullYear(expiresDate.getFullYear() + 1);
    } else {
      expiresDate.setMonth(expiresDate.getMonth() + 1);
    }

    const dbUser = await db.findUserByEmail(email);
    if (!dbUser) {
      return res.status(404).json({ error: 'Usuário não cadastrado.' });
    }

    await db.updateUser(email, {
      subscriptionActive: true,
      subscriptionPlan: plan,
      subscriptionExpires: expiresDate.toISOString()
    });

    console.log(`[Stripe Sandbox] Assinatura do plano ${plan} confirmada com sucesso para ${email}!`);
    res.json({ message: 'Pagamento simulado efetuado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha ao ativar assinatura simulada.' });
  }
});

// 3. Status de cobrança do usuário (API consumida pelo Dashboard)
app.get('/api/payment/status', authenticateToken, async (req, res) => {
  try {
    const user = await db.findUserByEmail(req.user.email);
    if (!user) return res.status(404).json({ error: 'Usuário não localizado.' });

    // Verifica se a assinatura expirou
    let active = !!user.subscriptionActive;
    if (active && user.subscriptionExpires) {
      const expiry = new Date(user.subscriptionExpires);
      if (expiry < new Date()) {
        active = false;
        await db.updateUser(user.email, { subscriptionActive: false });
      }
    }

    res.json({
      subscriptionActive: active,
      subscriptionPlan: user.subscriptionPlan || 'free',
      subscriptionExpires: user.subscriptionExpires || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao verificar status da assinatura.' });
  }
});

// 4. Webhook oficial do Stripe
app.post('/api/payment/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (endpointSecret && sig && stripe) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      event = req.body;
    }
  } catch (err) {
    console.error(`❌ Erro na assinatura do Webhook Stripe:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_email || session.metadata?.email;
    const plan = session.metadata?.plan || 'monthly';

    if (email) {
      const expiresDate = new Date();
      if (plan === 'annual') {
        expiresDate.setFullYear(expiresDate.getFullYear() + 1);
      } else {
        expiresDate.setMonth(expiresDate.getMonth() + 1);
      }

      await db.updateUser(email, {
        subscriptionActive: true,
        subscriptionPlan: plan,
        subscriptionExpires: expiresDate.toISOString()
      });
      console.log(`🔔 Stripe Webhook: Assinatura ativada via webhook real para ${email} (plano ${plan})`);
    }
  }

  res.json({ received: true });
});

// Qualquer outra rota serve o index.html (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializa o banco de dados (Supabase/Local) e depois escuta na porta correspondente
async function startServer() {
  await db.initDb();
  
  app.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`🚀 Monitor de Processos Judiciais iniciado com sucesso!`);
    console.log(`💻 Acesse localmente em: http://localhost:${PORT}`);
    console.log(`⚙️  Hospedagem configurada. Porta ativa: ${PORT}`);
    console.log(`================================================================`);
  });
}

startServer().catch(err => {
  console.error('Falha crítica ao iniciar o servidor:', err);
  process.exit(1);
});
