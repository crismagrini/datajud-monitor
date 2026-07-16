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

app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, 'public')));

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
      return res.status(response.status).json({
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

    // Tenta extrair a ficha técnica usando o Gemini em segundo plano se a chave for fornecida
    let expertInfo = {
      autor: 'Não localizado',
      reu: 'Não localizado',
      justicaGratuita: 'Não informado',
      objetoPericia: 'Não localizado',
      cidadeEstado: 'Não localizado'
    };

    const clientGeminiKey = req.headers['x-gemini-key'];
    const geminiKey = clientGeminiKey && clientGeminiKey.trim() !== '' ? clientGeminiKey : process.env.GEMINI_API_KEY;

    if (geminiKey && pdfText.trim() !== '') {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
        
        // Pega os primeiros 15000 caracteres para analisar a petição inicial/capa
        const sampleText = pdfText.substring(0, 15000);
        
        const prompt = `
Analise o seguinte trecho inicial de um processo judicial brasileiro e extraia as seguintes informações em formato JSON estruturado:
1. "autor": Nome completo do Autor (Polo Ativo).
2. "reu": Nome completo do Réu (Polo Passivo).
3. "justicaGratuita": "Sim" se houver menção clara de concessão de justiça gratuita / benefício da gratuidade de justiça / benefício da JG. Caso contrário, "Não". Se não houver menção, "Não informado".
4. "objetoPericia": Resumo sumário (máximo de 15 palavras) do objeto técnico da perícia ou disputa técnica (ex: "Apurar suposto erro em cirurgia bariátrica", "Recálculo de verbas rescisórias trabalhistas", "Avaliação de benfeitorias em imóvel").
5. "cidadeEstado": Cidade e Estado da comarca/foro deste processo (ex: "Ribeirão Preto/SP").

Retorne APENAS o JSON puro, sem blocos de código markdown ou explicações. Exemplo de retorno:
{"autor": "...", "reu": "...", "justicaGratuita": "...", "objetoPericia": "...", "cidadeEstado": "..."}

Texto do processo:
${sampleText}
`;
        
        console.log(`[PDF Parser] Solicitando extração de Ficha Técnica ao Gemini...`);
        const aiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }]
          })
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          
          // Limpa blocos de código se houver (ex: ```json ... ```)
          const cleanJSONStr = aiText.replace(/^```json/, '').replace(/```$/, '').trim();
          const parsed = JSON.parse(cleanJSONStr);
          
          expertInfo = {
            autor: parsed.autor || expertInfo.autor,
            reu: parsed.reu || expertInfo.reu,
            justicaGratuita: parsed.justicaGratuita || expertInfo.justicaGratuita,
            objetoPericia: parsed.objetoPericia || expertInfo.objetoPericia,
            cidadeEstado: parsed.cidadeEstado || expertInfo.cidadeEstado
          };
          console.log(`[PDF Parser] Ficha técnica extraída com sucesso para o Expert:`, expertInfo);
        } else {
          console.warn(`[PDF Parser] API do Gemini retornou status ${aiRes.status} na extração de metadados.`);
        }
      } catch (ex) {
        console.error('[PDF Parser] Falha ao extrair expertInfo via Gemini:', ex);
      }
    }
    
    res.json({
      text: pdfText,
      numPages: numPages,
      expertInfo: expertInfo
    });
  } catch (error) {
    console.error('[PDF Parser] Falha ao extrair texto do PDF:', error);
    res.status(500).json({
      error: 'Erro ao processar e extrair o texto do arquivo PDF.',
      details: error.message
    });
  }
});

// Helper comum para processar IA via API direta do Gemini, OpenRouter ou Groq
async function generateAiContent(prompt, apiKey, modelType = 'analysis') {
  if (apiKey.startsWith('gsk_')) {
    // Provedor Groq Cloud (API compatível com OpenAI)
    // Usa llama-3.1-8b-instant para tarefas leves de metadados para economizar a cota restrita de TPM do llama-3.3-70b-versatile
    const model = modelType === 'metadata' ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile';
    console.log(`[Groq] Chamando o modelo: ${model} (${modelType})`);
    
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      attempts++;
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }]
          })
        });
        
        const data = await response.json();
        
        // Se bater no limite de taxa, aguarda o tempo que a API pede e tenta de novo automaticamente
        if (response.status === 429) {
          const delaySec = data.error?.message?.match(/in (\d+\.\d+)s/)?.[1] || 7;
          const waitMs = Math.ceil(parseFloat(delaySec) * 1000) + 500;
          console.warn(`[Groq Rate Limit] Limite de tokens atingido. Aguardando ${waitMs}ms para tentar novamente (Tentativa ${attempts}/${maxAttempts})...`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        
        if (!response.ok) {
          console.error('[Groq] Erro na API do Groq:', data);
          throw new Error(data.error?.message || 'Erro retornado pela API do Groq.');
        }
        
        const text = data.choices?.[0]?.message?.content;
        if (!text) {
          throw new Error('A resposta do Groq não retornou nenhum texto válido.');
        }
        return text;
      } catch (err) {
        if (attempts >= maxAttempts) throw err;
        console.warn(`[Groq Connection] Falha de conexão. Aguardando 2s para tentar novamente (Tentativa ${attempts}/${maxAttempts})...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw new Error('Falha ao processar a requisição no Groq após várias tentativas.');
  } else if (apiKey.startsWith('sk-or-')) {
    // Provedor OpenRouter
    const modelsToTry = [
      'google/gemini-2.0-flash',
      'meta-llama/llama-3.3-70b-instruct:free',
      'openrouter/free'
    ];
    
    let lastError = null;
    for (const model of modelsToTry) {
      try {
        console.log(`[OpenRouter] Tentando chamar o modelo: ${model}`);
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Datajud Monitor'
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }]
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          const text = data.choices?.[0]?.message?.content;
          if (text) {
            console.log(`[OpenRouter] Sucesso com o modelo: ${model}`);
            return text;
          }
        } else {
          const errText = await response.text();
          console.warn(`[OpenRouter] Falha no modelo ${model}: ${response.status} - ${errText}`);
          lastError = new Error(errText);
        }
      } catch (err) {
        console.error(`[OpenRouter] Erro de conexão com ${model}:`, err);
        lastError = err;
      }
    }
    throw lastError || new Error('Falha ao processar a requisição no OpenRouter. Verifique o saldo ou cota.');
  } else {
    // Provedor Direto do Gemini (Google AI Studio)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });
    
    const data = await response.json();
    if (!response.ok) {
      console.error('[Gemini Direct] Erro na requisição ao Gemini API:', data);
      throw new Error(data.error?.message || 'Erro retornado pela API do Gemini.');
    }
    
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('A resposta do Gemini não retornou nenhum texto válido.');
    }
    return text;
  }
}

// Rota para extração de metadados da Ficha Técnica do Expert usando IA (Payload pequeno - PROTEGIDA)
app.post('/api/extract-pdf-metadata', authenticateToken, async (req, res) => {
  const { textSample } = req.body;

  if (!textSample) {
    return res.status(400).json({ error: 'O parâmetro "textSample" contendo os primeiros caracteres é obrigatório.' });
  }

  // Verifica se o cliente enviou uma API Key personalizada no header
  const clientGeminiKey = req.headers['x-gemini-key'];
  const geminiKey = clientGeminiKey && clientGeminiKey.trim() !== '' ? clientGeminiKey : process.env.GEMINI_API_KEY;

  let expertInfo = {
    autor: 'Não localizado',
    reu: 'Não localizado',
    perito: 'Não nomeado',
    justicaGratuita: 'Não informado',
    objetoPericia: 'Não localizado',
    cidadeEstado: 'Não localizado',
    inversaoOnus: 'Não informado',
    honorarios: null,
    honorariosUfesp: null,
    depositoJudicial: 'Não informado',
    dataHonorarios: null,
    dataDeposito: null,
    todasPartes: []
  };

  if (!geminiKey) {
    return res.json({ expertInfo });
  }

  const prompt = `
Analise o seguinte trecho inicial e selecionado de um processo judicial brasileiro e extraia as seguintes informações em formato JSON estruturado:
1. "autor": Nome completo do Requerente (Polo Ativo).
2. "reu": Nome completo do Requerido (Polo Passivo).
3. "perito": Nome completo do Perito Judicial nomeado, se houver menção à sua nomeação (ex: "Dr. João Silva"). Caso contrário, retornar "Não nomeado". Faça uma análise das decisões no texto para localizar o nome.
4. "justicaGratuita": "Sim" se houver menção clara de concessão de justiça gratuita / benefício da gratuidade de justiça / JG. Caso contrário, "Não". Se não houver menção, "Não informado".
5. "objetoPericia": Resumo sumário (máximo de 15 palavras) do objeto técnico da perícia ou disputa técnica (ex: "Apurar suposto erro em cirurgia bariátrica").
6. "cidadeEstado": Cidade e Estado da comarca/foro deste processo (ex: "Ribeirão Preto/SP").
7. "inversaoOnus": "Sim" se houver pedido ou decisão explícita de inversão do ônus da prova. "Não" se indeferido/afastado. Se não houver menção, "Não informado".
8. "honorarios": Valor total fixado ou proposto em BRL (float/int). Se não localizado, null.
9. "honorariosUfesp": Valor total em UFESPs, se fixado em UFESPs (float/int). Se não localizado, null.
10. "depositoJudicial": "Sim" ou "Não" ou "Parcial" ou "Não informado" (status do depósito de honorários).
11. "dataHonorarios": Data da decisão de fixação ou petição de proposta de honorários (YYYY-MM-DD). Se não, null.
12. "dataDeposito": Data em que foi feito o depósito judicial (YYYY-MM-DD). Se não, null.
13. "todasPartes": Array de objetos com os integrantes do polo ativo e passivo que constam no texto, no formato [{"nome": "...", "polo": "ATIVO"}, {"nome": "...", "polo": "PASSIVO"}].

Retorne APENAS o JSON puro, sem blocos de código markdown ou explicações. Exemplo de retorno:
{"autor": "...", "reu": "...", "perito": "...", "justicaGratuita": "...", "objetoPericia": "...", "cidadeEstado": "...", "inversaoOnus": "...", "honorarios": null, "honorariosUfesp": null, "depositoJudicial": "...", "dataHonorarios": null, "dataDeposito": null, "todasPartes": [{"nome": "...", "polo": "ATIVO"}]}

Texto do processo:
${textSample}
`;

  try {
    console.log(`[Metadata Extractor] Solicitando extração leve de Ficha Técnica ao provedor de IA...`);
    const aiText = await generateAiContent(prompt, geminiKey, 'metadata');
    
    if (aiText) {
      const cleanJSONStr = aiText.trim().replace(/^```json/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(cleanJSONStr);
      
      expertInfo = {
        autor: parsed.autor || expertInfo.autor,
        reu: parsed.reu || expertInfo.reu,
        perito: parsed.perito || expertInfo.perito,
        justicaGratuita: parsed.justicaGratuita || expertInfo.justicaGratuita,
        objetoPericia: parsed.objetoPericia || expertInfo.objetoPericia,
        cidadeEstado: parsed.comarca || parsed.cidadeEstado || expertInfo.cidadeEstado,
        inversaoOnus: parsed.inversaoOnus || expertInfo.inversaoOnus,
        honorarios: parsed.honorarios || null,
        honorariosUfesp: parsed.honorariosUfesp || null,
        depositoJudicial: parsed.depositoJudicial || expertInfo.depositoJudicial,
        dataHonorarios: parsed.dataHonorarios || null,
        dataDeposito: parsed.dataDeposito || null,
        todasPartes: parsed.todasPartes || []
      };
      console.log(`[Metadata Extractor] Ficha técnica extraída com sucesso para o Expert:`, expertInfo);
    }
    
    res.json({ expertInfo });
  } catch (error) {
    console.error('[Metadata Extractor] Falha ao extrair metadados via IA:', error);
    res.json({ expertInfo }); // Retorna dados padrão mesmo se falhar para não bloquear o upload
  }
});

// Rota para análise de processos por IA (Focado em Perícia Judicial - CPC/2015 - PROTEGIDA)
app.post('/api/analyze-process', authenticateToken, async (req, res) => {
  const { processData } = req.body;

  if (!processData || !processData.pdfText) {
    return res.status(400).json({ error: 'Os dados do processo e o texto extraído do PDF ("pdfText") são obrigatórios para a análise.' });
  }

  // Verifica se o cliente enviou uma API Key personalizada no header
  const clientGeminiKey = req.headers['x-gemini-key'];
  const geminiKey = clientGeminiKey && clientGeminiKey.trim() !== '' ? clientGeminiKey : process.env.GEMINI_API_KEY;

  if (!geminiKey) {
    return res.status(401).json({
      error: 'Chave de API não configurada.',
      details: 'Configure a variável GEMINI_API_KEY no arquivo .env do servidor ou insira sua chave nas Configurações da aplicação.'
    });
  }

  let pdfText = processData.pdfText;
  const maxLength = 35000; // Limite aumentado para análise profunda com trechos de contexto
  if (pdfText && pdfText.length > maxLength) {
    console.log(`[IA] PDF muito grande (${pdfText.length} caracteres). Aplicando filtro inteligente de trechos relevantes...`);
    
    // Preserva os primeiros 8.000 caracteres (capa/foro/partes)
    const headerText = pdfText.substring(0, 8000);
    
    // Restante do texto
    const remainingText = pdfText.substring(8000);
    const lines = remainingText.split('\n');
    const keywords = ['perito', 'nomeio', 'nomeação', 'honorários', 'depósito', 'gratuita', 'ônus', 'inversão', 'ufesp', 'arbitro', 'laudo'];
    
    let relevantExcerpts = [];
    let currentLength = headerText.length;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length < 10) continue;
      
      const lineLower = line.toLowerCase();
      const hasKeyword = keywords.some(kw => lineLower.includes(kw));
      
      if (hasKeyword) {
        const prevLine = i > 0 ? lines[i-1].trim() : '';
        const nextLine = i < lines.length - 1 ? lines[i+1].trim() : '';
        const block = `\n[Trecho relevante linha ${i}]:\n${prevLine ? prevLine + '\n' : ''}${line}\n${nextLine ? nextLine + '\n' : ''}`;
        
        if (currentLength + block.length < maxLength) {
          relevantExcerpts.push(block);
          currentLength += block.length;
        } else {
          break;
        }
      }
    }
    
    pdfText = `${headerText}\n\n--- [TRECHOS SELECIONADOS DA ANÁLISE DO PROCESSO] ---\n\n${relevantExcerpts.join('\n\n')}`;
    console.log(`[IA] Filtro concluído. Novo tamanho enviado: ${pdfText.length} caracteres.`);
  }

  // Prompts estruturados focados em Peritos Judiciais e Assistentes Técnicos (CPC/2015)
  const promptText = `
Você é um consultor jurídico e assistente de IA de alta performance, especializado no Código de Processo Civil (CPC/2015) brasileiro.
Seu foco principal é auxiliar Peritos Judiciais e Assistentes Técnicos (Auxiliares da Justiça / Experts) na análise de autos processuais.

Sua tarefa é analisar o texto extraído da cópia integral de um processo em PDF e gerar as seguintes informações:
1. Um parecer/relatório analítico detalhado em português (formato Markdown).
2. O nome completo do perito nomeado (analise profundamente as decisões judiciais para encontrar o nome do perito nomeado de fato, não ignore).
3. Informações financeiras da perícia: o valor de honorários arbitrados ou propostos, se o depósito judicial correspondente foi efetuado pelas partes responsáveis, a data de fixação/proposta dos honorários e a data do depósito judicial correspondente (se houver).
4. Indicação de concessão de Justiça Gratuita e de Inversão do Ônus da Prova (da Causa).
5. Uma lista estruturada (JSON array) contendo os prazos processuais (deadlines) calculados.

INSTRUÇÕES IMPORTANTES PARA O PARECER:
- Baseie sua análise estritamente no texto do PDF fornecido. Jamais invente fatos, nomes ou dados fictícios.
- Identifique os prazos críticos aplicáveis ao Perito do juízo ou Assistentes Técnicos (Proposta de honorários, escusa, resposta a esclarecimentos, entrega de laudo, parecer técnico discordante/concordante).
- O parecer deve ser em português claro e bem estruturado.
- Chame as partes de Requerente (polo ativo) e Requerido (polo passivo).

INSTRUÇÕES IMPORTANTES PARA OS PRAZOS (DEADLINES):
- Para cada prazo encontrado ou aplicável, determine uma data limite real (formato YYYY-MM-DD). Calcule a data limite com base nas datas de intimação ou publicação citadas no PDF (use apenas dias úteis para o cálculo, pulando finais de semana e feriados nacionais, seguindo o CPC/2015). Se a data da intimação ou publicação do prazo específico não constar no texto, estime a data limite com base no andamento mais recente dos autos ou use como referência o dia de hoje (${new Date().toLocaleDateString('pt-BR')}).

Você deve responder APENAS com um objeto JSON válido, sem qualquer texto de introdução ou conclusão. O JSON deve ter exatamente a seguinte estrutura:
{
  "analysis": "### 📋 Resumo da Demanda (Objeto da Lide)...\\n\\n### ⚖️ Histórico de Atuação da Perícia...\\n\\n### ⚠️ Alerta de Prazos do Expert (CPC/2015)...\\n\\n### 🚀 Recomendações e Próximos Passos...",
  "perito": "Nome do perito judicial nomeado (se houver menção nos autos, ex: 'Dr. João Silva'). Caso contrário, retorne 'Não nomeado'. Faça uma análise detalhada das decisões judiciais no texto para extrair o nome.",
  "justicaGratuita": "Sim ou Não ou Não informado",
  "inversaoOnus": "Sim ou Não ou Não informado",
  "comarca": "Nome da comarca/foro deste processo (ex: 'Foro de Jundiaí/SP').",
  "objetoPericia": "Resumo sumário (máximo de 15 palavras) do objeto técnico da perícia ou disputa técnica (ex: 'Apurar suposto erro em cirurgia bariátrica').",
  "honorarios": 4500.00, // Retorne apenas o número (float/int) do valor fixado pelo juiz ou proposto pelo perito se localizado em BRL. Se não localizado, retorne null.
  "honorariosUfesp": 15, // Se os honorários foram fixados em UFESPs, informe a quantidade de UFESPs aqui. Caso contrário, retorne null.
  "depositoJudicial": "Sim ou Não ou Parcial ou Não informado", // Indique se foi efetuado o depósito judicial do valor dos honorários
  "dataHonorarios": "YYYY-MM-DD", // A data em que ocorreu a decisão fixando os honorários ou a petição de proposta. Se não localizado, retorne null.
  "dataDeposito": "YYYY-MM-DD", // A data em que foi efetuado o depósito judicial do valor dos honorários pelas partes. Se não localizado, retorne null.
  "resumoProcesso": "Resumo curto (máximo 45 palavras) sobre a nomeação do perito e proposta de honorários, detalhando se a proposta foi aceita/homologada ou se houve arbitramento de valores pelo juiz.",
  "deadlines": [
    {
      "title": "Apresentar proposta de honorários",
      "date": "YYYY-MM-DD",
      "description": "Peticionar proposta de honorários, currículo e contatos profissionais. Art. 465, § 2º do CPC (prazo de 5 dias úteis).",
      "cpcArticle": "Art. 465, § 2º"
    }
  ]
}

Aqui está o conteúdo de texto extraído do PDF do processo:
=== INÍCIO DO TEXTO DO PDF ===
${pdfText}
=== FIM DO TEXTO DO PDF ===
`;

  try {
    console.log(`[IA] Iniciando análise baseada no PDF para o processo: ${processData.numeroProcesso}`);
    const aiText = await generateAiContent(promptText, geminiKey, 'analysis');
    
    if (!aiText) {
      throw new Error('O provedor de IA retornou uma resposta vazia.');
    }

    const cleanJSONStr = aiText.trim().replace(/^```json/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleanJSONStr);

    res.json({
      analysis: parsed.analysis || 'Falha ao estruturar o parecer.',
      deadlines: parsed.deadlines || [],
      perito: parsed.perito || 'Não nomeado',
      inversaoOnus: parsed.inversaoOnus || 'Não informado',
      justicaGratuita: parsed.justicaGratuita || 'Não informado',
      cidadeEstado: parsed.comarca || parsed.cidadeEstado || 'Não localizado',
      objetoPericia: parsed.objetoPericia || 'Não localizado',
      honorarios: parsed.honorarios || null,
      honorariosUfesp: parsed.honorariosUfesp || null,
      depositoJudicial: parsed.depositoJudicial || 'Não informado',
      dataHonorarios: parsed.dataHonorarios || null,
      dataDeposito: parsed.dataDeposito || null,
      resumoProcesso: parsed.resumoProcesso || 'Não localizado'
    });
  } catch (error) {
    console.error('[IA] Erro ao processar a análise:', error);
    res.status(500).json({
      error: 'Falha interna ao processar a análise por IA.',
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
