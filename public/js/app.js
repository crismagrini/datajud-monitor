/* ==========================================================================
   DADOS E CONFIGURAÇÕES DO APLICATIVO
   ========================================================================== */

const TRIBUNAIS = [
  { alias: 'tjsp', nome: 'TJ São Paulo', tipo: 'estadual' },
  { alias: 'tjrj', nome: 'TJ Rio de Janeiro', tipo: 'estadual' },
  { alias: 'tjmg', nome: 'TJ Minas Gerais', tipo: 'estadual' },
  { alias: 'tjrs', nome: 'TJ Rio Grande do Sul', tipo: 'estadual' },
  { alias: 'tjpr', nome: 'TJ Paraná', tipo: 'estadual' },
  { alias: 'tjsc', nome: 'TJ Santa Catarina', tipo: 'estadual' },
  { alias: 'tjba', nome: 'TJ Bahia', tipo: 'estadual' },
  { alias: 'tjpe', nome: 'TJ Pernambuco', tipo: 'estadual' },
  { alias: 'tjce', nome: 'TJ Ceará', tipo: 'estadual' },
  { alias: 'tjdft', nome: 'TJ Distrito Federal e Territórios', tipo: 'estadual' },
  
  { alias: 'trf1', nome: 'TRF 1ª Região (DF)', tipo: 'federal' },
  { alias: 'trf2', nome: 'TRF 2ª Região (RJ/ES)', tipo: 'federal' },
  { alias: 'trf3', nome: 'TRF 3ª Região (SP/MS)', tipo: 'federal' },
  { alias: 'trf4', nome: 'TRF 4ª Região (Sul)', tipo: 'federal' },
  { alias: 'trf5', nome: 'TRF 5ª Região (Nordeste)', tipo: 'federal' },
  { alias: 'trf6', nome: 'TRF 6ª Região (MG)', tipo: 'federal' },
  
  { alias: 'trt1', nome: 'TRT 1ª Região (RJ)', tipo: 'trabalho' },
  { alias: 'trt2', nome: 'TRT 2ª Região (SP)', tipo: 'trabalho' },
  { alias: 'trt3', nome: 'TRT 3ª Região (MG)', tipo: 'trabalho' },
  { alias: 'trt4', nome: 'TRT 4ª Região (RS)', tipo: 'trabalho' },
  { alias: 'trt5', nome: 'TRT 5ª Região (BA)', tipo: 'trabalho' },
  { alias: 'trt15', nome: 'TRT 15ª Região (Campinas)', tipo: 'trabalho' },
  
  { alias: 'stj', nome: 'Superior Tribunal de Justiça', tipo: 'superior' },
  { alias: 'tst', nome: 'Tribunal Superior do Trabalho', tipo: 'superior' },
  { alias: 'tse', nome: 'Tribunal Superior Eleitoral', tipo: 'superior' }
];

// Valores Padrão Globais (Área do Desenvolvedor)
const DEFAULT_SUPABASE_URL = 'https://kivijjbwktgcjbthkque.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpdmlqamJ3a3RnY2pidGhrcXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNTc2MzQsImV4cCI6MjA5OTczMzYzNH0.iknAdlHezamlfpM436vGGUCUIi_l4yQdDjr8VW91wRE';
const DEFAULT_SUPABASE_BUCKET = 'Datajud';

// Configuração da API de IA (chave fica no servidor, não exposta ao cliente)
const AI_API_URL = '/api/ai/analyze';

// Estado da Aplicação (Variáveis Globais) - Sem simulações fictícias
let supabaseUrl = '';
let supabaseAnonKey = '';
let supabaseBucket = 'Datajud';
let supabaseClient = null;
let activeProcess = null;
let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();
let selectedCalendarDateStr = null;
let currentUserEmail = null;
let jwtToken = null;

// Requisições autenticadas por JWT para o servidor
async function authFetch(url, options = {}) {
  if (!options.headers) {
    options.headers = {};
  }
  if (jwtToken) {
    options.headers['Authorization'] = `Bearer ${jwtToken}`;
  }
  
  try {
    const response = await fetch(url, options);
    
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      const clone = response.clone();
      try {
        const errData = await clone.json();
        if (errData && errData.error === 'CONTA_BLOQUEADA_TRIAL') {
          showToast(errData.message || 'Seu período de testes de 7 dias expirou. Faça uma assinatura para continuar.', 'warning');
          openDialog('billing-dialog');
          return response;
        }
        if (errData && errData.error === 'Usuário não localizado.') {
          jwtToken = null;
          currentUserEmail = null;
          localStorage.removeItem('jwt_token');
          localStorage.removeItem('user_email');
          showAuthScreen();
          showToast('Sua conta não foi encontrada no servidor. Por favor, entre ou cadastre-se novamente.', 5000);
          return response;
        }
      } catch (e) {}

      if (response.status === 401 || response.status === 403) {
        jwtToken = null;
        currentUserEmail = null;
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_email');
        showAuthScreen();
        showToast('Sessão expirada ou inválida. Por favor, entre novamente.', 5000);
      }
    }
    
    return response;
  } catch (err) {
    console.error('[authFetch] Erro na requisição:', err);
    throw err;
  }
}

/* ==========================================================================
   INDEXEDDB SERVICE: PERSISTÊNCIA DE ALTA CAPACIDADE (PARTICIONADO POR USUÁRIO)
   ========================================================================== */

const DB_NAME = 'DatajudMonitorDB';
const DB_VERSION = 2; // Incrementado para v2 devido à mudança de chave (partição por usuário)
const STORE_NAME = 'processes';

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = request.result;
      // Se existir a store antiga, deleta para recriar com a nova chave composta
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
  });
}

const ProcessService = {
  async getProcesses() {
    try {
      if (!currentUserEmail) return [];
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const all = req.result || [];
          // Retorna apenas os processos vinculados ao e-mail do usuário logado
          const filtered = all.filter(p => p.userEmail === currentUserEmail);
          resolve(filtered);
        };
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('[ProcessService] Falha ao ler do IndexedDB:', err);
      return [];
    }
  },
  async saveAll(processes) {
    try {
      if (!currentUserEmail) return;
      const db = await getDB();
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        // Deleta os processos anteriores deste usuário
        all.forEach(p => {
          if (p.userEmail === currentUserEmail) {
            store.delete(p.id);
          }
        });

        // Insere os novos
        processes.forEach(p => {
          p.userEmail = currentUserEmail;
          p.id = `${currentUserEmail}_${p.numeroProcesso}`;
          store.put(p);
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.error('[ProcessService] Falha ao salvar no IndexedDB:', err);
    }
  },
  async add(process) {
    try {
      if (!currentUserEmail) return false;
      const db = await getDB();
      const processes = await this.getProcesses();
      
      const existing = processes.find(p => p.numeroProcesso === process.numeroProcesso);
      if (existing) {
        if (existing.archived) {
          existing.archived = false;
          await this.update(existing);
          return 'reactivated';
        }
        return false;
      }
      
      process.hasUpdate = false;
      process.lastChecked = new Date().toISOString();
      process.userEmail = currentUserEmail;
      process.id = `${currentUserEmail}_${process.numeroProcesso}`;
      
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.add(process);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('[ProcessService] Falha ao adicionar no IndexedDB:', err);
      return false;
    }
  },
  async remove(processNumber) {
    try {
      if (!currentUserEmail) return;
      const db = await getDB();
      const compositeId = `${currentUserEmail}_${processNumber}`;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(compositeId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('[ProcessService] Falha ao remover no IndexedDB:', err);
    }
  },
  async update(updatedProcess) {
    try {
      if (!currentUserEmail) return false;
      const db = await getDB();
      updatedProcess.userEmail = currentUserEmail;
      updatedProcess.id = `${currentUserEmail}_${updatedProcess.numeroProcesso}`;
      
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(updatedProcess);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.error('[ProcessService] Falha ao atualizar no IndexedDB:', err);
      return false;
    }
  }
};

/* ==========================================================================
   INICIALIZAÇÃO DO APLICATIVO E CONTROLE DE ACESSO
   ========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  setupAuthEventListeners();
  const isAuthenticated = checkAuthSession();
  
  loadConfig();
  populateManualCourts();
  setupEventListeners();

  // Inicia o monitoramento de alarmes periodicamente em segundo plano
  setInterval(checkActiveAlarms, 15000);

  // Sincronização automática periódica de todos os processos monitorados (a cada 3 minutos)
  setInterval(syncAllMonitoredSilently, 3 * 60 * 1000);

  if (isAuthenticated) {
    await renderDashboard();
    // Executa busca automática silenciosa de atualizações no início
    setTimeout(syncAllMonitoredSilently, 2000);
    // Verificação de alarmes inicial
    setTimeout(checkActiveAlarms, 3000);
  }

  // Lógica do Modal de Cobrança / Assinaturas (Stripe)
  const options = document.querySelectorAll('.plan-option');
  options.forEach(opt => {
    opt.addEventListener('click', () => {
      options.forEach(o => {
        o.classList.remove('active');
        o.style.borderColor = 'var(--border-color)';
      });
      opt.classList.add('active');
      opt.style.borderColor = 'var(--primary)';
      const radio = opt.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  const btnSubmitBilling = document.getElementById('btn-submit-billing');
  if (btnSubmitBilling) {
    btnSubmitBilling.addEventListener('click', async () => {
      const selectedPlan = document.querySelector('input[name="billing-plan-select"]:checked')?.value || 'monthly';
      btnSubmitBilling.disabled = true;
      btnSubmitBilling.innerHTML = '<span class="material-symbols-rounded" style="animation: spin 1s linear infinite;">progress_activity</span> Redirecionando...';

      try {
        const resp = await authFetch('/api/payment/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: selectedPlan, email: currentUserEmail })
        });

        if (resp.ok) {
          const result = await resp.json();
          if (result.url) {
            window.location.href = result.url;
          } else {
            throw new Error('URL de checkout inválida.');
          }
        } else {
          const err = await resp.json();
          throw new Error(err.error || 'Erro ao criar sessão de pagamento.');
        }
      } catch (err) {
        showToast(`Erro de Pagamento: ${err.message}`, 'error');
        btnSubmitBilling.disabled = false;
        btnSubmitBilling.innerHTML = '<span class="material-symbols-rounded">credit_card</span><span>Assinar com Stripe</span>';
      }
    });
  }

  // Verifica se o redirecionamento pós-pagamento ocorreu com sucesso
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('checkout') === 'success') {
    showToast('✓ Assinatura Premium ativada com sucesso!', 'success');
    // Remove o query param da URL sem recarregar a página
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  }
});

// Controladores da Interface de Autenticação
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('email-verification-screen').style.display = 'none';
  document.querySelector('.app-container').style.display = 'none';
}

function showVerificationScreen(testCode = '') {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('email-verification-screen').style.display = 'flex';
  document.querySelector('.app-container').style.display = 'none';

  const mockAlert = document.getElementById('verification-mock-alert');
  const mockText = document.getElementById('verification-mock-code-text');
  
  if (testCode && mockAlert && mockText) {
    mockAlert.style.display = 'flex';
    mockText.textContent = `Seu código gerado é: ${testCode}`;
  } else if (mockAlert) {
    mockAlert.style.display = 'none';
  }
  document.getElementById('verification-code').value = '';
  document.getElementById('verification-error-box').style.display = 'none';
}

async function updateSubscriptionUI() {
  const container = document.getElementById('user-subscription-badge');
  if (!container) return;

  try {
    const resp = await authFetch('/api/payment/status');
    if (resp.ok) {
      const data = await resp.json();
      if (data.subscriptionActive) {
        container.innerHTML = `
          <span class="badge-plan-premium" style="font-size: 11px; background: #d1fae5; color: #065f46; padding: 2px 8px; border-radius: 20px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;" title="Assinatura ativa!"><span class="material-symbols-rounded" style="font-size: 14px;">workspace_premium</span> Premium</span>
        `;
      } else {
        container.innerHTML = `
          <span class="badge-plan-free" id="btn-show-billing" style="font-size: 11px; background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 20px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" title="Clique para assinar"><span class="material-symbols-rounded" style="font-size: 14px;">lock</span> Grátis / Demo</span>
        `;
        document.getElementById('btn-show-billing')?.addEventListener('click', () => {
          openDialog('billing-dialog');
        });
      }
    }
  } catch (err) {
    console.error('Erro ao buscar status de assinatura:', err);
  }
}

function showDashboard() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('email-verification-screen').style.display = 'none';
  document.querySelector('.app-container').style.display = 'flex';
  document.getElementById('user-display-email').textContent = currentUserEmail;
  
  // Atualiza a exibição do plano de assinatura
  updateSubscriptionUI();
  
  // Atualiza contador de radar em segundo plano
  setTimeout(updateRadarBadgeCount, 500);
}

function checkAuthSession() {
  jwtToken = localStorage.getItem('jwt_token');
  currentUserEmail = localStorage.getItem('user_email');
  const userVerified = localStorage.getItem('user_verified');
  
  if (jwtToken && currentUserEmail) {
    if (userVerified === 'false') {
      showVerificationScreen(localStorage.getItem('verification_code_test'));
    } else {
      showDashboard();
    }
    return true;
  } else {
    showAuthScreen();
    return false;
  }
}

function setupAuthEventListeners() {
  // Alternar entre Formulários de Login/Cadastro
  document.getElementById('link-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth-login-form').style.display = 'none';
    document.getElementById('auth-register-form').style.display = 'block';
    document.getElementById('auth-message-box').style.display = 'none';
  });

  document.getElementById('link-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('auth-register-form').style.display = 'none';
    document.getElementById('auth-login-form').style.display = 'block';
    document.getElementById('auth-message-box').style.display = 'none';
  });

  // Formatação automática do CPF no cadastro
  const cpfRegInput = document.getElementById('reg-cpf');
  if (cpfRegInput) {
    cpfRegInput.addEventListener('input', (e) => {
      let clean = e.target.value.replace(/[^0-9]/g, '');
      if (clean.length > 11) clean = clean.substring(0, 11);
      
      let formatted = clean;
      if (clean.length > 3) {
        formatted = `${clean.substring(0, 3)}.${clean.substring(3)}`;
        if (clean.length > 6) {
          formatted = `${clean.substring(0, 3)}.${clean.substring(3, 6)}.${clean.substring(6)}`;
          if (clean.length > 9) {
            formatted = `${clean.substring(0, 3)}.${clean.substring(3, 6)}.${clean.substring(6, 9)}-${clean.substring(9)}`;
          }
        }
      }
      e.target.value = formatted;
    });
  }

  // Submissão do Login
  document.getElementById('auth-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const msgBox = document.getElementById('auth-message-box');
    const msgText = document.getElementById('auth-message-text');
    const btnSubmit = document.getElementById('btn-submit-login');

    msgBox.style.display = 'none';
    btnSubmit.disabled = true;
    const originalText = btnSubmit.textContent;
    btnSubmit.textContent = 'Entrando...';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Erro ao realizar login.');
      }

      jwtToken = data.token;
      currentUserEmail = data.email;
      localStorage.setItem('jwt_token', jwtToken);
      localStorage.setItem('user_email', currentUserEmail);
      localStorage.setItem('user_verified', data.verified ? 'true' : 'false');
      
      document.getElementById('auth-login-form').reset();
      
      if (data.verified === false) {
        localStorage.setItem('verification_code_test', data._testVerificationCode || '');
        showVerificationScreen(data._testVerificationCode);
        showToast('Confirme o código de ativação do seu e-mail.');
      } else {
        localStorage.removeItem('verification_code_test');
        showDashboard();
        await renderDashboard();
        showToast('Bem-vindo de volta!');
        setTimeout(syncAllMonitoredSilently, 1000);
      }
    } catch (err) {
      msgBox.style.display = 'block';
      msgBox.className = 'auth-message-box';
      msgText.textContent = err.message;
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = originalText;
    }
  });

  // Submissão do Cadastro
  document.getElementById('auth-register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value.trim();
    const name = document.getElementById('reg-name').value.trim();
    const cpf = document.getElementById('reg-cpf').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;
    const msgBox = document.getElementById('auth-message-box');
    const msgText = document.getElementById('auth-message-text');
    const btnSubmit = document.getElementById('btn-submit-register');

    msgBox.style.display = 'none';

    if (!name) {
      msgBox.style.display = 'block';
      msgBox.className = 'auth-message-box';
      msgText.textContent = 'Nome completo é obrigatório.';
      return;
    }

    const cleanCPF = cpf.replace(/[^0-9]/g, '');
    if (cleanCPF.length !== 11) {
      msgBox.style.display = 'block';
      msgBox.className = 'auth-message-box';
      msgText.textContent = 'CPF inválido. Deve conter 11 dígitos.';
      return;
    }

    if (password !== confirmPassword) {
      msgBox.style.display = 'block';
      msgBox.className = 'auth-message-box';
      msgText.textContent = 'As senhas não coincidem.';
      return;
    }

    btnSubmit.disabled = true;
    const originalText = btnSubmit.textContent;
    btnSubmit.textContent = 'Criando conta...';

    try {
      const registerResponse = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, cpf: cleanCPF })
      });

      const regData = await registerResponse.json();
      if (!registerResponse.ok) {
        throw new Error(regData.error || 'Erro ao realizar cadastro.');
      }

      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const loginData = await loginResponse.json();
      if (!loginResponse.ok) {
        throw new Error(loginData.error || 'Erro ao realizar login pós-cadastro.');
      }

      jwtToken = loginData.token;
      currentUserEmail = loginData.email;
      localStorage.setItem('jwt_token', jwtToken);
      localStorage.setItem('user_email', currentUserEmail);
      localStorage.setItem('user_verified', 'false');
      localStorage.setItem('verification_code_test', regData._testVerificationCode || '');

      document.getElementById('auth-register-form').reset();
      showVerificationScreen(regData._testVerificationCode);
      showToast('Conta criada com sucesso! Ative seu e-mail.');
    } catch (err) {
      msgBox.style.display = 'block';
      msgBox.className = 'auth-message-box';
      msgText.textContent = err.message;
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = originalText;
    }
  });

  // Botão de Sair (Logout)
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (confirm('Deseja realmente sair da sua conta?')) {
      jwtToken = null;
      currentUserEmail = null;
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('user_email');
      localStorage.removeItem('user_verified');
      localStorage.removeItem('verification_code_test');
      showAuthScreen();
      showToast('Sessão encerrada.');
    }
  });

  // Submissão do Formulário de Verificação de E-mail
  const verificationForm = document.getElementById('email-verification-form');
  if (verificationForm) {
    verificationForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('verification-code').value.trim();
      const errBox = document.getElementById('verification-error-box');
      const errText = document.getElementById('verification-error-text');
      const btn = document.getElementById('btn-submit-verification');
      
      errBox.style.display = 'none';
      if (code.length !== 6) {
        errBox.style.display = 'block';
        errText.textContent = 'O código de ativação deve possuir 6 dígitos.';
        return;
      }
      
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Confirmando...';
      
      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToken}`
          },
          body: JSON.stringify({ code })
        });
        
        const resData = await response.json();
        if (!response.ok) {
          throw new Error(resData.error || 'Erro na verificação do código.');
        }
        
        localStorage.setItem('user_verified', 'true');
        localStorage.removeItem('verification_code_test');
        
        document.getElementById('email-verification-screen').style.display = 'none';
        showDashboard();
        await renderDashboard();
        showToast('E-mail verificado com sucesso! Conta ativada.');
        setTimeout(syncAllMonitoredSilently, 1000);
      } catch (err) {
        errBox.style.display = 'block';
        errText.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }

  // Logout na tela de verificação
  const verificationLogout = document.getElementById('link-verification-logout');
  if (verificationLogout) {
    verificationLogout.addEventListener('click', (e) => {
      e.preventDefault();
      jwtToken = null;
      currentUserEmail = null;
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('user_email');
      localStorage.removeItem('user_verified');
      localStorage.removeItem('verification_code_test');
      document.getElementById('email-verification-screen').style.display = 'none';
      showAuthScreen();
    });
  }
}

// Carrega configurações salvas
function loadConfig() {
  supabaseUrl = localStorage.getItem('supabase_url') || DEFAULT_SUPABASE_URL;
  document.getElementById('settings-supabase-url').value = localStorage.getItem('supabase_url') || '';

  supabaseAnonKey = localStorage.getItem('supabase_anon_key') || DEFAULT_SUPABASE_ANON_KEY;
  document.getElementById('settings-supabase-anon-key').value = localStorage.getItem('supabase_anon_key') || '';

  supabaseBucket = localStorage.getItem('supabase_bucket') || DEFAULT_SUPABASE_BUCKET;
  document.getElementById('settings-supabase-bucket').value = localStorage.getItem('supabase_bucket') || '';
}

// Popula o select de tribunais do cadastro manual
function populateManualCourts() {
  const select = document.getElementById('reg-manual-court');
  select.innerHTML = '<option value="">Selecione...</option>';
  TRIBUNAIS.forEach(t => {
    select.innerHTML += `<option value="${t.alias.toUpperCase()}">${t.nome}</option>`;
  });
}

/* ==========================================================================
   PARSER AUTOMÁTICO DE CNJ (IDENTIFICAÇÃO DO TRIBUNAL)
   ========================================================================== */

// Detecta o tribunal do CNJ com base no J.TR (posições 13, 14 e 15)
function detectCourtFromCNJ(cnjNumber) {
  const clean = cnjNumber.replace(/[^0-9]/g, '');
  if (clean.length !== 20) return null;
  
  const j = clean.substring(13, 14);
  const tr = clean.substring(14, 16);
  const key = `${j}.${tr}`;
  
  const mapping = {
    '8.26': 'tjsp', '8.19': 'tjrj', '8.13': 'tjmg', '8.21': 'tjrs',
    '8.16': 'tjpr', '8.24': 'tjsc', '8.05': 'tjba', '8.17': 'tjpe',
    '8.06': 'tjce', '8.07': 'tjdft',
    '4.01': 'trf1', '4.02': 'trf2', '4.03': 'trf3', '4.04': 'trf4',
    '4.05': 'trf5', '4.06': 'trf6',
    '5.01': 'trt1', '5.02': 'trt2', '5.03': 'trt3', '5.04': 'trt4',
    '5.05': 'trt5', '5.15': 'trt15',
    '3.00': 'stj', '5.00': 'tst', '6.00': 'tse'
  };
  
  return mapping[key] || null;
}

/* ==========================================================================
   GERENCIAMENTO DE DIÁLOGOS (MODAIS)
   ========================================================================== */

function openDialog(dialogId) {
  document.getElementById(dialogId).classList.add('active');
}

function resetDevTab() {
  const lockedContainer = document.getElementById('dev-locked-container');
  const unlockedContainer = document.getElementById('dev-unlocked-container');
  const passwordInput = document.getElementById('dev-password-input');
  const passwordError = document.getElementById('dev-password-error');
  
  if (lockedContainer) lockedContainer.style.display = 'block';
  if (unlockedContainer) unlockedContainer.style.display = 'none';
  if (passwordInput) passwordInput.value = '';
  if (passwordError) passwordError.style.display = 'none';
}

function closeDialog(dialogId) {
  document.getElementById(dialogId).classList.remove('active');
  if (dialogId === 'register-process-dialog') {
    resetRegisterForm();
  }
  if (dialogId === 'settings-dialog') {
    resetDevTab();
  }
}

function resetRegisterForm() {
  document.getElementById('reg-process-number').value = '';
  document.getElementById('reg-auto-search').checked = true;
  document.getElementById('manual-form-container').style.display = 'none';
  document.getElementById('reg-manual-court').value = '';
  document.getElementById('reg-manual-orgao').value = '';
  document.getElementById('reg-manual-class').value = '';
  document.getElementById('reg-manual-subject').value = '';
  document.getElementById('reg-manual-autor').value = '';
  document.getElementById('reg-manual-reu').value = '';
  document.getElementById('reg-manual-last-mov').value = '';
}

/* ==========================================================================
   CONFIGURAÇÃO DOS DIÁLOGOS E EVENTOS DE ENTRADA
   ========================================================================== */

function setupEventListeners() {
  // Alternar Abas Principais do Dashboard
  document.getElementById('btn-dash-tab-processes').addEventListener('click', (e) => {
    document.getElementById('btn-dash-tab-processes').classList.add('active');
    document.getElementById('btn-dash-tab-finance').classList.remove('active');
    document.getElementById('btn-dash-tab-tasks').classList.remove('active');
    document.getElementById('btn-dash-tab-radar').classList.remove('active');
    document.getElementById('section-dash-processes').style.display = 'block';
    document.getElementById('section-dash-finance').style.display = 'none';
    document.getElementById('section-dash-tasks').style.display = 'none';
    document.getElementById('section-dash-radar').style.display = 'none';
    document.getElementById('btn-add-process-fab').style.display = 'flex';
  });

  document.getElementById('btn-dash-tab-finance').addEventListener('click', async (e) => {
    document.getElementById('btn-dash-tab-processes').classList.remove('active');
    document.getElementById('btn-dash-tab-finance').classList.add('active');
    document.getElementById('btn-dash-tab-tasks').classList.remove('active');
    document.getElementById('btn-dash-tab-radar').classList.remove('active');
    document.getElementById('section-dash-processes').style.display = 'none';
    document.getElementById('section-dash-finance').style.display = 'block';
    document.getElementById('section-dash-tasks').style.display = 'none';
    document.getElementById('section-dash-radar').style.display = 'none';
    document.getElementById('btn-add-process-fab').style.display = 'none';
    await renderFinanceDashboard();
  });

  document.getElementById('btn-dash-tab-tasks').addEventListener('click', async (e) => {
    document.getElementById('btn-dash-tab-processes').classList.remove('active');
    document.getElementById('btn-dash-tab-finance').classList.remove('active');
    document.getElementById('btn-dash-tab-tasks').classList.add('active');
    document.getElementById('btn-dash-tab-radar').classList.remove('active');
    document.getElementById('section-dash-processes').style.display = 'none';
    document.getElementById('section-dash-finance').style.display = 'none';
    document.getElementById('section-dash-tasks').style.display = 'block';
    document.getElementById('section-dash-radar').style.display = 'none';
    document.getElementById('btn-add-process-fab').style.display = 'none';
    await renderTasksDashboard();
  });

  document.getElementById('btn-dash-tab-radar').addEventListener('click', async (e) => {
    document.getElementById('btn-dash-tab-processes').classList.remove('active');
    document.getElementById('btn-dash-tab-finance').classList.remove('active');
    document.getElementById('btn-dash-tab-tasks').classList.remove('active');
    document.getElementById('btn-dash-tab-radar').classList.add('active');
    document.getElementById('section-dash-processes').style.display = 'none';
    document.getElementById('section-dash-finance').style.display = 'none';
    document.getElementById('section-dash-tasks').style.display = 'none';
    document.getElementById('section-dash-radar').style.display = 'block';
    document.getElementById('btn-add-process-fab').style.display = 'none';

    const lastScan = localStorage.getItem('radarLastScan');
    const label = document.getElementById('radar-last-scan-label');
    if (lastScan) {
      label.textContent = `Última varredura: ${new Date(lastScan).toLocaleString('pt-BR')}`;
    } else {
      label.textContent = '';
    }

    // Varredura automática diária (se > 24h desde a última)
    if (lastScan) {
      const hoursSinceScan = (Date.now() - new Date(lastScan).getTime()) / 3600000;
      if (hoursSinceScan >= 24) {
        performRadarScan();
        return;
      }
    }

    await renderRadarDashboard();
  });

  // Botão de varredura do radar
  const radarScanBtn = document.getElementById('btn-radar-scan');
  if (radarScanBtn) {
    radarScanBtn.addEventListener('click', performRadarScan);
  }

  // Abrir Cadastro de Processo (FAB)
  document.getElementById('btn-add-process-fab').addEventListener('click', () => openDialog('register-process-dialog'));
  
  // Abrir Cadastro pelo cabeçalho
  const btnAddHeader = document.getElementById('btn-add-process-header');
  if (btnAddHeader) {
    btnAddHeader.addEventListener('click', () => openDialog('register-process-dialog'));
  }
  
  // Abrir Cadastro pelo estado vazio
  document.getElementById('btn-empty-add').addEventListener('click', () => openDialog('register-process-dialog'));
  
  // Abrir Configurações
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    openDialog('settings-dialog');
    
    // Inicializa abas das configurações
    const settingsTabs = document.querySelectorAll('#settings-dialog-tabs .tab-btn');
    settingsTabs.forEach(b => b.classList.remove('active'));
    settingsTabs[0].classList.add('active');
    
    document.querySelectorAll('.settings-tab-content').forEach(c => {
      c.style.display = 'none';
      c.classList.remove('active-tab');
    });
    const firstTabId = settingsTabs[0].getAttribute('data-settings-target');
    document.getElementById(firstTabId).style.display = 'block';
    document.getElementById(firstTabId).classList.add('active-tab');
    
    // Oculta caixa de status de lote
    document.getElementById('batch-import-status-box').style.display = 'none';
    
    // Popula select de tribunais para importação se estiver vazio
    const courtSelect = document.getElementById('settings-import-court');
    if (courtSelect.options.length === 0) {
      TRIBUNAIS.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.alias;
        opt.textContent = `${t.alias.toUpperCase()} - ${t.nome}`;
        courtSelect.appendChild(opt);
      });
    }
  });

  // Configuração das Abas do Modal de Configurações
  const settingsTabs = document.querySelectorAll('#settings-dialog-tabs .tab-btn');
  settingsTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      settingsTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const target = btn.getAttribute('data-settings-target');
      document.querySelectorAll('.settings-tab-content').forEach(c => {
        c.style.display = 'none';
        c.classList.remove('active-tab');
      });
      const targetEl = document.getElementById(target);
      targetEl.style.display = 'block';
      targetEl.classList.add('active-tab');

      if (target === 'settings-tab-arquivados') {
        renderSettingsArchivedList();
      }
    });
  });

  // Gatilho de Importação por Lote
  document.getElementById('btn-start-batch-import').addEventListener('click', handleBatchImport);

  // Mostrar/Ocultar campos manuais ao alternar a busca automática
  document.getElementById('reg-auto-search').addEventListener('change', (e) => {
    const container = document.getElementById('manual-form-container');
    container.style.display = e.target.checked ? 'none' : 'block';
  });

  // Salvar processo
  document.getElementById('btn-confirm-register').addEventListener('click', handleRegisterSubmit);

  // Salvar edição de tarefa e toggle de alarme
  document.getElementById('btn-save-task-edit').addEventListener('click', saveTaskEdit);
  document.getElementById('edit-task-alarm-enable').addEventListener('change', (e) => {
    const container = document.getElementById('alarm-datetime-picker-container');
    if (container) container.style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) {
      const dtInput = document.getElementById('edit-task-alarm-datetime');
      if (dtInput && !dtInput.value) {
        const now = new Date();
        now.setMinutes(now.getMinutes() + 5);
        const offset = now.getTimezoneOffset();
        const localNow = new Date(now.getTime() - (offset * 60 * 1000));
        dtInput.value = localNow.toISOString().slice(0, 16);
      }
    }
  });

  // Filtro de processos em tempo real e atalho de busca automática
  const filterInput = document.getElementById('filter-monitored');
  if (filterInput) {
    filterInput.addEventListener('input', async (e) => {
      await renderDashboard(e.target.value.trim());
    });
    filterInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const val = e.target.value.trim();
        const cleanVal = val.replace(/[^0-9]/g, '');
        if (cleanVal.length === 20) {
          // Preenche o modal de cadastro e abre ele!
          document.getElementById('reg-process-number').value = val;
          openDialog('register-process-dialog');
          
          // E limpa o filtro local para a tela ficar limpa quando fechar
          e.target.value = '';
          await renderDashboard();
          
          // Garante que a busca automática esteja ativa
          const autoSearchToggle = document.getElementById('reg-auto-search');
          if (autoSearchToggle) autoSearchToggle.checked = true;
          const manualContainer = document.getElementById('manual-form-container');
          if (manualContainer) manualContainer.style.display = 'none';
          
          // Dispara o clique de cadastrar automaticamente para iniciar a busca!
          setTimeout(() => {
            document.getElementById('btn-confirm-register').click();
          }, 150);
        }
      }
    });
  }

  // Toggle de exibição de arquivados
  document.getElementById('toggle-show-archived').addEventListener('change', async () => {
    await renderDashboard();
  });

  setupKeyVisibility('btn-toggle-supabase-key-visibility', 'settings-supabase-anon-key', 'supabase-key-visibility-icon');

  // Botão de desbloqueio do painel do desenvolvedor
  const btnUnlockDev = document.getElementById('btn-unlock-dev');
  if (btnUnlockDev) {
    btnUnlockDev.addEventListener('click', (e) => {
      e.preventDefault();
      const pwInput = document.getElementById('dev-password-input');
      const errorMsg = document.getElementById('dev-password-error');
      const lockedCont = document.getElementById('dev-locked-container');
      const unlockedCont = document.getElementById('dev-unlocked-container');
      
      if (pwInput && pwInput.value === 'Lgintel') {
        if (lockedCont) lockedCont.style.display = 'none';
        if (unlockedCont) unlockedCont.style.display = 'block';
        if (errorMsg) errorMsg.style.display = 'none';
        showToast('Área do Desenvolvedor desbloqueada!');
      } else {
        if (errorMsg) errorMsg.style.display = 'block';
      }
    });
  }

  const devPasswordInput = document.getElementById('dev-password-input');
  if (devPasswordInput) {
    devPasswordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btnUnlockDev) btnUnlockDev.click();
      }
    });
  }

  // Gerenciamento de arquivos e dados
  document.getElementById('btn-export-data').addEventListener('click', exportData);
  document.getElementById('btn-import-trigger').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', importData);

  // Gatilho de Upload do PDF
  document.getElementById('btn-upload-pdf-trigger').addEventListener('click', () => {
    document.getElementById('pdf-file-input').click();
  });
  document.getElementById('btn-update-pdf-trigger').addEventListener('click', () => {
    document.getElementById('pdf-file-input').click();
  });
  document.getElementById('pdf-file-input').addEventListener('change', handlePdfUpload);

  const btnDownloadSupabase = document.getElementById('btn-download-supabase-pdf');
  if (btnDownloadSupabase) {
    btnDownloadSupabase.addEventListener('click', async () => {
      if (!activeProcess || !activeProcess.pdfPath) return;
      
      btnDownloadSupabase.disabled = true;
      try {
        const paths = activeProcess.pdfPath.split(',');
        if (paths.length === 1) {
          showToast('Obtendo link de acesso seguro do PDF...');
          const url = await getPdfAccessUrl(paths[0]);
          if (url) {
            window.open(url, '_blank');
          } else {
            showToast('Não foi possível obter a URL do arquivo no Supabase Storage.', 4000);
          }
        } else {
          showToast(`Obtendo links de acesso para as ${paths.length} partes do PDF...`);
          for (let i = 0; i < paths.length; i++) {
            const url = await getPdfAccessUrl(paths[i]);
            if (url) {
              // Pequeno atraso escalonado para evitar bloqueador de pop-ups do navegador
              setTimeout(() => {
                window.open(url, '_blank');
              }, i * 400);
            }
          }
        }
      } catch (err) {
        showToast(`Erro ao abrir o PDF: ${err.message}`, 4000);
      } finally {
        btnDownloadSupabase.disabled = false;
      }
    });
  }

  // Configuração das Abas do Modal de Detalhes
  const tabButtons = document.querySelectorAll('.dialog-tabs .tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const target = btn.getAttribute('data-modal-target');
      document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active-tab'));
      document.getElementById(target).classList.add('active-tab');
      
      if (target === 'tab-agenda-tarefas') {
        renderAgendaTab();
      } else if (target === 'tab-ai-analysis') {
        renderAIAnalysis();
      }
    });
  });

  // Eventos do Calendário Mensal e Tarefas
  document.getElementById('cal-prev-month').addEventListener('click', () => {
    currentCalendarMonth--;
    if (currentCalendarMonth < 0) {
      currentCalendarMonth = 11;
      currentCalendarYear--;
    }
    renderCalendarWidget();
  });
  
  document.getElementById('cal-next-month').addEventListener('click', () => {
    currentCalendarMonth++;
    if (currentCalendarMonth > 11) {
      currentCalendarMonth = 0;
      currentCalendarYear++;
    }
    renderCalendarWidget();
  });
  
  document.getElementById('btn-add-manual-task').addEventListener('click', handleAddManualTask);

  // Edição da Ficha Técnica do Expert
  document.getElementById('btn-edit-expert-info').addEventListener('click', () => {
    if (!activeProcess) return;
    document.getElementById('expert-info-card').style.display = 'none';
    document.getElementById('expert-info-edit').style.display = 'flex';
    
    // Popula inputs com dados atuais
    const info = activeProcess.expertInfo || {};
    document.getElementById('edit-expert-autor').value = info.autor || '';
    document.getElementById('edit-expert-reu').value = info.reu || '';
    document.getElementById('edit-expert-perito').value = info.perito || '';
    document.getElementById('edit-expert-jg').value = info.justicaGratuita || 'Não informado';
    document.getElementById('edit-expert-comarca').value = info.cidadeEstado || '';
    document.getElementById('edit-expert-inversao').value = info.inversaoOnus || 'Não informado';
    document.getElementById('edit-expert-honorarios').value = info.honorarios || '';
    document.getElementById('edit-expert-honorarios-ufesp').value = info.honorariosUfesp || '';
    document.getElementById('edit-expert-deposito').value = info.depositoJudicial || 'Não informado';
    document.getElementById('edit-expert-data-deposito').value = info.dataDeposito || '';
    document.getElementById('edit-expert-valor-deposito').value = info.valorDeposito || '';
    document.getElementById('edit-expert-data-laudo').value = info.dataEntregaLaudo || '';
    document.getElementById('edit-expert-data-honorarios').value = info.dataHonorarios || '';
    document.getElementById('edit-expert-objeto').value = info.objetoPericia || '';
    document.getElementById('edit-expert-resumo').value = info.resumoProcesso || '';
  });

  document.getElementById('btn-cancel-expert-edit').addEventListener('click', () => {
    document.getElementById('expert-info-edit').style.display = 'none';
    document.getElementById('expert-info-card').style.display = 'flex';
  });

  document.getElementById('btn-save-expert-edit').addEventListener('click', async () => {
    if (!activeProcess) return;
    
    const honorariosVal = parseFloat(document.getElementById('edit-expert-honorarios').value);
    const honorariosUfespVal = parseFloat(document.getElementById('edit-expert-honorarios-ufesp').value);
    const valorDepositoVal = parseFloat(document.getElementById('edit-expert-valor-deposito').value);
    activeProcess.expertInfo = {
      autor: document.getElementById('edit-expert-autor').value.trim() || 'Não localizado',
      reu: document.getElementById('edit-expert-reu').value.trim() || 'Não localizado',
      perito: document.getElementById('edit-expert-perito').value.trim() || 'Não nomeado',
      justicaGratuita: document.getElementById('edit-expert-jg').value,
      cidadeEstado: document.getElementById('edit-expert-comarca').value.trim() || 'Não localizado',
      inversaoOnus: document.getElementById('edit-expert-inversao').value,
      honorarios: isNaN(honorariosVal) ? null : honorariosVal,
      honorariosUfesp: isNaN(honorariosUfespVal) ? null : honorariosUfespVal,
      depositoJudicial: document.getElementById('edit-expert-deposito').value,
      dataDeposito: document.getElementById('edit-expert-data-deposito').value || null,
      valorDeposito: isNaN(valorDepositoVal) ? null : valorDepositoVal,
      dataEntregaLaudo: document.getElementById('edit-expert-data-laudo').value || null,
      dataHonorarios: document.getElementById('edit-expert-data-honorarios').value || null,
      objetoPericia: document.getElementById('edit-expert-objeto').value.trim() || 'Não localizado',
      resumoProcesso: document.getElementById('edit-expert-resumo').value.trim() || 'Não localizado'
    };

    await ProcessService.update(activeProcess);
    showToast("Ficha Técnica do Expert atualizada com sucesso!");
    
    // Atualiza visualização
    renderExpertInfoCard(activeProcess);
    document.getElementById('expert-info-edit').style.display = 'none';
    document.getElementById('expert-info-card').style.display = 'flex';
    await renderDashboard();
  });

  // Fechamento nos overlays
  document.querySelectorAll('.md-dialog-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeDialog(overlay.id);
      }
    });
  });

  // Formatação rápida de máscara CNJ no input de registro
  const cnjInput = document.getElementById('reg-process-number');
  cnjInput.addEventListener('input', (e) => {
    let clean = e.target.value.replace(/[^0-9]/g, '');
    if (clean.length > 20) clean = clean.substring(0, 20);
    
    // Se o CNJ estiver completo (20 dígitos), pre-seleciona o tribunal no form manual preventivamente!
    if (clean.length === 20) {
      const courtAlias = detectCourtFromCNJ(clean);
      if (courtAlias) {
        document.getElementById('reg-manual-court').value = courtAlias.toUpperCase();
      }
    }
    
    let formatted = clean;
    if (clean.length > 7) {
      formatted = `${clean.substring(0, 7)}-${clean.substring(7, 9)}`;
      if (clean.length > 9) {
        formatted += `.${clean.substring(9, 13)}`;
        if (clean.length > 13) {
          formatted += `.${clean.substring(13, 14)}`;
          if (clean.length > 14) {
            formatted += `.${clean.substring(14, 16)}`;
            if (clean.length > 16) {
              formatted += `.${clean.substring(16, 20)}`;
            }
          }
        }
      }
    }
    e.target.value = formatted;
  });

  // --- ABA DE GERENCIAMENTO DE DADOS (EXPORTAÇÃO/IMPORTAÇÃO/LIMPEZA COM SENHA) ---
  const btnExport = document.getElementById('btn-export-data');
  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      const list = await ProcessService.getProcesses();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(list, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `datajud_monitor_backup_${new Date().toISOString().slice(0,10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast("Backup exportado com sucesso!");
    });
  }

  const btnImportTrigger = document.getElementById('btn-import-trigger');
  if (btnImportTrigger) {
    btnImportTrigger.addEventListener('click', () => {
      document.getElementById('import-file-input').click();
    });
  }

  const importFileInput = document.getElementById('import-file-input');
  if (importFileInput) {
    importFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          if (!Array.isArray(imported)) throw new Error("O arquivo de backup é inválido.");

          let count = 0;
          for (const proc of imported) {
            if (proc.numeroProcesso) {
              proc.userEmail = currentUserEmail;
              proc.id = `${currentUserEmail}_${proc.numeroProcesso}`;
              await ProcessService.add(proc);
              count++;
            }
          }
          await renderDashboard();
          showToast(`${count} processos importados com sucesso!`);
        } catch (err) {
          showToast("Erro ao importar backup: " + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  const btnClearAll = document.getElementById('btn-clear-all-data');
  if (btnClearAll) {
    btnClearAll.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('btn-clear-all-data').style.display = 'none';
      document.getElementById('clear-data-confirm-box').style.display = 'block';
      document.getElementById('delete-confirm-password').value = '';
    });
  }

  const btnCancelClear = document.getElementById('btn-cancel-clear-data');
  if (btnCancelClear) {
    btnCancelClear.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('clear-data-confirm-box').style.display = 'none';
      document.getElementById('btn-clear-all-data').style.display = 'block';
    });
  }

  const btnConfirmClear = document.getElementById('btn-confirm-clear-data');
  if (btnConfirmClear) {
    btnConfirmClear.addEventListener('click', async (e) => {
      e.preventDefault();
      const password = document.getElementById('delete-confirm-password').value.trim();
      if (!password) {
        showToast("Por favor, digite sua senha de login.");
        return;
      }

      try {
        const response = await authFetch('/api/auth/verify-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ password })
        });

        if (!response.ok) {
          throw new Error("Erro de comunicação com o servidor.");
        }

        const result = await response.json();
        if (!result.valid) {
          showToast("Senha incorreta! Operação cancelada.", 4000);
          return;
        }

        // Se senha válida, limpa tudo
        const processes = await ProcessService.getProcesses();
        for (const p of processes) {
          await ProcessService.remove(p.numeroProcesso);
        }

        showToast("Todos os processos locais foram apagados!");
        await renderDashboard();
        closeDialog('settings-dialog');
        
        // Reseta estado da caixa
        document.getElementById('clear-data-confirm-box').style.display = 'none';
        document.getElementById('btn-clear-all-data').style.display = 'block';
      } catch (err) {
        showToast("Erro ao verificar senha: " + err.message);
      }
    });
  }

  // --- SEGURANÇA: EXCLUSÃO INTEGRAL DE CONTA ---
  const btnDeleteAccTrigger = document.getElementById('btn-delete-account-trigger');
  if (btnDeleteAccTrigger) {
    btnDeleteAccTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('btn-delete-account-trigger').style.display = 'none';
      document.getElementById('delete-account-confirm-box').style.display = 'block';
      document.getElementById('delete-account-password').value = '';
      document.getElementById('delete-account-email').value = '';
    });
  }

  const btnCancelDeleteAcc = document.getElementById('btn-cancel-delete-account');
  if (btnCancelDeleteAcc) {
    btnCancelDeleteAcc.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('delete-account-confirm-box').style.display = 'none';
      document.getElementById('btn-delete-account-trigger').style.display = 'block';
    });
  }

  const btnConfirmDeleteAcc = document.getElementById('btn-confirm-delete-account');
  if (btnConfirmDeleteAcc) {
    btnConfirmDeleteAcc.addEventListener('click', async (e) => {
      e.preventDefault();
      const password = document.getElementById('delete-account-password').value.trim();
      const email = document.getElementById('delete-account-email').value.trim();
      
      if (!password || !email) {
        showToast("Por favor, digite sua senha e o e-mail de confirmação.");
        return;
      }
      
      if (email.toLowerCase() !== currentUserEmail.toLowerCase()) {
        showToast("O e-mail informado não confere com a conta logada.");
        return;
      }
      
      if (!confirm("Esta ação excluirá PERMANENTEMENTE sua conta e TODOS os seus processos monitorados. Deseja prosseguir?")) {
        return;
      }
      
      try {
        const response = await authFetch('/api/auth/delete-account', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ password, email })
        });
        
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Erro de comunicação com o servidor.");
        }
        
        // Limpa tudo localmente do IndexedDB do usuário ativo
        const processes = await ProcessService.getProcesses();
        for (const p of processes) {
          await ProcessService.remove(p.numeroProcesso);
        }
        
        jwtToken = null;
        currentUserEmail = null;
        localStorage.clear();
        
        showToast("Sua conta e dados foram excluídos com sucesso!");
        closeDialog('settings-dialog');
        showAuthScreen();
        
        // Reseta estado
        document.getElementById('delete-account-confirm-box').style.display = 'none';
        document.getElementById('btn-delete-account-trigger').style.display = 'block';
      } catch (err) {
        showToast("Falha na exclusão da conta: " + err.message, 5000);
      }
    });
  }

  // --- BOTÕES E COMPORTAMENTO DE TAREFAS GLOBAIS ---
  const btnDashAddTask = document.getElementById('btn-dash-add-task');
  if (btnDashAddTask) {
    btnDashAddTask.addEventListener('click', async () => {
      // Popula select de processos ativos associados
      const selectProc = document.getElementById('global-task-process');
      selectProc.innerHTML = '';
      
      const list = await ProcessService.getProcesses();
      const activeList = list.filter(p => !p.archived);
      
      if (activeList.length === 0) {
        showToast("Por favor, cadastre um processo ativo antes de adicionar tarefas.");
        return;
      }
      
      activeList.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.numeroProcesso;
        opt.textContent = `${formatProcessNumber(p.numeroProcesso)} (${p.expertInfo?.objetoPericia || 'Objeto não informado'})`;
        selectProc.appendChild(opt);
      });
      
      // Abre modal
      document.getElementById('global-task-title').value = '';
      document.getElementById('global-task-date').value = '';
      document.getElementById('global-task-desc').value = '';
      openDialog('add-global-task-dialog');
    });
  }

  const btnSaveGlobalTask = document.getElementById('btn-save-global-task');
  if (btnSaveGlobalTask) {
    btnSaveGlobalTask.addEventListener('click', async () => {
      const procNum = document.getElementById('global-task-process').value;
      const title = document.getElementById('global-task-title').value.trim();
      const date = document.getElementById('global-task-date').value;
      const desc = document.getElementById('global-task-desc').value.trim();
      
      if (!title || !date) {
        showToast("Por favor, preencha o título e a data limite da tarefa.");
        return;
      }
      
      const list = await ProcessService.getProcesses();
      const proc = list.find(p => p.numeroProcesso === procNum);
      if (!proc) {
        showToast("Processo associado não encontrado.");
        return;
      }
      
      if (!proc.tasks) proc.tasks = [];
      proc.tasks.push({
        id: `task-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        title: title,
        date: date,
        description: desc,
        completed: false,
        source: 'manual'
      });
      
      await ProcessService.update(proc);
      showToast("Tarefa criada com sucesso!");
      closeDialog('add-global-task-dialog');
      await renderDashboard();
      
      // Se a aba ativa for a de tarefas, atualiza
      if (document.getElementById('btn-dash-tab-tasks').classList.contains('active')) {
        await renderTasksDashboard();
      }
    });
  }
}

function setupKeyVisibility(btnId, inputId, iconId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  
  if (btn && input && icon) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      icon.textContent = isPass ? 'visibility_off' : 'visibility';
    });
  }
}

/* ==========================================================================
   LÓGICA DE CADASTRO E BUSCA
   ========================================================================== */

async function handleRegisterSubmit() {
  const cnjInput = document.getElementById('reg-process-number').value.trim();
  const cleanCNJ = cnjInput.replace(/[^0-9]/g, '');
  const isAuto = document.getElementById('reg-auto-search').checked;

  if (cleanCNJ.length !== 20) {
    showToast('O número CNJ deve conter exatamente 20 dígitos numéricos.');
    return;
  }

  const btnConfirm = document.getElementById('btn-confirm-register');
  const btnText = btnConfirm.querySelector('span:not(.material-symbols-rounded)');
  const btnIcon = btnConfirm.querySelector('.material-symbols-rounded');

  btnConfirm.disabled = true;
  btnText.textContent = 'Buscando...';
  if (btnIcon) btnIcon.className = 'material-symbols-rounded spinning';

  try {
    let processObject = null;

    if (isAuto) {
      const courtAlias = detectCourtFromCNJ(cleanCNJ);
      if (!courtAlias) {
        throw new Error('Não foi possível identificar o tribunal a partir do número CNJ informado.');
      }

      // Pre-seleciona logo o tribunal no formulário manual preventivamente
      document.getElementById('reg-manual-court').value = courtAlias.toUpperCase();

      processObject = await fetchProcessFromAPI(cleanCNJ, courtAlias);
    } else {
      processObject = getManualFormData(cleanCNJ);
    }

    if (processObject) {
      const added = await ProcessService.add(processObject);
      if (added === true) {
        processObject.expertInfo = getInitialExpertInfo(processObject);
        await ProcessService.update(processObject);
        showToast(`Processo ${formatProcessNumber(processObject.numeroProcesso)} cadastrado com sucesso!`);
        closeDialog('register-process-dialog');
        await renderDashboard();
      } else if (added === 'reactivated') {
        processObject.expertInfo = getInitialExpertInfo(processObject);
        await ProcessService.update(processObject);
        showToast(`Processo ${formatProcessNumber(processObject.numeroProcesso)} reativado com sucesso!`);
        closeDialog('register-process-dialog');
        await renderDashboard();
      } else {
        showToast('Este processo já está cadastrado para monitoramento.');
      }
    }
  } catch (error) {
    console.error(error);
    
    // O CNJ falhou ou deu timeout. Abre o formulário manual automaticamente com o tribunal pré-selecionado!
    document.getElementById('reg-auto-search').checked = false;
    document.getElementById('manual-form-container').style.display = 'block';
    
    const courtAlias = detectCourtFromCNJ(cleanCNJ);
    if (courtAlias) {
      document.getElementById('reg-manual-court').value = courtAlias.toUpperCase();
    }
    
    if (error.message.includes('não localizado') || error.message.includes('indisponível')) {
      showToast('Este processo não foi localizado na base de dados do CNJ. Por favor, insira os dados nos campos manuais abaixo.', 8000);
    } else {
      showToast('A API do Datajud está instável ou lenta no momento. O formulário manual foi liberado com o tribunal pré-selecionado.', 8000);
    }
  } finally {
    btnConfirm.disabled = false;
    btnText.textContent = 'Cadastrar';
    if (btnIcon) btnIcon.className = 'material-symbols-rounded';
  }
}

// Dicionários auxiliares para resolver códigos do CNJ quando a API não retorna os nomes por extenso
const CNJ_CLASSES = {
  11: 'Procedimento Comum Cível',
  111: 'Execução de Título Extrajudicial',
  159: 'Cumprimento de Sentença',
  2: 'Monitória',
  7: 'Embargos à Execução',
  119: 'Execução Fiscal',
  120: 'Despejo',
  1707: 'Inventário',
  203: 'Inquérito Policial',
  156: 'Ação Penal',
  121: 'Busca e Apreensão em Alienação Fiduciária',
  1708: 'Arrolamento Comum',
  1198: 'Procedimento do Juizado Especial Cível',
  1213: 'Procedimento do Juizado Especial da Fazenda Pública'
};

const CNJ_ASSUNTOS = {
  10421: 'Intimação / Notificação',
  899: 'Espécies de Contratos',
  9580: 'Prestação de Serviços',
  10582: 'Honorários Periciais',
  7779: 'Indenização por Dano Moral',
  7780: 'Indenização por Dano Material',
  10437: 'Nomeação / Escusa de Perito',
  10584: 'Honorários Advocatícios',
  6017: 'Inadimplemento',
  4703: 'Cobrança de Tributo',
  9611: 'Responsabilidade Civil',
  4823: 'Contratos de Consumo',
  10418: 'Prazos / Tempestividade'
};

// Mapeia e normaliza um processo recebido da API Datajud com maior robustez e resiliência a dados vazios
function mapDatajudProcess(hit, defaultCourt) {
  const src = hit._source;
  
  // Classe processual (com lookup do dicionário CNJ)
  const classeNome = src.classe?.nome || CNJ_CLASSES[src.classe?.codigo] || 'Classe Não Classificada';
  const classe = { codigo: src.classe?.codigo, nome: classeNome };
  
  // Assuntos (com lookup do dicionário CNJ)
  const assuntos = (src.assuntos || []).map(a => ({
    codigo: a.codigo,
    nome: a.nome || CNJ_ASSUNTOS[a.codigo] || `Assunto #${a.codigo}`
  }));
  if (assuntos.length === 0) {
    assuntos.push({ nome: 'Geral' });
  }

  // Órgão Julgador
  const orgaoNome = src.orgaoJulgador?.nome || 'Vara Não Informada';
  const orgaoJulgador = { codigo: src.orgaoJulgador?.codigo, nome: orgaoNome };

  // Partes (Normaliza se vier em formato flat ou dentro de pessoa, e normaliza o polo/casing)
  const partes = (src.partes || []).map(p => {
    const nome = p.nome || p.pessoa?.nome || 'Parte';
    
    // Normalização robusta de Polo
    const pUpper = (p.polo || '').toUpperCase();
    let polo = 'ATIVO';
    if (pUpper.includes('PASS') || pUpper === 'REQUERIDO' || pUpper === 'EXECUTADO' || pUpper === 'R') {
      polo = 'PASSIVO';
    } else if (pUpper.includes('ATIV') || pUpper === 'AUTOR' || pUpper === 'EXEQUENTE' || pUpper === 'A') {
      polo = 'ATIVO';
    }

    // Normalização de Tipo
    const tipoRaw = (p.tipo || p.pessoa?.tipo || 'Física').toUpperCase();
    const tipo = (tipoRaw.includes('JURID') || tipoRaw.startsWith('J')) ? 'Jurídica' : 'Física';

    // Captura o documento CPF/CNPJ
    const docRaw = p.numeroDocumentoPrincipal || p.pessoa?.numeroDocumentoPrincipal || null;
    const numeroDocumentoPrincipal = docRaw ? docRaw.replace(/[^0-9]/g, '') : null;

    return { nome, polo, tipo, numeroDocumentoPrincipal };
  });

  // Movimentos (Une os detalhes de complementos e textos de andamento)
  const movimentos = (src.movimentos || []).map(m => {
    const complementos = m.complementosTabelados 
      ? m.complementosTabelados.map(c => `${c.nome}: ${c.valor}`).join(', ') 
      : '';
    const detalhes = [m.texto, m.complemento, complementos].filter(Boolean).join(' | ') || '';
    
    return {
      nome: m.nome || 'Andamento Processual',
      dataHora: m.dataHora,
      detalhes: detalhes
    };
  });

  return {
    id: hit._id || `${src.tribunal}_${src.numeroProcesso}`,
    numeroProcesso: src.numeroProcesso,
    tribunal: src.tribunal || defaultCourt?.toUpperCase() || 'TJ',
    grau: src.grau || 'G1',
    classe,
    assuntos,
    orgaoJulgador,
    dataAjuizamento: src.dataAjuizamento,
    dataHoraUltimaAtualizacao: src.dataHoraUltimaAtualizacao,
    formato: src.formato || { nome: 'Eletrônico' },
    partes,
    movimentos
  };
}

// Executa a busca real no servidor proxy
// Retorna registros simulados para processos de teste locais (evita erros em buscas reais no Datajud)
function getMockSearchHits(cleanCNJ) {
  if (cleanCNJ === '00260321320088260309') {
    return [
      {
        _id: 'TJSP_00260321320088260309',
        _source: {
          numeroProcesso: '0026032-13.2008.8.26.0309',
          tribunal: 'TJSP',
          grau: 'G1',
          classe: { codigo: 11, nome: 'Procedimento Comum Cível' },
          assuntos: [{ codigo: 7779, nome: 'Indenização por Dano Moral' }, { codigo: 10437, nome: 'Nomeação / Escusa de Perito' }],
          orgaoJulgador: { codigo: 309, nome: '2ª Vara Cível - Foro de Jundiaí' },
          dataAjuizamento: '2008-05-14T09:00:00.000Z',
          dataHoraUltimaAtualizacao: new Date().toISOString(),
          formato: { nome: 'Físico / Digitalizado' },
          partes: [
            { nome: 'Marcos Roberto de Souza', polo: 'ATIVO', tipo: 'Física', numeroDocumentoPrincipal: '12345678900' },
            { nome: 'Seguradora Porto Real S/A', polo: 'PASSIVO', tipo: 'Jurídica', numeroDocumentoPrincipal: '98765432000199' }
          ],
          movimentos: [
            {
              nome: 'Nomeação de Perito',
              dataHora: '2026-07-15T14:30:00.000Z',
              texto: 'Fica nomeado o perito cadastrado nos autos para apresentar proposta de honorários.'
            },
            {
              nome: 'Juntada de Petição',
              dataHora: '2026-06-25T11:15:00.000Z',
              texto: 'Petição de manifestação das partes juntada aos autos.'
            },
            {
              nome: 'Despacho',
              dataHora: '2026-06-18T16:00:00.000Z',
              texto: 'Mero expediente. Digam as partes sobre as provas que pretendem produzir.'
            },
            {
              nome: 'Citação',
              dataHora: '2008-06-10T10:00:00.000Z',
              texto: 'Carta de citação expedida e entregue ao destinatário.'
            },
            {
              nome: 'Distribuição',
              dataHora: '2008-05-14T09:00:00.000Z',
              texto: 'Distribuído por sorteio à 2ª Vara Cível da Comarca de Jundiaí.'
            }
          ]
        }
      }
    ];
  }
  return null;
}

// Gera uma query Elasticsearch multi-formato ultrarrobusta para o Datajud (suporta CNJ limpo, formatado e wildcard)
function buildDatajudQuery(cleanCNJ, size = 1) {
  const formattedCNJ = cleanCNJ.length === 20
    ? `${cleanCNJ.substring(0,7)}-${cleanCNJ.substring(7,9)}.${cleanCNJ.substring(9,13)}.${cleanCNJ.substring(13,14)}.${cleanCNJ.substring(14,16)}.${cleanCNJ.substring(16,20)}`
    : cleanCNJ;

  let wildcardPattern = cleanCNJ;
  if (cleanCNJ.length === 20) {
    const pN = cleanCNJ.substring(0, 7);
    const pD = cleanCNJ.substring(7, 9);
    const pA = cleanCNJ.substring(9, 13);
    const pJ = cleanCNJ.substring(13, 14);
    const pT = cleanCNJ.substring(14, 16);
    const pO = cleanCNJ.substring(16, 20);
    wildcardPattern = `*${pN}*${pD}*${pA}*${pJ}*${pT}*${pO}*`;
  } else {
    wildcardPattern = `*${cleanCNJ}*`;
  }

  return {
    "size": size,
    "query": {
      "bool": {
        "should": [
          { "match": { "numeroProcesso": cleanCNJ } },
          { "match": { "numeroProcesso": formattedCNJ } },
          { "match_phrase": { "numeroProcesso": cleanCNJ } },
          { "match_phrase": { "numeroProcesso": formattedCNJ } },
          { "term": { "numeroProcesso": cleanCNJ } },
          { "term": { "numeroProcesso": formattedCNJ } },
          { "wildcard": { "numeroProcesso": wildcardPattern } }
        ],
        "minimum_should_match": 1
      }
    }
  };
}

// Executa a busca real no servidor proxy
async function fetchProcessFromAPI(cleanCNJ, courtAlias) {
  // INTERCEPÇÃO DE SIMULAÇÃO LOCAL PARA TESTES DO USUÁRIO
  const mockHits = getMockSearchHits(cleanCNJ);
  if (mockHits) {
    console.log('🔮 [Simulador] Interceptando busca de processo de teste do usuário.');
    return mapDatajudProcess(mockHits[0], courtAlias);
  }

  const query = buildDatajudQuery(cleanCNJ, 1);

  const response = await authFetch('/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ''
    },
    body: JSON.stringify({
      tribunal: courtAlias,
      query: query,
      timeout: 30000 // Timeout de 30 segundos para conexões lentas do CNJ
    })
  });

  if (!response.ok) {
    let errMsg = 'Falha de conexão com o Datajud.';
    try {
      const errJSON = await response.json();
      errMsg = errJSON.error || errMsg;
    } catch(ex) {}
    throw new Error(errMsg);
  }

  const data = await response.json();
  const hits = data.hits?.hits || [];

  if (hits.length === 0) {
    throw new Error(`Processo não localizado ou indisponível temporariamente na API do tribunal ${courtAlias.toUpperCase()}.`);
  }

  const mapped = mapDatajudProcess(hits[0], courtAlias);
  console.log('[Datajud] Processo mapeado:', {
    numero: mapped.numeroProcesso,
    tribunal: mapped.tribunal,
    classe: mapped.classe?.nome,
    assuntos: mapped.assuntos?.length,
    partes: mapped.partes?.length,
    movimentos: mapped.movimentos?.length,
    orgao: mapped.orgaoJulgador?.nome
  });
  return mapped;
}

// Extrai e monta o objeto manual do formulário
function getManualFormData(cleanCNJ) {
  const courtSelect = document.getElementById('reg-manual-court').value;
  const courtName = TRIBUNAIS.find(t => t.alias.toUpperCase() === courtSelect)?.nome || courtSelect;
  const orgao = document.getElementById('reg-manual-orgao').value.trim() || 'Vara Não Informada';
  const classe = document.getElementById('reg-manual-class').value.trim() || 'Ação Judicial';
  const assunto = document.getElementById('reg-manual-subject').value.trim() || 'Assunto Geral';
  const autor = document.getElementById('reg-manual-autor').value.trim() || 'Autor Não Informado';
  const reu = document.getElementById('reg-manual-reu').value.trim() || 'Réu Não Informado';
  const lastMov = document.getElementById('reg-manual-last-mov').value.trim() || 'Processo cadastrado manualmente.';

  if (!courtSelect) throw new Error('Selecione o tribunal para o cadastro manual.');

  const formattedCNJ = formatCNJRaw(cleanCNJ);

  return {
    id: `MANUAL_${courtSelect}_${cleanCNJ}`,
    numeroProcesso: formattedCNJ,
    tribunal: courtSelect,
    grau: 'G1',
    classe: { nome: classe },
    assuntos: [{ nome: assunto }],
    orgaoJulgador: { nome: orgao },
    dataAjuizamento: new Date().toISOString(),
    dataHoraUltimaAtualizacao: new Date().toISOString(),
    formato: { nome: 'Físico/Manual' },
    partes: [
      { nome: autor, polo: 'ATIVO', tipo: 'Manual' },
      { nome: reu, polo: 'PASSIVO', tipo: 'Manual' }
    ],
    movimentos: [
      {
        nome: 'Cadastro de Processo',
        dataHora: new Date().toISOString(),
        detalhes: lastMov
      }
    ]
  };
}

/* ==========================================================================
   INTEGRAÇÃO E FUNÇÕES DO SUPABASE STORAGE (NUVEM)
   ========================================================================== */

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);
      return supabaseClient;
    } else {
      console.warn('[Supabase] SDK global não está disponível no escopo window.');
      return null;
    }
  } catch (err) {
    console.error('[Supabase] Falha ao instanciar o cliente:', err);
    return null;
  }
}

/**
 * Divide um arquivo PDF em partes menores de aproximadamente 40MB cada
 * @param {File} file Arquivo original
 * @returns {Promise<File[]>} Lista de arquivos gerados (partes)
 */
async function splitPdfFile(file) {
  console.log(`[PDF Splitter] Iniciando divisão do arquivo: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
  
  if (typeof PDFLib === 'undefined') {
    throw new Error('Biblioteca pdf-lib não está disponível para realizar a divisão do PDF.');
  }

  // Lê o arquivo como ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  
  // Carrega o documento PDF original
  const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
  const totalPages = pdfDoc.getPageCount();
  console.log(`[PDF Splitter] PDF carregado. Total de páginas: ${totalPages}`);

  // Calcula o número de partes estimadas baseado no tamanho do arquivo
  const maxChunkSize = 40 * 1024 * 1024; // 40MB para margem de segurança do Supabase (50MB limit)
  const numberOfParts = Math.ceil(file.size / maxChunkSize);
  const pagesPerPart = Math.ceil(totalPages / numberOfParts);
  
  console.log(`[PDF Splitter] Dividindo o PDF em ${numberOfParts} partes (~${pagesPerPart} páginas por parte).`);

  const splitFiles = [];
  
  for (let i = 0; i < numberOfParts; i++) {
    const startPage = i * pagesPerPart;
    const endPage = Math.min((i + 1) * pagesPerPart - 1, totalPages - 1);
    
    if (startPage >= totalPages) break;
    
    console.log(`[PDF Splitter] Criando parte ${i + 1} (Páginas ${startPage + 1} até ${endPage + 1})...`);
    
    // Cria um novo subdocumento
    const subDoc = await PDFLib.PDFDocument.create();
    
    // Cria um array de índices das páginas a copiar
    const pageIndices = [];
    for (let p = startPage; p <= endPage; p++) {
      pageIndices.push(p);
    }
    
    // Copia as páginas do original para o subdocumento
    const copiedPages = await subDoc.copyPages(pdfDoc, pageIndices);
    copiedPages.forEach(page => subDoc.addPage(page));
    
    // Salva o PDF particionado
    const subPdfBytes = await subDoc.save();
    
    // Cria um novo arquivo Blob/File
    const partBlob = new Blob([subPdfBytes], { type: 'application/pdf' });
    const originalNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const partFile = new File([partBlob], `${originalNameWithoutExt}_parte${i + 1}.pdf`, { type: 'application/pdf' });
    
    splitFiles.push(partFile);
  }

  console.log(`[PDF Splitter] Divisão concluída! ${splitFiles.length} partes geradas.`);
  return splitFiles;
}

async function uploadPdfToSupabase(file, processNumber) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase não configurado ou cliente indisponível. Verifique as configurações de APIs.');
  }

  const fileExt = 'pdf';
  const sanitizeEmail = (currentUserEmail || 'anon').replace(/[^a-zA-Z0-9]/g, '_');
  const maxLimit = 50 * 1024 * 1024; // 50MB

  if (file.size > maxLimit) {
    console.log(`[Supabase] Arquivo excede o limite de 50MB (${(file.size / 1024 / 1024).toFixed(2)} MB). Iniciando divisão local...`);
    const statusText = document.getElementById('pdf-loading-status');
    if (statusText) statusText.textContent = "Dividindo PDF pesado em partes menores...";
    
    const parts = await splitPdfFile(file);
    const uploadedPaths = [];
    
    for (let i = 0; i < parts.length; i++) {
      const partFile = parts[i];
      const filePath = `${sanitizeEmail}/${processNumber}_part${i + 1}_${Date.now()}.${fileExt}`;
      
      if (statusText) statusText.textContent = `Enviando parte ${i + 1} de ${parts.length} para o Supabase...`;
      console.log(`[Supabase] Enviando parte ${i + 1}: ${partFile.name} para o caminho ${filePath}...`);
      
      const { data, error } = await client.storage
        .from(supabaseBucket)
        .upload(filePath, partFile, {
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        throw error;
      }
      
      uploadedPaths.push(data.path);
    }
    
    console.log('[Supabase] Todas as partes enviadas com sucesso:', uploadedPaths);
    return uploadedPaths.join(',');
  } else {
    // Comportamento normal para arquivo menor que 50MB
    const filePath = `${sanitizeEmail}/${processNumber}_${Date.now()}.${fileExt}`;

    console.log(`[Supabase] Iniciando upload de ${file.name} para o caminho ${filePath}...`);
    
    const { data, error } = await client.storage
      .from(supabaseBucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      throw error;
    }

    console.log('[Supabase] Upload realizado com sucesso. Dados:', data);
    return data.path;
  }
}

async function getPdfAccessUrl(filePath) {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;

  const client = getSupabaseClient();
  if (!client) return null;

  try {
    // Tenta gerar a URL assinada privada (expira em 1 hora)
    const { data, error } = await client.storage
      .from(supabaseBucket)
      .createSignedUrl(filePath, 3600);
      
    if (error) {
      console.warn('[Supabase] Falha na URL assinada privada, tentando URL pública:', error);
      // Fallback para URL pública caso o bucket esteja configurado como público
      const { data: pubData } = client.storage
        .from(supabaseBucket)
        .getPublicUrl(filePath);
      return pubData.publicUrl;
    }
    return data.signedUrl;
  } catch (err) {
    console.error('[Supabase] Erro ao obter URL do PDF:', err);
    return null;
  }
}

// Abre o PDF na nuvem na página correspondente à decisão/intimação
async function openProcessPdfAtPage(pageNumber) {
  if (!activeProcess || !activeProcess.pdfPath) {
    showToast("PDF original não disponível na nuvem.");
    return;
  }
  try {
    const paths = activeProcess.pdfPath.split(',');
    showToast('Obtendo link do PDF...');
    const url = await getPdfAccessUrl(paths[0]);
    if (url) {
      const pageParam = pageNumber ? `#page=${pageNumber}` : '';
      window.open(url + pageParam, '_blank');
    } else {
      showToast('Não foi possível obter a URL do arquivo.');
    }
  } catch (err) {
    showToast(`Erro ao abrir o PDF: ${err.message}`);
  }
}

/* ==========================================================================
   LÓGICA DE UPLOAD E LEITURA DE PDF (CLIENT-SIDE COM LOADING BAR)
   ========================================================================== */

// Extrai o texto do PDF de forma 100% local no cliente (browser) usando PDF.js
async function extractTextFromPdfClient(file, progressCallback) {
  const arrayBuffer = await file.arrayBuffer();
  
  // Define o worker do PDF.js a partir da CDN
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
  
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  let fullText = '';
  
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += `[PÁGINA ${i}]\n` + pageText + '\n\n';
    
    if (progressCallback) {
      progressCallback(i, numPages);
    }
  }
  
  return {
    text: fullText,
    numPages: numPages
  };
}

async function handlePdfUpload(e) {
  if (!activeProcess) return;
  const file = e.target.files[0];
  if (!file) return;

  const btnUpload = document.getElementById('btn-upload-pdf-trigger');
  const btnUpdate = document.getElementById('btn-update-pdf-trigger');
  const containerEmpty = document.getElementById('pdf-status-empty');
  const containerActive = document.getElementById('pdf-status-active');
  const containerLoading = document.getElementById('pdf-loading-container');
  const fillBar = document.getElementById('pdf-loading-fill');
  const textStatus = document.getElementById('pdf-loading-status');
  const textPercent = document.getElementById('pdf-loading-percent');
  const outdatedBanner = document.getElementById('pdf-outdated-banner');
  
  if (btnUpload) btnUpload.disabled = true;
  if (btnUpdate) btnUpdate.disabled = true;

  // Exibe a barra de progresso e oculta os cards de status
  containerEmpty.style.display = 'none';
  containerActive.style.display = 'none';
  outdatedBanner.style.display = 'none';
  containerLoading.style.display = 'flex';
  
  fillBar.style.width = '0%';
  textStatus.textContent = "Abrindo arquivo PDF...";
  textPercent.textContent = "0%";

  try {
    // REGRA DE NEGÓCIO: Deleta o PDF anterior do objeto explicitamente liberando memória
    activeProcess.pdfText = null;
    activeProcess.pdfName = null;
    activeProcess.pdfSize = null;
    activeProcess.pdfPages = null;
    activeProcess.pdfUploadDate = null;
    activeProcess.pdfPath = null; // Limpa o path anterior do Supabase
    
    // Extrai o texto localmente na máquina do usuário (rápido, sem carregar arquivos pro servidor)
    const parsedData = await extractTextFromPdfClient(file, (current, total) => {
      const pct = Math.round((current / total) * 100);
      fillBar.style.width = `${pct}%`;
      textPercent.textContent = `${pct}%`;
      textStatus.textContent = `Lendo PDF localmente: página ${current} de ${total}`;
    });

    // Envia arquivo para o Supabase se configurado
    let supabasePath = null;
    if (supabaseUrl && supabaseAnonKey) {
      fillBar.style.width = '95%';
      textPercent.textContent = '95%';
      textStatus.textContent = "Fazendo upload do PDF para o Supabase Storage...";
      
      try {
        supabasePath = await uploadPdfToSupabase(file, activeProcess.numeroProcesso);
      } catch (uploadErr) {
        console.error("Falha ao subir PDF para o Supabase:", uploadErr);
        showToast(`Alerta: Falha ao salvar arquivo no Supabase: ${uploadErr.message}. O texto foi extraído com sucesso mas o arquivo original não pôde ser salvo na nuvem.`, 7000);
      }
    }

    // Atualiza status do carregador antes da chamada da IA
    fillBar.style.width = '99%';
    textPercent.textContent = '99%';
    textStatus.textContent = "Processando Ficha Técnica com IA...";

    // Filtro Inteligente de PDF (Keyword Context Scanner) no cliente
    // Preserva os primeiros 8.000 caracteres (capa/foro/partes) e anexa parágrafos com termos chave de nomeação/honorários do restante do PDF
    let sampleText = parsedData.text.substring(0, 8000);
    const remainingText = parsedData.text.substring(8000);
    const lines = remainingText.split('\n');
    const keywords = ['perito', 'nomeio', 'nomeação', 'honorários', 'depósito', 'gratuita', 'ônus', 'inversão', 'ufesp', 'arbitro', 'laudo'];
    
    let relevantExcerpts = [];
    let currentLength = sampleText.length;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length < 10) continue;
      
      const lineLower = line.toLowerCase();
      const hasKeyword = keywords.some(kw => lineLower.includes(kw));
      
      if (hasKeyword) {
        const prevLine = i > 0 ? lines[i-1].trim() : '';
        const nextLine = i < lines.length - 1 ? lines[i+1].trim() : '';
        const block = `\n[Trecho relevante linha ${i}]:\n${prevLine ? prevLine + '\n' : ''}${line}\n${nextLine ? nextLine + '\n' : ''}`;
        
        if (currentLength + block.length < 22000) { // Limite seguro para análise leve
          relevantExcerpts.push(block);
          currentLength += block.length;
        } else {
          break;
        }
      }
    }
    sampleText += '\n\n--- [TRECHOS SELECIONADOS DO PROCESSO] ---\n' + relevantExcerpts.join('\n');
    if (!activeProcess.expertInfo) {
      activeProcess.expertInfo = getInitialExpertInfo(activeProcess);
    }

    // Salva tudo no banco local IndexedDB
    activeProcess.pdfText = parsedData.text;
    activeProcess.pdfName = file.name;
    activeProcess.pdfSize = file.size;
    activeProcess.pdfPages = parsedData.numPages;
    activeProcess.pdfUploadDate = new Date().toISOString();
    activeProcess.pdfPath = supabasePath; // Salva o caminho do arquivo no Supabase

    // Limpa cache de IA anterior para forçar reanálise com o novo PDF
    delete activeProcess.__aiResult;
    if (activeProcess.aiData) delete activeProcess.aiData.result;

    await ProcessService.update(activeProcess);
    
    fillBar.style.width = '100%';
    textPercent.textContent = '100%';
    textStatus.textContent = "Concluído!";

    setTimeout(() => {
      containerLoading.style.display = 'none';
      openProcessDetails(activeProcess);
      showToast("Texto do PDF processado com sucesso!");
    }, 600);
    
    await renderDashboard();
  } catch(err) {
    console.error("Erro no processamento do PDF:", err);
    containerLoading.style.display = 'none';
    renderPdfStatusCard(activeProcess); // Retorna visualização anterior
    showToast(`Erro ao processar o PDF: ${err.message}`, 6000);
  } finally {
    if (btnUpload) btnUpload.disabled = false;
    if (btnUpdate) btnUpdate.disabled = false;
    e.target.value = ''; // Limpa o input
  }
}

// Verifica se a cópia em PDF está desatualizada baseando-se nas datas das movimentações do Datajud
function isPdfOutdated(process) {
  if (!process.pdfText || !process.pdfUploadDate || !process.movimentos || process.movimentos.length === 0) return false;
  
  const latestMov = process.movimentos[0];
  if (!latestMov.dataHora) return false;
  
  const uploadTime = new Date(process.pdfUploadDate).getTime();
  const latestMovTime = new Date(latestMov.dataHora).getTime();
  
  // Se o PDF foi enviado depois da data do último andamento processual, não está desatualizado!
  // Adiciona uma tolerância de 2 horas para fusos horários
  if (uploadTime >= latestMovTime - (2 * 60 * 60 * 1000)) {
    return false;
  }
  
  const date = new Date(latestMov.dataHora);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const formattedDate = `${day}/${month}/${year}`;
  
  const hasDate = process.pdfText.includes(formattedDate);
  return !hasDate;
}

// Inicializa ficha técnica com base no retorno da API Datajud e órgão julgador
function getInitialExpertInfo(process) {
  const autor = process.partes?.filter(p => p.polo === 'ATIVO')?.map(p => p.nome).join(', ') || '';
  const reu = process.partes?.filter(p => p.polo === 'PASSIVO')?.map(p => p.nome).join(', ') || '';
  
  let comarca = '';
  if (process.orgaoJulgador && process.orgaoJulgador.nome) {
    const organName = process.orgaoJulgador.nome.toUpperCase();
    let cleanName = organName
      .replace(/[0-9]+/g, '')
      .replace(/VARA/g, '')
      .replace(/CIVEL/g, '')
      .replace(/CÍVEL/g, '')
      .replace(/DE/g, '')
      .replace(/DA/g, '')
      .replace(/DO/g, '')
      .replace(/JUIZADO/g, '')
      .replace(/ESPECIAL/g, '')
      .trim();
    if (cleanName.length > 0) {
      cleanName = cleanName.charAt(0) + cleanName.slice(1).toLowerCase();
      comarca = `${cleanName}/${process.tribunal.toUpperCase()}`;
    }
  }

  return {
    autor: autor,
    reu: reu,
    perito: '',
    justicaGratuita: '',
    objetoPericia: '',
    cidadeEstado: comarca,
    inversaoOnus: '',
    honorarios: 0,
    honorariosUfesp: 0,
    depositoJudicial: '',
    dataHonorarios: null,
    dataDeposito: null,
    resumoProcesso: ''
  };
}

/* ==========================================================================
   RENDERIZAÇÃO DA TELA PRINCIPAL (DASHBOARD)
   ========================================================================== */

async function renderDashboard(filterQuery = '') {
  const processes = await ProcessService.getProcesses();
  const listContainer = document.getElementById('process-list-container');
  const statTotal = document.getElementById('stat-total');
  const statUpdated = document.getElementById('stat-updated');
  const statOverdue = document.getElementById('stat-overdue-tasks');
  const badgeTasks = document.getElementById('badge-overdue-tasks-count');

  // Atualiza contador de radar em segundo plano
  setTimeout(updateRadarBadgeCount, 100);

  // Filtragem de ativos para as estatísticas
  const activeProcesses = processes.filter(p => !p.archived);
  statTotal.textContent = activeProcesses.length;
  statUpdated.textContent = activeProcesses.filter(p => p.hasUpdate).length;

  // Calcula tarefas atrasadas (apenas de processos ativos)
  const overdueCount = calculateOverdueTasksCount(activeProcesses);
  statOverdue.textContent = overdueCount;
  if (overdueCount > 0) {
    statOverdue.style.color = 'var(--md-sys-color-error)';
    if (badgeTasks) {
      badgeTasks.textContent = overdueCount;
      badgeTasks.style.display = 'inline-flex';
      badgeTasks.style.alignItems = 'center';
      badgeTasks.style.justifyContent = 'center';
    }
  } else {
    statOverdue.style.color = 'var(--md-sys-color-on-surface)';
    if (badgeTasks) badgeTasks.style.display = 'none';
  }

  listContainer.innerHTML = '';

  const showArchived = document.getElementById('toggle-show-archived')?.checked || false;
  let filtered = processes.filter(p => showArchived || !p.archived);

  if (filterQuery) {
    const q = filterQuery.toLowerCase();
    filtered = filtered.filter(p => 
      p.numeroProcesso.includes(q) || 
      p.tribunal.toLowerCase().includes(q) ||
      p.classe?.nome?.toLowerCase().includes(q) ||
      p.partes?.some(part => part.nome.toLowerCase().includes(q))
    );
  }

  if (filtered.length === 0) {
    if (activeProcesses.length === 0) {
      document.getElementById('empty-state-monitored').style.display = 'flex';
    } else {
      listContainer.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">find_in_page</span>
          <h3>Nenhum processo encontrado</h3>
          <p>Nenhum processo cadastrado corresponde aos termos da pesquisa.</p>
          <button class="md-btn md-btn-primary btn-empty-add-search" style="margin-top: 16px; gap: 8px;">
            <span class="material-symbols-rounded">add</span>
            <span>Cadastrar Processo</span>
          </button>
        </div>
      `;
      const btnSearchAdd = listContainer.querySelector('.btn-empty-add-search');
      if (btnSearchAdd) {
        btnSearchAdd.addEventListener('click', () => openDialog('register-process-dialog'));
      }
    }
    return;
  }

  document.getElementById('empty-state-monitored').style.display = 'none';

  filtered.forEach(proc => {
    let autor = proc.partes?.find(p => p.polo === 'ATIVO')?.nome || 'Não informado';
    if (autor === 'Não informado' || autor === 'Autor Não Informado') {
      if (proc.expertInfo?.autor && proc.expertInfo.autor !== 'Não localizado') {
        autor = proc.expertInfo.autor;
      }
    }

    let reu = proc.partes?.find(p => p.polo === 'PASSIVO')?.nome || 'Não informado';
    if (reu === 'Não informado' || reu === 'Réu Não Informado') {
      if (proc.expertInfo?.reu && proc.expertInfo.reu !== 'Não localizado') {
        reu = proc.expertInfo.reu;
      }
    }
    
    const card = document.createElement('div');
    card.className = 'process-card';

    // Se o processo estiver arquivado, reduz opacidade
    if (proc.archived) {
      card.style.opacity = '0.65';
    }

    // Se o PDF estiver desatualizado e não estiver arquivado, destaca a borda do card em vermelho!
    const outdated = !proc.archived && isPdfOutdated(proc);
    if (outdated) {
      card.style.borderColor = 'var(--md-sys-color-error)';
      card.style.boxShadow = '0 0 8px rgba(186, 26, 26, 0.15)';
    }

    const tAlias = proc.tribunal.toLowerCase();
    let courtClass = 'tj';
    if (tAlias.startsWith('trf')) courtClass = 'trf';
    else if (tAlias.startsWith('trt')) courtClass = 'trt';
    else if (['stj', 'tst', 'tse'].includes(tAlias)) courtClass = 'sup';

    const lastCheckedStr = proc.lastChecked ? new Date(proc.lastChecked).toLocaleString('pt-BR') : 'Nunca';

    const info = proc.expertInfo || {};
    let honorariosRow = '';
    if (info.honorarios) {
      const baseDateStr = info.dataDeposito || info.dataHonorarios || proc.dataAjuizamento || null;
      const valUpdated = calculateUpdatedFees(info.honorarios, baseDateStr, proc.tribunal, info.dataEntregaLaudo, proc.archivedDate);
      honorariosRow = `
        <div class="detail-row" style="color: var(--md-sys-color-primary);">
          <span class="material-symbols-rounded">payments</span>
          <span><strong>Valor Perícia:</strong> ${formatCurrency(info.honorarios)} (Corrigido: ${formatCurrency(valUpdated)})</span>
        </div>
      `;
    }

    card.innerHTML = `
      ${proc.hasUpdate ? '<span class="card-notification-dot"></span>' : ''}
      <div class="process-card-header">
        <span class="process-card-number">${formatProcessNumber(proc.numeroProcesso)}</span>
        <div style="display: flex; gap: 6px; align-items: center;">
          ${outdated ? '<span class="badge-outdated"><span class="material-symbols-rounded">warning</span>PDF Desatualizado</span>' : ''}
          <span class="court-chip ${courtClass}">${proc.tribunal.toUpperCase()}</span>
        </div>
      </div>
      
      <div class="process-card-details">
        <div class="detail-row">
          <span class="material-symbols-rounded">gavel</span>
          <span><strong>Classe:</strong> ${proc.classe?.nome || 'Não classificada'}</span>
        </div>
        <div class="detail-row">
          <span class="material-symbols-rounded">person</span>
          <span><strong>Autor:</strong> ${autor}</span>
        </div>
        <div class="detail-row">
          <span class="material-symbols-rounded">person_search</span>
          <span><strong>Réu:</strong> ${reu}</span>
        </div>
        ${honorariosRow}
      </div>
      
      <div class="process-card-footer">
        <span>Última busca: ${lastCheckedStr}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      openProcessDetails(proc);
    });

    listContainer.appendChild(card);
  });
}

/* ==========================================================================
   VISUALIZAÇÃO DE DETALHES DO PROCESSO (DIALOG)
   ========================================================================== */

async function openProcessDetails(process) {
  activeProcess = process;

  // Garante que o modal sempre abra na aba "Resumo"
  document.querySelectorAll('.dialog-tabs .tab-btn').forEach(btn => {
    if (btn.getAttribute('data-modal-target') === 'tab-resumo') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  document.querySelectorAll('.modal-tab-content').forEach(content => {
    if (content.id === 'tab-resumo') {
      content.classList.add('active-tab');
    } else {
      content.classList.remove('active-tab');
    }
  });

  if (process.hasUpdate) {
    process.hasUpdate = false;
    await ProcessService.update(process);
    await renderDashboard();
  }

  // Data de última busca/sincronização
  const lblChecked = document.getElementById('modal-last-checked-label');
  if (lblChecked) {
    lblChecked.textContent = `Última busca: ${process.lastChecked ? new Date(process.lastChecked).toLocaleString('pt-BR') : 'Nunca'}`;
  }

  // Preenche metadados
  document.getElementById('modal-court-badge').textContent = process.tribunal.toUpperCase();
  document.getElementById('modal-process-number').textContent = formatProcessNumber(process.numeroProcesso);
  document.getElementById('modal-classe').textContent = process.classe?.nome || 'Não classificada';
  document.getElementById('modal-assunto').textContent = process.assuntos?.[0]?.nome || 'Geral';
  document.getElementById('modal-orgao').textContent = process.orgaoJulgador?.nome || 'Vara única';
  document.getElementById('modal-data-ajuizamento').textContent = process.dataAjuizamento ? new Date(process.dataAjuizamento).toLocaleDateString('pt-BR') : 'Não cadastrada';

  // Inicializa ficha do expert se necessário
  if (!process.expertInfo) {
    process.expertInfo = getInitialExpertInfo(process);
    await ProcessService.update(process);
  }

  // Exibe a Ficha Técnica do Expert
  renderExpertInfoCard(process);
  document.getElementById('expert-info-edit').style.display = 'none';
  document.getElementById('expert-info-card').style.display = 'flex';

  // Partes
  const listAtivo = document.getElementById('modal-polo-ativo');
  const listPassivo = document.getElementById('modal-polo-passivo');
  listAtivo.innerHTML = '';
  listPassivo.innerHTML = '';

  const ativos = process.partes?.filter(p => p.polo === 'ATIVO') || [];
  const passivos = process.partes?.filter(p => p.polo === 'PASSIVO') || [];

  if (ativos.length === 0) {
    listAtivo.innerHTML = '<div class="party-item-name">Autor não informado</div>';
  } else {
    ativos.forEach(p => {
      const doc = p.numeroDocumentoPrincipal ? `<span class="party-item-doc">${formatDocument(p.numeroDocumentoPrincipal)}</span>` : '';
      listAtivo.innerHTML += `
        <div style="display: flex; flex-direction: column; margin-bottom: 6px;">
          <span class="party-item-name">${p.nome}</span>
          ${doc}
        </div>
      `;
    });
  }

  if (passivos.length === 0) {
    listPassivo.innerHTML = '<div class="party-item-name">Réu não informado</div>';
  } else {
    passivos.forEach(p => {
      const doc = p.numeroDocumentoPrincipal ? `<span class="party-item-doc">${formatDocument(p.numeroDocumentoPrincipal)}</span>` : '';
      listPassivo.innerHTML += `
        <div style="display: flex; flex-direction: column; margin-bottom: 6px;">
          <span class="party-item-name">${p.nome}</span>
          ${doc}
        </div>
      `;
    });
  }

  // Último andamento
  const lastMov = process.movimentos?.[0];
  if (lastMov) {
    document.getElementById('modal-last-movement-desc').textContent = lastMov.detalhes || lastMov.nome;
    document.getElementById('modal-last-movement-date').textContent = new Date(lastMov.dataHora).toLocaleString('pt-BR');
  } else {
    document.getElementById('modal-last-movement-desc').textContent = 'Sem movimentações catalogadas.';
    document.getElementById('modal-last-movement-date').textContent = '';
  }

  // Timeline (Movimentações)
  document.getElementById('modal-mov-count').textContent = process.movimentos?.length || 0;
  const timeline = document.getElementById('modal-timeline');
  timeline.innerHTML = '';

  if (!process.movimentos || process.movimentos.length === 0) {
    timeline.innerHTML = '<p style="text-align: center; color: var(--md-sys-color-outline);">Nenhuma movimentação para exibir.</p>';
  } else {
    process.movimentos.forEach(mov => {
      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.innerHTML = `
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <span class="timeline-date">${new Date(mov.dataHora).toLocaleString('pt-BR')}</span>
          <span class="timeline-desc">${mov.nome}</span>
          ${mov.detalhes ? `<p class="timeline-details">${mov.detalhes}</p>` : ''}
        </div>
      `;
      timeline.appendChild(item);
    });
  }

  // Visualização e estado de arquivos PDF
  renderPdfStatusCard(process);



  // Configura ação do botão Arquivar/Desarquivar
  const btnArchive = document.getElementById('modal-btn-archive');
  if (btnArchive) {
    const cloneArchive = btnArchive.cloneNode(true);
    btnArchive.parentNode.replaceChild(cloneArchive, btnArchive);
    
    // Atualiza ícone e rótulo do botão de arquivamento
    const iconArchive = cloneArchive.querySelector('#modal-btn-archive-icon');
    const txtArchive = cloneArchive.querySelector('#modal-btn-archive-text');
    if (process.archived) {
      if (iconArchive) iconArchive.textContent = 'unarchive';
      if (txtArchive) txtArchive.textContent = 'Desarquivar';
    } else {
      if (iconArchive) iconArchive.textContent = 'archive';
      if (txtArchive) txtArchive.textContent = 'Arquivar';
    }

    cloneArchive.addEventListener('click', async () => {
      process.archived = !process.archived;
      process.archivedDate = process.archived ? new Date().toISOString().split('T')[0] : null;
      await ProcessService.update(process);
      showToast(process.archived ? "Processo arquivado!" : "Processo desarquivado!");
      closeDialog('process-detail-dialog');
      await renderDashboard();
    });
  }

  // Configura ação do botão Sincronizar
  const btnSyncNow = document.getElementById('btn-sync-process-now');
  if (btnSyncNow) {
    const cloneSync = btnSyncNow.cloneNode(true);
    btnSyncNow.parentNode.replaceChild(cloneSync, btnSyncNow);
    cloneSync.addEventListener('click', async () => {
      await syncSingleProcessManually(process.numeroProcesso, cloneSync);
    });
  }

  // Configura ação do botão Recarregar Dados do Datajud
  const btnRefresh = document.getElementById('btn-refresh-datajud');
  if (btnRefresh) {
    const cloneRefresh = btnRefresh.cloneNode(true);
    btnRefresh.parentNode.replaceChild(cloneRefresh, btnRefresh);
    cloneRefresh.addEventListener('click', async () => {
      cloneRefresh.disabled = true;
      cloneRefresh.innerHTML = '<span class="material-symbols-rounded spinning">sync</span><span>Sincronizando...</span>';
      try {
        const cleanCNJ = process.numeroProcesso.replace(/[^0-9]/g, '');
        const courtAlias = detectCourtFromCNJ(cleanCNJ);
        if (courtAlias) {
          const mapped = await fetchProcessFromAPI(cleanCNJ, courtAlias);
          if (mapped) {
            if (mapped.classe?.nome) process.classe = mapped.classe;
            if (mapped.assuntos?.length) process.assuntos = mapped.assuntos;
            if (mapped.orgaoJulgador?.nome) process.orgaoJulgador = mapped.orgaoJulgador;
            if (mapped.partes?.length) process.partes = mapped.partes;
            if (mapped.movimentos?.length) process.movimentos = mapped.movimentos;
            if (mapped.dataAjuizamento) process.dataAjuizamento = mapped.dataAjuizamento;
            if (mapped.dataHoraUltimaAtualizacao) process.dataHoraUltimaAtualizacao = mapped.dataHoraUltimaAtualizacao;
            process.lastChecked = new Date().toISOString();
            process.hasUpdate = true;
            await ProcessService.update(process);
            showToast('Dados atualizados com sucesso do Datajud!');
            openProcessDetails(process);
            return;
          }
        }
        showToast('Não foi possível buscar dados do Datajud para este processo.');
      } catch (e) {
        showToast('Erro ao sincronizar: ' + e.message);
      } finally {
        cloneRefresh.disabled = false;
        cloneRefresh.innerHTML = '<span class="material-symbols-rounded">sync</span><span>Recarregar Dados do Datajud</span>';
      }
    });
  }

  // Abre o modal de detalhes
  openDialog('process-detail-dialog');
  
  // REGRA DE NEGÓCIO: Sincronização automática e silenciosa em segundo plano ao abrir o processo!
  setTimeout(() => syncSingleProcessSilently(process.numeroProcesso), 500);
}

// Preenche dados da Ficha Técnica do Expert na tela
function renderExpertInfoCard(process) {
  const info = process.expertInfo || {};
  document.getElementById('expert-val-autor').textContent = info.autor || 'Não localizado';
  document.getElementById('expert-val-reu').textContent = info.reu || 'Não localizado';
  document.getElementById('expert-val-perito').textContent = info.perito || 'Não nomeado';
  document.getElementById('expert-val-jg').textContent = info.justicaGratuita || 'Não informado';
  document.getElementById('expert-val-comarca').textContent = info.cidadeEstado || 'Não localizado';
  document.getElementById('expert-val-inversao').textContent = info.inversaoOnus || 'Não informado';
  
  // Honorários (Base) BRL e/ou UFESPs
  let honorariosBaseHtml = 'Não informado';
  if (info.honorarios) {
    honorariosBaseHtml = formatCurrency(info.honorarios);
  }
  if (info.honorariosUfesp) {
    const ufespValue2026 = parseFloat(info.honorariosUfesp) * 39.85;
    const ufespText = `${info.honorariosUfesp} UFESPs (${formatCurrency(ufespValue2026)})`;
    if (info.honorarios) {
      honorariosBaseHtml += ` / ${ufespText}`;
    } else {
      honorariosBaseHtml = ufespText;
    }
  }
  document.getElementById('expert-val-honorarios').textContent = honorariosBaseHtml;
  
  // Depósito Judicial com Data e Valor
  let depositoHtml = info.depositoJudicial || 'Não informado';
  if (info.valorDeposito) {
    depositoHtml += ` (Valor: ${formatCurrency(info.valorDeposito)})`;
  }
  if (info.dataDeposito) {
    const depDateStr = new Date(info.dataDeposito + 'T12:00:00').toLocaleDateString('pt-BR');
    depositoHtml += ` em ${depDateStr}`;
  }
  document.getElementById('expert-val-deposito').textContent = depositoHtml;
  
  // Entrega do Laudo
  let entregaLaudoHtml = 'Pendente';
  if (info.dataEntregaLaudo) {
    const entregaDateStr = new Date(info.dataEntregaLaudo + 'T12:00:00').toLocaleDateString('pt-BR');
    entregaLaudoHtml = `Entregue em ${entregaDateStr}`;
  }
  document.getElementById('expert-val-data-laudo').textContent = entregaLaudoHtml;
  
  // Honorários Corrigidos
  const baseDateStr = info.dataDeposito || info.dataHonorarios || process.dataAjuizamento || null;
  let labelOrigem = 'Sem data base';
  if (info.dataDeposito) {
    labelOrigem = 'desde o depósito';
  } else if (info.dataHonorarios) {
    labelOrigem = 'desde a fixação';
  } else if (process.dataAjuizamento) {
    labelOrigem = 'desde ajuizamento';
  }

  let honorariosCorrigidos = 'Não informado';
  if (info.honorarios) {
    const corrigidoVal = calculateUpdatedFees(info.honorarios, baseDateStr, process.tribunal, info.dataEntregaLaudo, process.archivedDate);
    
    // Calcula taxas e dias para exibição de ajuda/detalhes
    let endDate = new Date();
    let labelStop = '';
    if (info.dataEntregaLaudo) {
      const deliveryDate = new Date(info.dataEntregaLaudo + 'T12:00:00');
      if (!isNaN(deliveryDate.getTime()) && deliveryDate < endDate) {
        endDate = deliveryDate;
        labelStop = ' [Laudo Entregue]';
      }
    }
    if (process.archivedDate) {
      const archiveDate = new Date(process.archivedDate + 'T12:00:00');
      if (!isNaN(archiveDate.getTime()) && archiveDate < endDate) {
        endDate = archiveDate;
        labelStop = ' [Processo Arquivado]';
      }
    }
    const baseDate = new Date(baseDateStr + 'T12:00:00');
    const diffDays = !isNaN(baseDate.getTime()) ? Math.ceil(Math.max(0, endDate - baseDate) / (1000 * 60 * 60 * 24)) : 0;
    const jurosPct = Math.round((0.01 / 30) * diffDays * 100);
    const corrPct = Math.round((Math.pow(1 + (Math.pow(1 + 0.0038, 1/30) - 1), diffDays) - 1) * 100);

    honorariosCorrigidos = `${formatCurrency(corrigidoVal)} (${labelOrigem}${labelStop} | ${diffDays} dias | Juros: +${jurosPct}% | Corr: +${corrPct}%)`;
  } else if (info.honorariosUfesp) {
    // Para UFESP, a atualização é a própria conversão para o ano de 2026!
    const valorUfesp2026 = parseFloat(info.honorariosUfesp) * 39.85;
    honorariosCorrigidos = `${formatCurrency(valorUfesp2026)} (Conversão UFESP 2026)`;
  }
  
  document.getElementById('expert-val-honorarios-corrigido').textContent = honorariosCorrigidos;
  document.getElementById('expert-val-objeto').textContent = info.objetoPericia || 'Não localizado';
  document.getElementById('expert-val-resumo').textContent = info.resumoProcesso || 'Não localizado';
}

// Controla exibição das caixas e tarjas de PDF no modal de detalhes
function renderPdfStatusCard(process) {
  const emptyState = document.getElementById('pdf-status-empty');
  const activeState = document.getElementById('pdf-status-active');
  const outdatedBanner = document.getElementById('pdf-outdated-banner');
  const containerLoading = document.getElementById('pdf-loading-container');
  const btnDownloadSupabase = document.getElementById('btn-download-supabase-pdf');

  // Garante que o loading esteja oculto se não estiver indexando
  containerLoading.style.display = 'none';

  if (process.pdfText) {
    emptyState.style.display = 'none';
    activeState.style.display = 'block';
    
    document.getElementById('pdf-info-filename').textContent = process.pdfName || 'processo_anexado.pdf';
    
    const sizeKB = Math.round((process.pdfSize || 0) / 1024);
    const pages = process.pdfPages || 0;
    const chars = process.pdfText.length;
    document.getElementById('pdf-info-details').textContent = `Tamanho: ${sizeKB} KB | Páginas: ${pages} | Texto extraído: ${chars} caracteres`;

    if (btnDownloadSupabase) {
      btnDownloadSupabase.style.display = process.pdfPath ? 'inline-flex' : 'none';
    }

    const isOutdated = isPdfOutdated(process);
    outdatedBanner.style.display = isOutdated ? 'flex' : 'none';
  } else {
    emptyState.style.display = 'flex';
    activeState.style.display = 'none';
    outdatedBanner.style.display = 'none';
    if (btnDownloadSupabase) {
      btnDownloadSupabase.style.display = 'none';
    }
  }
}

// Atualiza a visualização interna da aba AI de acordo com o estado do processo e PDF
/* ==========================================================================
   SINCRONIZAÇÃO AUTOMÁTICA EM SEGUNDO PLANO (SILENCIOSA)
   ========================================================================== */

// Sincroniza silenciosamente um único processo (chamado ao abrir o modal)
async function syncSingleProcessSilently(processNumber) {
  try {
    const list = await ProcessService.getProcesses();
    const index = list.findIndex(p => p.numeroProcesso === processNumber);
    if (index === -1) return;
    const proc = list[index];
    if (proc.archived) return; // Pula processos arquivados!

    const cleanCNJ = processNumber.replace(/[^0-9]/g, '');
    const courtAlias = detectCourtFromCNJ(cleanCNJ);
    if (!courtAlias) return;

    const query = buildDatajudQuery(cleanCNJ, 1);

    let hits = [];
    const mockHits = getMockSearchHits(cleanCNJ);
    if (mockHits) {
      hits = mockHits;
    } else {
      const response = await authFetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ''
        },
        body: JSON.stringify({
          tribunal: courtAlias,
          query: query,
          timeout: 25000 // Limite de 25 segundos para tolerar API lenta do Datajud
        })
      });
      if (!response.ok) return;
      const data = await response.json();
      hits = data.hits?.hits || [];
    }

    if (hits.length > 0) {
      const updatedProc = mapDatajudProcess(hits[0], courtAlias);
      const apiUpdate = updatedProc.dataHoraUltimaAtualizacao;
      const apiMovs = updatedProc.movimentos?.length || 0;
      const localMovs = proc.movimentos?.length || 0;

      if (apiUpdate !== proc.dataHoraUltimaAtualizacao || apiMovs > localMovs) {
        const oldMovsCount = localMovs;
        proc.dataHoraUltimaAtualizacao = apiUpdate;
        proc.movimentos = updatedProc.movimentos;
        proc.hasUpdate = true;
        
        await ProcessService.update(proc);
        
        // Se o processo que está atualmente aberto for o mesmo que atualizou, atualiza a tela dinamicamente!
        if (activeProcess && activeProcess.numeroProcesso === processNumber) {
          activeProcess = proc;
          
          document.getElementById('modal-last-movement-desc').textContent = proc.movimentos[0]?.detalhes || proc.movimentos[0]?.nome || '-';
          document.getElementById('modal-last-movement-date').textContent = new Date(proc.movimentos[0]?.dataHora).toLocaleString('pt-BR');
          
          document.getElementById('modal-mov-count').textContent = proc.movimentos.length;
          const timeline = document.getElementById('modal-timeline');
          timeline.innerHTML = '';
          
          proc.movimentos.forEach(mov => {
            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.innerHTML = `
              <div class="timeline-dot"></div>
              <div class="timeline-content">
                <span class="timeline-date">${new Date(mov.dataHora).toLocaleString('pt-BR')}</span>
                <span class="timeline-desc">${mov.nome}</span>
                ${mov.detalhes ? `<p class="timeline-details">${mov.detalhes}</p>` : ''}
              </div>
            `;
            timeline.appendChild(item);
          });
          
          renderPdfStatusCard(proc);
        }

        showToast("Novas publicações encontradas no Datajud! Base de dados local atualizada.");
        await renderDashboard();
      }
    }
  } catch (err) {
    console.warn(`[Auto-Sync] Falha silenciosa ao sincronizar processo ${processNumber}:`, err);
  }
}

// Sincroniza ativamente e manualmente um processo pelo botão na tela com feedback visual
async function syncSingleProcessManually(processNumber, btnEl) {
  if (!btnEl) return;
  const originalHtml = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = '<span class="material-symbols-rounded spinner" style="font-size: 16px; animation: spin 1.5s linear infinite; display: inline-block;">sync</span><span>Sincronizando...</span>';

  try {
    const list = await ProcessService.getProcesses();
    const index = list.findIndex(p => p.numeroProcesso === processNumber);
    if (index === -1) throw new Error('Processo não localizado no banco de dados local.');
    const proc = list[index];

    const cleanCNJ = processNumber.replace(/[^0-9]/g, '');
    const courtAlias = detectCourtFromCNJ(cleanCNJ);
    if (!courtAlias) throw new Error('Não foi possível identificar o tribunal a partir do número do CNJ.');

    const query = buildDatajudQuery(cleanCNJ, 50);

    let hits = [];
    const mockHits = getMockSearchHits(cleanCNJ);
    if (mockHits) {
      hits = mockHits;
    } else {
      const response = await authFetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ''
        },
        body: JSON.stringify({
          tribunal: courtAlias,
          query: query,
          timeout: 25000
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || data.details || 'Falha ao se comunicar com o Datajud.');
      }
      hits = data.hits?.hits || [];
    }

    if (hits.length === 0) {
      throw new Error(`Processo não localizado no banco do tribunal ${courtAlias.toUpperCase()}. Anexe o PDF do processo para consultar manualmente.`);
    }

    const updatedProc = mapDatajudProcess(hits[0], courtAlias);
    const apiUpdate = updatedProc.dataHoraUltimaAtualizacao;
    
    proc.dataHoraUltimaAtualizacao = apiUpdate;
    proc.movimentos = updatedProc.movimentos;
    proc.lastChecked = new Date().toISOString();
    proc.hasUpdate = false; // Usuário está ativamente sincronizando e visualizando, zera flag

    await ProcessService.update(proc);
    
    // Atualiza o modal aberto se for o mesmo processo
    if (activeProcess && activeProcess.numeroProcesso === processNumber) {
      activeProcess = proc;
      
      const lastMov = proc.movimentos?.[0];
      if (lastMov) {
        document.getElementById('modal-last-movement-desc').textContent = lastMov.detalhes || lastMov.nome || '-';
        document.getElementById('modal-last-movement-date').textContent = new Date(lastMov.dataHora).toLocaleString('pt-BR');
      }
      
      document.getElementById('modal-mov-count').textContent = proc.movimentos.length;
      const timeline = document.getElementById('modal-timeline');
      if (timeline) {
        timeline.innerHTML = '';
        proc.movimentos.forEach(mov => {
          const item = document.createElement('div');
          item.className = 'timeline-item';
          item.innerHTML = `
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <span class="timeline-date">${new Date(mov.dataHora).toLocaleString('pt-BR')}</span>
              <span class="timeline-desc">${mov.nome}</span>
              ${mov.detalhes ? `<p class="timeline-details">${mov.detalhes}</p>` : ''}
            </div>
          `;
          timeline.appendChild(item);
        });
      }
      
      const lblChecked = document.getElementById('modal-last-checked-label');
      if (lblChecked) {
        lblChecked.textContent = `Última busca: ${new Date(proc.lastChecked).toLocaleString('pt-BR')}`;
      }
      
      renderPdfStatusCard(proc);
    }
    
    await renderDashboard();
    showToast('Processo sincronizado e histórico de movimentações atualizado!', 5000);
  } catch (err) {
    console.error('[Manual-Sync] Erro ao sincronizar processo:', err);
    showToast(`Erro na sincronização: ${err.message}`, 6000);
  } finally {
    btnEl.disabled = false;
    btnEl.innerHTML = originalHtml;
  }
}

// Busca atualizações para todos os processos monitorados em segundo plano (na inicialização)
async function syncAllMonitoredSilently() {
  const processes = await ProcessService.getProcesses();
  if (processes.length === 0) return;

  console.log(`[Auto-Sync] Iniciando varredura silenciosa em ${processes.length} processos...`);
  
  // Faz a varredura sequencial para não sobrecarregar as requisições
  for (const proc of processes) {
    if (proc.archived) continue; // Pula processos arquivados!
    await syncSingleProcessSilently(proc.numeroProcesso);
    // Pequeno intervalo entre requisições
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('[Auto-Sync] Varredura silenciosa de processos finalizada!');
}

/* ==========================================================================
   CONFIGURAÇÕES: SALVAR, EXPORTAR E IMPORTAR
   ========================================================================== */

async function saveSettings() {
  const sUrl = document.getElementById('settings-supabase-url').value.trim();
  const sAnon = document.getElementById('settings-supabase-anon-key').value.trim();
  const sBucket = document.getElementById('settings-supabase-bucket').value.trim();

  if (sUrl) {
    supabaseUrl = sUrl;
    localStorage.setItem('supabase_url', sUrl);
  } else {
    supabaseUrl = DEFAULT_SUPABASE_URL;
    localStorage.removeItem('supabase_url');
  }

  if (sAnon) {
    supabaseAnonKey = sAnon;
    localStorage.setItem('supabase_anon_key', sAnon);
  } else {
    supabaseAnonKey = DEFAULT_SUPABASE_ANON_KEY;
    localStorage.removeItem('supabase_anon_key');
  }

  if (sBucket) {
    supabaseBucket = sBucket;
    localStorage.setItem('supabase_bucket', sBucket);
  } else {
    supabaseBucket = DEFAULT_SUPABASE_BUCKET;
    localStorage.removeItem('supabase_bucket');
  }

  supabaseClient = null; // Invalida cliente antigo para recriar com novas chaves

  closeDialog('settings-dialog');
  await renderDashboard();
  showToast('Configurações salvas!');
}

async function exportData() {
  const processes = await ProcessService.getProcesses();
  if (processes.length === 0) {
    showToast('Não há dados cadastrados para exportação.');
    return;
  }

  const jsonStr = JSON.stringify(processes, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(jsonStr);
  const filename = `datajud_monitor_backup_${new Date().toISOString().slice(0,10)}.json`;

  const link = document.createElement('a');
  link.setAttribute('href', dataUri);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast('Backup exportado com sucesso!');
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(event) {
    try {
      const imported = JSON.parse(event.target.result);
      if (!Array.isArray(imported)) throw new Error();

      const current = await ProcessService.getProcesses();
      let addedCount = 0;

      imported.forEach(proc => {
        if (proc.numeroProcesso && !current.some(c => c.numeroProcesso === proc.numeroProcesso)) {
          current.push(proc);
          addedCount++;
        }
      });

      await ProcessService.saveAll(current);
      await renderDashboard();
      showToast(`Importação finalizada! ${addedCount} novos processos importados.`);
    } catch (err) {
      showToast('Erro ao importar arquivo JSON. Formato corrompido ou inválido.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

async function clearAllLocalData() {
  if (confirm('ATENÇÃO: Isso apagará de forma PERMANENTE todos os seus processos monitorados e pareceres. Deseja prosseguir?')) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = async () => {
      await renderDashboard();
      showToast('Todos os processos foram apagados.');
      closeDialog('settings-dialog');
    };
  }
}

/* ==========================================================================
   UTILITÁRIOS E FORMATADORES
   ========================================================================== */

function formatProcessNumber(num) {
  const clean = num.replace(/[^0-9]/g, '');
  if (clean.length !== 20) return num;
  
  return `${clean.substring(0,7)}-${clean.substring(7,9)}.${clean.substring(9,13)}.${clean.substring(13,14)}.${clean.substring(14,16)}.${clean.substring(16,20)}`;
}

function formatCNJRaw(clean) {
  if (clean.length !== 20) return clean;
  return `${clean.substring(0,7)}${clean.substring(7,9)}${clean.substring(9,13)}${clean.substring(13,14)}${clean.substring(14,16)}${clean.substring(16,20)}`;
}

function formatDocument(doc) {
  const clean = doc.replace(/[^0-9]/g, '');
  if (clean.length === 11) {
    return `${clean.substring(0,3)}.${clean.substring(3,6)}.${clean.substring(6,9)}-${clean.substring(9,11)}`;
  } else if (clean.length === 14) {
    return `${clean.substring(0,2)}.${clean.substring(2,5)}.${clean.substring(5,8)}/${clean.substring(8,12)}-${clean.substring(12,14)}`;
  }
  return doc;
}

function showToast(message, duration = 3500) {
  const container = document.getElementById('snackbar-container');
  const toast = document.createElement('div');
  toast.className = 'snackbar';
  toast.innerHTML = `
    <span class="snackbar-text">${message}</span>
    <button class="snackbar-action" onclick="this.parentElement.remove()">OK</button>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ==========================================================================
   MÓDULO DE AGENDA E TAREFAS DO PERITO (CALENDÁRIO & TO-DO)
   ========================================================================== */

// Inicializa e renderiza a aba de Agenda e Tarefas
function renderAgendaTab() {
  if (!activeProcess) return;

  // Se o processo ainda não possui o array de tarefas, inicializa vazio
  if (!activeProcess.tasks) {
    activeProcess.tasks = [];
  }

  // Define mês e ano padrão baseados na data do primeiro prazo ou na data de hoje
  if (activeProcess.tasks.length > 0 && !selectedCalendarDateStr) {
    const sortedTasks = [...activeProcess.tasks].filter(t => t.date).sort((a,b) => new Date(a.date) - new Date(b.date));
    if (sortedTasks.length > 0) {
      const firstTaskDate = new Date(sortedTasks[0].date + 'T00:00:00');
      currentCalendarMonth = firstTaskDate.getMonth();
      currentCalendarYear = firstTaskDate.getFullYear();
    }
  }

  renderCalendarWidget();
  renderTasksList();
}

// Renderiza a grade de dias do calendário
function renderCalendarWidget() {
  const container = document.getElementById('calendar-days-container');
  const monthYearLabel = document.getElementById('calendar-month-year');
  container.innerHTML = '';

  const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  monthYearLabel.textContent = `${monthNames[currentCalendarMonth]} ${currentCalendarYear}`;

  // Primeiro dia do mês e total de dias do mês
  const firstDayIndex = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();
  const totalDays = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();

  // Dias em branco do mês anterior para alinhar o dia 1 da semana
  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day-cell empty';
    container.appendChild(emptyCell);
  }

  const today = new Date();

  // Dias reais do mês
  for (let day = 1; day <= totalDays; day++) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day-cell';
    dayCell.textContent = day;

    const dateStr = `${currentCalendarYear}-${String(currentCalendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Marca se for o dia de hoje
    if (today.getDate() === day && today.getMonth() === currentCalendarMonth && today.getFullYear() === currentCalendarYear) {
      dayCell.classList.add('today');
    }

    // Verifica se possui prazos/tarefas agendadas nesta data
    const hasDeadlines = activeProcess.tasks?.some(t => t.date === dateStr && !t.completed);
    if (hasDeadlines) {
      dayCell.classList.add('has-deadline');
    }

    // Se for o dia selecionado atualmente, destaca-o
    if (selectedCalendarDateStr === dateStr) {
      dayCell.classList.add('selected');
    }

    dayCell.addEventListener('click', () => {
      document.querySelectorAll('.calendar-day-cell').forEach(c => c.classList.remove('selected'));
      dayCell.classList.add('selected');
      selectedCalendarDateStr = dateStr;
      renderSelectedDayDetails(dateStr);
    });

    container.appendChild(dayCell);
  }

  // Atualiza detalhes do dia selecionado
  if (selectedCalendarDateStr) {
    renderSelectedDayDetails(selectedCalendarDateStr);
  } else {
    document.getElementById('selected-day-title').textContent = "Selecione uma data no calendário";
    document.getElementById('calendar-selected-day-details').innerHTML = `
      <p style="font-size: 11px; color: var(--md-sys-color-on-surface-variant); margin: 0;">Nenhum prazo selecionado no momento.</p>
    `;
  }
}

// Renderiza os prazos específicos da data clicada no calendário
function renderSelectedDayDetails(dateStr) {
  const title = document.getElementById('selected-day-title');
  const detailsContainer = document.getElementById('calendar-selected-day-details');

  const [year, month, day] = dateStr.split('-');
  const dateFormatted = `${day}/${month}/${year}`;
  title.textContent = `Prazos em ${dateFormatted}:`;

  const dayDeadlines = activeProcess.tasks?.filter(t => t.date === dateStr) || [];

  if (dayDeadlines.length === 0) {
    detailsContainer.innerHTML = `
      <p style="font-size: 11px; color: var(--md-sys-color-on-surface-variant); margin: 0;">Não há prazos agendados para este dia.</p>
    `;
  } else {
    detailsContainer.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'selected-day-deadlines';

    dayDeadlines.forEach(t => {
      const item = document.createElement('div');
      item.className = 'day-deadline-item';
      if (t.completed) {
        item.style.borderLeftColor = 'var(--md-sys-color-outline)';
        item.style.backgroundColor = 'var(--md-sys-color-surface-variant)';
        item.style.color = 'var(--md-sys-color-on-surface-variant)';
        item.style.opacity = '0.7';
      }
      item.innerHTML = `
        <h5>${t.title} ${t.completed ? '(Concluída)' : ''}</h5>
        <p>${t.description || ''}</p>
        ${t.cpcArticle ? `<strong style="font-size: 10px; display: block; margin-top: 4px;">Fundamento: ${t.cpcArticle}</strong>` : ''}
      `;
      wrapper.appendChild(item);
    });
    detailsContainer.appendChild(wrapper);
  }
}

// Renderiza a lista de tarefas do perito (Checklist To-do)
function renderTasksList() {
  const container = document.getElementById('tasks-list-container');
  container.innerHTML = '';

  if (!activeProcess.tasks || activeProcess.tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 20px 0;">
        <span class="material-symbols-rounded empty-icon" style="font-size: 36px;">checklist</span>
        <h4 style="font-size: 13px;">Nenhuma tarefa gerada</h4>
        <p style="font-size: 11px; max-width: 250px;">Adicione uma tarefa manual para acompanhar prazos importantes.</p>
      </div>
    `;
    return;
  }

  // Ordena as tarefas: não concluídas primeiro, depois por data
  const sortedTasks = [...activeProcess.tasks].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    return new Date(a.date || '9999-12-31') - new Date(b.date || '9999-12-31');
  });

  sortedTasks.forEach(task => {
    const item = document.createElement('div');
    item.className = 'task-item-checkbox';

    const dateLabel = task.date ? new Date(task.date + 'T00:00:00').toLocaleDateString('pt-BR') : 'Sem data';

    let alarmBadge = '';
    if (task.alarmDate && !task.completed) {
      const alarmDT = new Date(task.alarmDate);
      const alarmLabel = `${alarmDT.toLocaleDateString('pt-BR')} ${alarmDT.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      alarmBadge = `<span class="task-cpc-badge" style="background-color: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); display: inline-flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 11px;">alarm</span>${alarmLabel}</span>`;
    }

    let originLinkHtml = '';
    if (task.decisionPage) {
      if (activeProcess.pdfPath) {
        const pageNum = task.decisionPage.replace(/[^0-9]/g, '');
        originLinkHtml = `<div style="margin-top: 4px; font-size: 11px;"><a href="#" onclick="openProcessPdfAtPage(${pageNum}); return false;" style="display: inline-flex; align-items: center; gap: 4px; color: var(--md-sys-color-primary); text-decoration: none;"><span class="material-symbols-rounded" style="font-size: 13px;">open_in_new</span> Ver decisão na ${task.decisionPage}</a></div>`;
      } else {
        originLinkHtml = `<div style="margin-top: 4px; font-size: 11px; color: var(--md-sys-color-outline); display: inline-flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 13px;">description</span> Localizado na ${task.decisionPage}</div>`;
      }
    }

    item.innerHTML = `
      <input type="checkbox" id="chk-${task.id}" ${task.completed ? 'checked' : ''}>
      <div class="task-checkbox-details">
        <span class="task-checkbox-title">${task.title}</span>
        <span class="task-checkbox-desc">${task.description || ''}</span>
        ${originLinkHtml}
        <div class="task-checkbox-badge-row">
          <span class="task-date-badge">${dateLabel}</span>
          ${task.cpcArticle ? `<span class="task-cpc-badge">${task.cpcArticle}</span>` : ''}
          ${alarmBadge}
        </div>
      </div>
      <div style="display: flex; gap: 4px;">
        <button class="md-btn-icon task-edit-btn" id="edit-${task.id}" title="Editar Tarefa">
          <span class="material-symbols-rounded" style="font-size: 18px;">edit</span>
        </button>
        <button class="md-btn-icon task-delete-btn" id="del-${task.id}" title="Excluir Tarefa">
          <span class="material-symbols-rounded" style="font-size: 18px;">delete</span>
        </button>
      </div>
    `;

    // Toggle de conclusão de tarefa
    const checkbox = item.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', async (e) => {
      const idx = activeProcess.tasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        activeProcess.tasks[idx].completed = e.target.checked;
        await ProcessService.update(activeProcess);
        renderCalendarWidget();
        renderTasksList();
      }
    });

    // Evento de edição
    const editBtn = item.querySelector('.task-edit-btn');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskEditDialog(task);
    });

    // Evento de deleção
    const delBtn = item.querySelector('.task-delete-btn');
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Deseja excluir a tarefa "${task.title}"?`)) {
        activeProcess.tasks = activeProcess.tasks.filter(t => t.id !== task.id);
        await ProcessService.update(activeProcess);
        renderCalendarWidget();
        renderTasksList();
      }
    });

    container.appendChild(item);
  });
}

function openTaskEditDialog(task) {
  document.getElementById('edit-task-id').value = task.id;
  document.getElementById('edit-task-title').value = task.title;
  document.getElementById('edit-task-desc').value = task.description || '';
  document.getElementById('edit-task-date').value = task.date || '';
  
  const hasAlarm = !!task.alarmDate;
  document.getElementById('edit-task-alarm-enable').checked = hasAlarm;
  
  const pickerContainer = document.getElementById('alarm-datetime-picker-container');
  const alarmInput = document.getElementById('edit-task-alarm-datetime');
  
  if (hasAlarm) {
    pickerContainer.style.display = 'block';
    alarmInput.value = task.alarmDate;
  } else {
    pickerContainer.style.display = 'none';
    alarmInput.value = '';
  }
  
  openDialog('task-edit-dialog');
}

async function saveTaskEdit() {
  if (!activeProcess) return;

  const taskId = document.getElementById('edit-task-id').value;
  const title = document.getElementById('edit-task-title').value.trim();
  const desc = document.getElementById('edit-task-desc').value.trim();
  const date = document.getElementById('edit-task-date').value;
  
  const alarmEnable = document.getElementById('edit-task-alarm-enable').checked;
  const alarmDatetime = document.getElementById('edit-task-alarm-datetime').value;

  if (!title) {
    showToast('O título da tarefa é obrigatório.', 3000);
    return;
  }
  if (!date) {
    showToast('A data de vencimento da tarefa é obrigatória.', 3000);
    return;
  }

  const idx = activeProcess.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) {
    showToast('Tarefa não localizada para edição.', 4000);
    return;
  }

  // Atualiza os dados
  const task = activeProcess.tasks[idx];
  task.title = title;
  task.description = desc;
  task.date = date;
  
  if (alarmEnable && alarmDatetime) {
    // Se o alarme foi redefinido ou alterado, limpa a flag alarmTriggered
    if (task.alarmDate !== alarmDatetime) {
      task.alarmDate = alarmDatetime;
      task.alarmTriggered = false;
    }
  } else {
    task.alarmDate = null;
    task.alarmTriggered = false;
  }

  await ProcessService.update(activeProcess);
  closeDialog('task-edit-dialog');
  showToast('Tarefa atualizada com sucesso!');
  
  // Atualiza visualização
  renderCalendarWidget();
  renderTasksList();
}

async function checkActiveAlarms() {
  if (!currentUserEmail) return;
  try {
    const processes = await ProcessService.getProcesses();
    let hasUpdates = false;
    const now = new Date();

    for (const process of processes) {
      if (!process.tasks || process.tasks.length === 0) continue;
      
      let processUpdated = false;
      for (const task of process.tasks) {
        if (task.completed) continue;
        if (!task.alarmDate) continue;
        if (task.alarmTriggered) continue;

        const alarmTime = new Date(task.alarmDate);
        if (alarmTime <= now) {
          console.log(`[Alarme] Disparando alarme para a tarefa: "${task.title}" do processo ${process.numeroProcesso}`);
          
          // Efeito Sonoro
          playBeep();
          setTimeout(playBeep, 200);
          
          // Alerta Visual
          showToast(`🚨 LEMBRETE: "${task.title}" (Processo: ${process.numeroProcesso})`, 8000);
          
          // Marca como disparado
          task.alarmTriggered = true;
          processUpdated = true;
          hasUpdates = true;
        }
      }

      if (processUpdated) {
        await ProcessService.update(process);
        
        // Se este processo for o que está aberto no detalhe, atualiza o estado ativo
        if (activeProcess && activeProcess.numeroProcesso === process.numeroProcesso) {
          activeProcess.tasks = process.tasks;
        }
      }
    }

    if (hasUpdates) {
      // Se o modal de detalhes estiver ativo, atualiza a lista de tarefas
      const detailDialog = document.getElementById('process-detail-dialog');
      if (detailDialog && detailDialog.classList.contains('active')) {
        renderTasksList();
      }
    }
  } catch (err) {
    console.error('[Alarme] Erro ao verificar alarmes ativos:', err);
  }
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // Nota Lá (A5)
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (err) {
    console.warn('[Alarme] Áudio do alarme bloqueado ou indisponível:', err);
  }
}

// Cria uma tarefa manual sob demanda
async function handleAddManualTask() {
  if (!activeProcess) return;

  const title = prompt('Digite o título da tarefa/prazo:');
  if (!title || title.trim() === '') return;

  const dateInput = prompt('Digite a data limite (formato DD/MM/AAAA):', new Date().toLocaleDateString('pt-BR'));
  if (!dateInput) return;

  // Valida e formata a data para YYYY-MM-DD
  const parts = dateInput.split('/');
  let dateFormatted = null;
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    if (year.length === 4 && !isNaN(day) && !isNaN(month) && !isNaN(year)) {
      dateFormatted = `${year}-${month}-${day}`;
    }
  }

  if (!dateFormatted) {
    alert('Formato de data inválido! Use o formato DD/MM/AAAA (ex: 20/07/2026).');
    return;
  }

  const desc = prompt('Digite uma descrição breve da tarefa (opcional):') || '';

  const newTask = {
    id: `task-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    title: title.trim(),
    date: dateFormatted,
    description: desc.trim(),
    cpcArticle: 'Manual',
    completed: false,
    source: 'manual'
  };

  if (!activeProcess.tasks) activeProcess.tasks = [];
  activeProcess.tasks.push(newTask);

  await ProcessService.update(activeProcess);
  showToast('Nova tarefa adicionada com sucesso!');
  
  // Atualiza a visualização
  renderCalendarWidget();
  renderTasksList();
}

// Realiza a busca e importação em lote de processos por nome
async function handleBatchImport() {
  const courtAlias = document.getElementById('settings-import-court').value;
  const nameInput = document.getElementById('settings-import-name').value.trim();
  const poloFilter = document.getElementById('settings-import-polo').value;

  if (!nameInput) {
    showToast('Por favor, informe o nome exato para buscar.');
    return;
  }

  const statusBox = document.getElementById('batch-import-status-box');
  const statusText = document.getElementById('batch-import-status-text');
  const detailsText = document.getElementById('batch-import-details');
  const spinner = document.getElementById('batch-import-spinner');
  const btnStart = document.getElementById('btn-start-batch-import');

  statusBox.style.display = 'block';
  statusText.textContent = 'Buscando processos no Datajud...';
  detailsText.textContent = `Consultando base do tribunal ${courtAlias.toUpperCase()} pelo nome "${nameInput}"`;
  spinner.className = 'material-symbols-rounded spinning';
  btnStart.disabled = true;

  try {
    // Elasticsearch query para buscar correspondência do nome da parte
    const query = {
      "size": 50,
      "query": {
        "match": {
          "partes.nome": nameInput
        }
      }
    };

    const response = await authFetch('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ''
      },
      body: JSON.stringify({
        tribunal: courtAlias,
        query: query,
        timeout: 20000 // Aumenta o tempo limite para pesquisas complexas
      })
    });

    if (!response.ok) {
      let errMsg = 'Falha ao pesquisar no Datajud.';
      try {
        const errJSON = await response.json();
        errMsg = errJSON.error || errMsg;
      } catch (ex) {}
      throw new Error(errMsg);
    }

    const data = await response.json();
    const hits = data.hits?.hits || [];

    if (hits.length === 0) {
      statusText.textContent = 'Busca finalizada.';
      detailsText.textContent = 'Nenhum processo com esse nome foi localizado na base deste tribunal.';
      spinner.className = 'material-symbols-rounded';
      btnStart.disabled = false;
      return;
    }

    // Mapeia os hits para o formato interno do Monitor usando a nova função
    const mapped = hits.map(hit => mapDatajudProcess(hit, courtAlias));

    // Filtra pelo nome exato ou contido (case-insensitive) e pelo polo especificado
    // A API do Datajud às vezes retorna abreviações ou qualificações (ex: "KLEBER CRISTIANO MAGRINI - PERITO")
    const searchNameClean = nameInput.toLowerCase().trim();
    const filtered = mapped.filter(proc => {
      return proc.partes?.some(part => {
        const partNameClean = part.nome.toLowerCase().trim();
        // Permite match exato ou contido (ex: nome buscado está contido no nome da parte da API ou vice-versa)
        const isNameMatch = partNameClean.includes(searchNameClean) || searchNameClean.includes(partNameClean);
        if (poloFilter === 'todos') {
          return isNameMatch;
        } else {
          return isNameMatch && part.polo === poloFilter;
        }
      });
    });

    if (filtered.length === 0) {
      statusText.textContent = 'Busca finalizada.';
      detailsText.textContent = `Foram encontrados ${mapped.length} registros no Datajud, mas nenhum atendeu aos critérios de filtragem de nome/polo das partes mapeadas.`;
      spinner.className = 'material-symbols-rounded';
      btnStart.disabled = false;
      return;
    }

    statusText.textContent = `Importando ${filtered.length} processos...`;
    let addedCount = 0;

    for (let i = 0; i < filtered.length; i++) {
      const proc = filtered[i];
      detailsText.textContent = `Gravando processo ${i+1}/${filtered.length}: ${formatProcessNumber(proc.numeroProcesso)}`;
      
      // Cria a ficha do expert inicial
      proc.expertInfo = getInitialExpertInfo(proc);
      
      const added = await ProcessService.add(proc);
      if (added) {
        addedCount++;
      }
    }

    await renderDashboard();
    statusText.textContent = 'Importação concluída!';
    detailsText.textContent = `Sucesso! Foram importados/atualizados ${addedCount} novos processos para monitoramento.`;
    spinner.className = 'material-symbols-rounded';
    btnStart.disabled = false;
    showToast(`${addedCount} novos processos importados com sucesso!`);
  } catch (error) {
    console.error(error);
    statusText.textContent = 'Erro na importação.';
    detailsText.textContent = error.message || 'Erro inesperado ao consultar o Datajud.';
    spinner.className = 'material-symbols-rounded';
    btnStart.disabled = false;
  }
}

/* ==========================================================================
   FUNÇÕES FINANCEIRAS (HONORÁRIOS E CORREÇÃO MONETÁRIA)
   ========================================================================== */

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function calculateUpdatedFees(value, baseDateStr, court, dataEntregaLaudo = null, archivedDate = null) {
  if (!value || isNaN(parseFloat(value))) return 0;
  const val = parseFloat(value);
  if (!baseDateStr) return val;
  
  const baseDate = new Date(baseDateStr + 'T12:00:00');
  if (isNaN(baseDate.getTime())) return val;
  
  let endDate = new Date();
  
  if (dataEntregaLaudo) {
    const deliveryDate = new Date(dataEntregaLaudo + 'T12:00:00');
    if (!isNaN(deliveryDate.getTime()) && deliveryDate < endDate) {
      endDate = deliveryDate;
    }
  }
  
  if (archivedDate) {
    const archiveDate = new Date(archivedDate + 'T12:00:00');
    if (!isNaN(archiveDate.getTime()) && archiveDate < endDate) {
      endDate = archiveDate;
    }
  }

  if (baseDate >= endDate) return val;
  
  // Calcular diferença exata em dias para atualização diária
  const diffTime = Math.max(0, endDate - baseDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  // 1. Correção Monetária TJSP: Tabela Prática usa IPCA-E/INPC. 
  // Média mensal histórica de ~0.38% a.m. equivale a uma taxa diária aproximada de:
  // (1 + 0.0038)^(1/30) - 1 ≈ 0.000126435 (ou 0.0126435% ao dia)
  const inflationRateDaily = Math.pow(1 + 0.0038, 1 / 30) - 1;
  const correctedVal = val * Math.pow(1 + inflationRateDaily, diffDays);
  
  // 2. Juros de Mora: 1% ao mês simples (Art. 406 do CC / CPC)
  // 1% ao mês equivale a 1/30 % ao dia = ~0.000333333 ao dia simples
  const interestRateDaily = 0.01 / 30;
  const interestVal = val * (interestRateDaily * diffDays);
  
  const totalUpdated = correctedVal + interestVal;
  return totalUpdated;
}

// Renderiza o Painel Financeiro do Dashboard
async function renderFinanceDashboard() {
  const processes = await ProcessService.getProcesses();
  const activeProcesses = processes.filter(p => !p.archived);
  
  const rowsContainer = document.getElementById('finance-table-rows');
  const txtNominal = document.getElementById('finance-total-nominal');
  const txtUpdated = document.getElementById('finance-total-updated');
  const txtDeposited = document.getElementById('finance-total-deposited');
  
  rowsContainer.innerHTML = '';
  
  let totalNominal = 0;
  let totalUpdated = 0;
  let totalDeposited = 0;
  
  if (activeProcesses.length === 0) {
    rowsContainer.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 32px; color: var(--md-sys-color-on-surface-variant);">
          Nenhum processo monitorado ativo para extrair informações financeiras.
        </td>
      </tr>
    `;
    txtNominal.textContent = formatCurrency(0);
    txtUpdated.textContent = formatCurrency(0);
    txtDeposited.textContent = formatCurrency(0);
    return;
  }
  
  activeProcesses.forEach(proc => {
    const info = proc.expertInfo || {};
    const hasFees = info.honorarios && !isNaN(parseFloat(info.honorarios));
    const valBase = hasFees ? parseFloat(info.honorarios) : 0;
    
    // Calcula valores corrigidos usando a data do depósito/honorários
    let valUpdated = 0;
    if (valBase > 0) {
      const baseDateStr = info.dataDeposito || info.dataHonorarios || proc.dataAjuizamento || null;
      valUpdated = calculateUpdatedFees(valBase, baseDateStr, proc.tribunal, info.dataEntregaLaudo, proc.archivedDate);
    }
    
    totalNominal += valBase;
    totalUpdated += valUpdated;
    
    const depositStatus = info.depositoJudicial || 'Não informado';
    if (depositStatus === 'Sim') {
      totalDeposited += valUpdated;
    } else if (depositStatus === 'Parcial') {
      totalDeposited += (valUpdated * 0.5); // 50% estimado
    }
    
    // Badge de status de depósito
    let badgeClass = 'no';
    let badgeLabel = 'Pendente';
    if (depositStatus === 'Sim') {
      badgeClass = 'yes';
      badgeLabel = 'Pago (Depositado)';
    } else if (depositStatus === 'Parcial') {
      badgeClass = 'partial';
      badgeLabel = 'Depósito Parcial';
    } else if (depositStatus === 'Não informado' || depositStatus === 'Não') {
      badgeClass = 'no';
      badgeLabel = 'Não Depositado';
    }
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="padding: 16px;">
        <span style="font-weight: 600; color: var(--md-sys-color-primary);">${formatProcessNumber(proc.numeroProcesso)}</span>
        <div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${info.objetoPericia || 'Objeto não informado'}
        </div>
      </td>
      <td style="padding: 16px; font-weight: 500;">${proc.tribunal.toUpperCase()}</td>
      <td style="padding: 16px;">${valBase > 0 ? formatCurrency(valBase) : '<span style="color: var(--md-sys-color-outline);">Não informado</span>'}</td>
      <td style="padding: 16px; font-weight: 600;">${valBase > 0 ? formatCurrency(valUpdated) : '<span style="color: var(--md-sys-color-outline);">-</span>'}</td>
      <td style="padding: 16px;">
        <span class="badge-deposit ${badgeClass}">${badgeLabel}</span>
      </td>
      <td style="padding: 16px; text-align: right;">
        <button class="md-btn md-btn-compact md-btn-text" onclick="openProcessFromFinance('${proc.numeroProcesso}')">
          Ver Ação
        </button>
      </td>
    `;
    rowsContainer.appendChild(row);
  });
  
  txtNominal.textContent = formatCurrency(totalNominal);
  txtUpdated.textContent = formatCurrency(totalUpdated);
  txtDeposited.textContent = formatCurrency(totalDeposited);
}

// Helper global para abrir o detalhe a partir do painel financeiro
window.openProcessFromFinance = async function(processNumber) {
  const list = await ProcessService.getProcesses();
  const proc = list.find(p => p.numeroProcesso === processNumber);
  if (proc) {
    openProcessDetails(proc);
  }
};

/* ==========================================================================
   ÁREA DE TAREFAS GLOBAL (DASHBOARD)
   ========================================================================== */

let currentGlobalTaskFilter = 'all';

window.filterGlobalTasks = function(filterType) {
  currentGlobalTaskFilter = filterType;
  
  document.querySelectorAll('.tasks-filters .md-btn-compact').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtnMap = {
    'all': 'btn-filter-tasks-all',
    'pending': 'btn-filter-tasks-pending',
    'overdue': 'btn-filter-tasks-overdue',
    'completed': 'btn-filter-tasks-completed'
  };
  
  const activeBtn = document.getElementById(activeBtnMap[filterType]);
  if (activeBtn) activeBtn.classList.add('active');
  
  renderTasksDashboard();
};

function calculateOverdueTasksCount(processesList) {
  let count = 0;
  const today = new Date();
  today.setHours(0,0,0,0);
  
  processesList.forEach(proc => {
    if (proc.tasks && Array.isArray(proc.tasks)) {
      proc.tasks.forEach(t => {
        if (!t.completed && t.date) {
          const dueDate = new Date(t.date);
          if (!isNaN(dueDate.getTime()) && dueDate < today) {
            count++;
          }
        }
      });
    }
  });
  return count;
}

async function renderTasksDashboard() {
  const container = document.getElementById('tasks-dashboard-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  const processes = await ProcessService.getProcesses();
  const activeProcesses = processes.filter(p => !p.archived);
  
  // Coleta todas as tarefas de processos ativos
  let allTasks = [];
  activeProcesses.forEach(proc => {
    if (proc.tasks && Array.isArray(proc.tasks)) {
      proc.tasks.forEach(t => {
        allTasks.push({
          ...t,
          processNo: proc.numeroProcesso,
          processObject: proc.expertInfo?.objetoPericia || 'Objeto não informado'
        });
      });
    }
  });
  
  // Ordena tarefas por data de vencimento (vencidas/mais próximas primeiro)
  allTasks.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  const today = new Date();
  today.setHours(0,0,0,0);
  
  // Filtro
  let filteredTasks = allTasks;
  if (currentGlobalTaskFilter === 'pending') {
    filteredTasks = allTasks.filter(t => !t.completed);
  } else if (currentGlobalTaskFilter === 'overdue') {
    filteredTasks = allTasks.filter(t => !t.completed && new Date(t.date) < today);
  } else if (currentGlobalTaskFilter === 'completed') {
    filteredTasks = allTasks.filter(t => t.completed);
  }
  
  if (filteredTasks.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container); border-radius: 12px; border: 1px dashed var(--md-sys-color-outline-variant);">
        Nenhuma tarefa encontrada neste filtro.
      </div>
    `;
    return;
  }
  
  filteredTasks.forEach(task => {
    const dueDate = new Date(task.date);
    const isOverdue = !task.completed && dueDate < today;
    const formattedDate = dueDate.toLocaleDateString('pt-BR');
    
    const taskCard = document.createElement('div');
    taskCard.style.display = 'flex';
    taskCard.style.alignItems = 'center';
    taskCard.style.justifyContent = 'space-between';
    taskCard.style.padding = '14px 16px';
    taskCard.style.borderRadius = '12px';
    taskCard.style.background = 'var(--md-sys-color-surface-container)';
    taskCard.style.border = isOverdue ? '1px solid var(--md-sys-color-error)' : '1px solid var(--md-sys-color-outline-variant)';
    if (task.completed) {
      taskCard.style.opacity = '0.7';
    }
    
    const checkboxId = `global-chk-${task.id}`;
    
    taskCard.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 12px; flex: 1;">
        <input type="checkbox" id="${checkboxId}" ${task.completed ? 'checked' : ''} style="margin-top: 4px; accent-color: var(--md-sys-color-primary); cursor: pointer; width: 18px; height: 18px;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-weight: 600; font-size: 14px; text-decoration: ${task.completed ? 'line-through' : 'none'}; color: ${isOverdue ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-on-surface)'};">
            ${task.title}
          </span>
          <span style="font-size: 11px; color: var(--md-sys-color-on-surface-variant);">
            <strong>Processo:</strong> ${formatProcessNumber(task.processNo)} - ${task.processObject}
          </span>
          ${task.description ? `<span style="font-size: 12px; color: var(--md-sys-color-on-surface-variant); font-style: italic;">${task.description}</span>` : ''}
        </div>
      </div>
      
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="display: flex; flex-direction: column; align-items: flex-end;">
          <span style="font-size: 12px; font-weight: 600; color: ${isOverdue ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-primary)'};">
            Vence em: ${formattedDate}
          </span>
          ${isOverdue ? '<span style="font-size: 10px; font-weight: 700; color: var(--md-sys-color-error); text-transform: uppercase;">Atrasada ⚠️</span>' : ''}
          ${task.completed ? '<span style="font-size: 10px; font-weight: 700; color: var(--md-sys-color-success); text-transform: uppercase;">Concluída</span>' : ''}
        </div>
      </div>
    `;
    
    // Checkbox toggling handler
    taskCard.querySelector(`#${checkboxId}`).addEventListener('change', async (e) => {
      const checked = e.target.checked;
      
      const procList = await ProcessService.getProcesses();
      const parentProc = procList.find(p => p.numeroProcesso === task.processNo);
      if (parentProc && parentProc.tasks) {
        const tObj = parentProc.tasks.find(t => t.id === task.id);
        if (tObj) {
          tObj.completed = checked;
          await ProcessService.update(parentProc);
          showToast(checked ? "Tarefa concluída!" : "Tarefa reaberta!");
          await renderDashboard(); // Recalcula totais/badges
          await renderTasksDashboard(); // Recarrega tela
        }
      }
    });
    
    container.appendChild(taskCard);
  });
}

/* ==========================================================================
   LISTA DE PROCESSO ARQUIVADOS NAS CONFIGURAÇÕES
   ========================================================================== */

async function renderSettingsArchivedList() {
  const container = document.getElementById('settings-archived-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  const processes = await ProcessService.getProcesses();
  const archivedProcesses = processes.filter(p => p.archived);
  
  if (archivedProcesses.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--md-sys-color-on-surface-variant); font-size: 13px;">
        Nenhum processo arquivado encontrado.
      </div>
    `;
    return;
  }
  
  archivedProcesses.forEach(proc => {
    const item = document.createElement('div');
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.justifyContent = 'space-between';
    item.style.padding = '10px 12px';
    item.style.borderRadius = '8px';
    item.style.background = 'var(--md-sys-color-surface-container)';
    item.style.border = '1px solid var(--md-sys-color-outline-variant)';
    
    item.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <span style="font-weight: 600; font-size: 13px; color: var(--md-sys-color-primary);">
          ${formatProcessNumber(proc.numeroProcesso)}
        </span>
        <span style="font-size: 11px; color: var(--md-sys-color-on-surface-variant); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${proc.expertInfo?.objetoPericia || 'Objeto não informado'}
        </span>
      </div>
      <button class="md-btn md-btn-compact md-btn-tonal" style="padding: 4px 8px; font-size: 11px; gap: 4px;">
        <span class="material-symbols-rounded" style="font-size: 14px;">unarchive</span>
        <span>Desarquivar</span>
      </button>
    `;
    
    item.querySelector('button').addEventListener('click', async () => {
      proc.archived = false;
      await ProcessService.update(proc);
      showToast(`Processo ${formatProcessNumber(proc.numeroProcesso)} desarquivado!`);
      await renderDashboard();
      await renderSettingsArchivedList();
    });
    
    container.appendChild(item);
  });
}

/* ==========================================================================
   RADAR DE NOMEAÇÕES (DIÁRIOS OFICIAIS)
   ========================================================================== */

async function performRadarScan() {
  if (!jwtToken) return;

  const btn = document.getElementById('btn-radar-scan');
  const icon = document.getElementById('radar-scan-icon');
  const text = document.getElementById('radar-scan-text');
  const statusBox = document.getElementById('radar-scan-status');
  const statusText = document.getElementById('radar-scan-status-text');
  const detailsText = document.getElementById('radar-scan-details');
  const spinner = document.getElementById('radar-scan-spinner');

  btn.disabled = true;
  icon.textContent = 'sync';
  icon.className = 'material-symbols-rounded spinning';
  text.textContent = 'Vasculhando...';
  statusBox.style.display = 'flex';
  statusText.textContent = 'Vasculhando tribunais no Datajud em busca de nomeações...';
  detailsText.textContent = 'Consultando base oficial do CNJ...';
  spinner.className = 'material-symbols-rounded spinning';

  try {
    const response = await fetch('/api/radar/scan', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        'x-api-key': ''
      }
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Falha ao escanear tribunais.');
    }

    const result = await response.json();

    statusText.textContent = `Busca concluída! ${result.found} nomeação(ns) encontrada(s) em ${result.tribunalsWithResults.length} tribunal(is).`;
    detailsText.textContent = `${result.tribunalsScanned} tribunais vasculhados.`;

    localStorage.setItem('radarLastScan', new Date().toISOString());
    document.getElementById('radar-last-scan-label').textContent = `Última varredura: ${new Date().toLocaleString('pt-BR')}`;

    await updateRadarBadgeCount();
    await renderRadarDashboard();
  } catch (err) {
    statusText.textContent = 'Erro na varredura.';
    detailsText.textContent = err.message;
    showToast('Erro ao buscar nomeações: ' + err.message);
  } finally {
    btn.disabled = false;
    icon.textContent = 'radar';
    icon.className = 'material-symbols-rounded';
    text.textContent = 'Buscar Nomeações';
    setTimeout(() => { statusBox.style.display = 'none'; }, 8000);
  }
}

async function updateRadarBadgeCount() {
  if (!jwtToken) return;
  try {
    const response = await fetch('/api/radar/notifications', {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      const badge = document.getElementById('badge-radar-count');
      if (badge) {
        if (data.length > 0) {
          badge.textContent = data.length;
          badge.style.display = 'inline-flex';
          badge.style.alignItems = 'center';
          badge.style.justifyContent = 'center';
        } else {
          badge.style.display = 'none';
        }
      }
    }
  } catch (err) {
    console.error("Erro ao atualizar contador do radar:", err);
  }
}

async function renderRadarDashboard() {
  const container = document.getElementById('radar-notifications-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  try {
    const response = await fetch('/api/radar/notifications', {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    });
    
    if (!response.ok) {
      throw new Error("Erro ao buscar publicações do radar.");
    }
    
    const list = await response.json();
    
    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 48px; background: var(--md-sys-color-surface-container); border: 1px dashed var(--md-sys-color-outline-variant); border-radius: 16px; color: var(--md-sys-color-on-surface-variant);">
          <span class="material-symbols-rounded" style="font-size: 48px; margin-bottom: 8px;">radar</span>
          <h3>Tudo limpo por aqui!</h3>
          <p style="font-size: 13px;">O radar não encontrou nenhuma nova publicação de nomeação para seus dados nas últimas 24 horas.</p>
        </div>
      `;
      return;
    }
    
    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'radar-card';
      card.style.background = 'var(--md-sys-color-surface-container)';
      card.style.border = '1px solid var(--md-sys-color-outline-variant)';
      card.style.borderRadius = '16px';
      card.style.padding = '20px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '12px';
      
      card.innerHTML = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div>
            <span style="font-size: 10px; font-weight: 700; background: var(--md-sys-color-tertiary-container); color: var(--md-sys-color-on-tertiary-container); padding: 4px 8px; border-radius: 6px; text-transform: uppercase;">
              Nomeação Localizada
            </span>
            <h4 style="margin: 6px 0 2px 0; font-size: 16px; color: var(--md-sys-color-primary);">
              Processo: ${formatProcessNumber(item.numeroProcesso)}
            </h4>
            <span style="font-size: 12px; color: var(--md-sys-color-on-surface-variant);">
              <strong>Publicado em:</strong> ${new Date(item.dataPublicacao).toLocaleDateString('pt-BR')} | <strong>Diário:</strong> ${item.diario}
            </span>
            <div style="margin-top: 6px;">
              <a href="${item.linkPublicacao}" target="_blank" style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--md-sys-color-primary); font-weight: 600; text-decoration: underline;">
                <span class="material-symbols-rounded" style="font-size: 16px;">open_in_new</span>
                <span>Visualizar Publicação Oficial (e-SAJ/Tribunal)</span>
              </a>
            </div>
          </div>
          <button class="md-btn md-btn-primary btn-import-radar" style="gap: 8px; background: var(--md-sys-color-tertiary); color: var(--md-sys-color-on-tertiary);">
            <span class="material-symbols-rounded">cloud_download</span>
            <span>Importar Nomeação</span>
          </button>
        </div>
        
        <div style="background: var(--md-sys-color-surface); padding: 12px; border-radius: 8px; border-left: 4px solid var(--md-sys-color-tertiary); font-size: 13px; line-height: 1.5; color: var(--md-sys-color-on-surface); font-style: italic;">
          "${item.trecho}"
        </div>
        
        <div style="display: flex; gap: 16px; font-size: 12px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container-high); padding: 8px 12px; border-radius: 8px;">
          <span>💰 <strong>Honorários Sugeridos:</strong> ${formatCurrency(item.honorariosSugeridos)}</span>
          <span>🔍 <strong>Objeto da Perícia:</strong> ${item.objetoSugerido}</span>
        </div>
      `;
      
      card.querySelector('.btn-import-radar').addEventListener('click', async () => {
        if (!confirm(`Deseja importar a nomeação processual ${formatProcessNumber(item.numeroProcesso)} para sua lista de monitoramento?`)) {
          return;
        }
        
        try {
          showToast("Consultando API do Datajud...");
          const cleanCNJ = item.numeroProcesso.replace(/[^0-9]/g, '');
          
          let officialProcess;
          try {
            // Busca o processo oficial real na API do Datajud
            officialProcess = await fetchProcessFromAPI(cleanCNJ, item.tribunal);
            
            // Inicializa a Ficha do Expert com os dados e comarca reais do Datajud
            officialProcess.expertInfo = getInitialExpertInfo(officialProcess);
          } catch (apiErr) {
            console.warn("Falha ao buscar no Datajud, importando provisoriamente com dados do Diário Oficial:", apiErr);
            
            // Cria um processo provisório contendo os dados do Diário Oficial para não travar o usuário
            officialProcess = {
              id: `${currentUserEmail}_${item.numeroProcesso}`,
              userEmail: currentUserEmail,
              numeroProcesso: item.numeroProcesso,
              tribunal: item.tribunal,
              classe: { nome: 'Procedimento Comum Cível' },
              assuntos: [{ nome: 'Honorários Periciais / Nomeação' }],
              orgaoJulgador: { nome: item.diario },
              dataAjuizamento: new Date(Date.now() - 90*24*60*60*1000).toISOString(),
              partes: [
                { nome: 'Requerente (Polo Ativo)', polo: 'ATIVO', tipo: 'Física', numeroDocumentoPrincipal: null },
                { nome: 'Requerido (Polo Passivo)', polo: 'PASSIVO', tipo: 'Jurídica', numeroDocumentoPrincipal: null }
              ],
              movimentos: [],
              expertInfo: {
                autor: 'Aguardando atualização do Datajud',
                reu: 'Aguardando atualização do Datajud',
                perito: currentUserEmail,
                justicaGratuita: 'Não informado',
                objetoPericia: item.objetoSugerido,
                objetoPericiaEdit: item.objetoSugerido,
                cidadeEstado: item.tribunal.toUpperCase() === 'TJSP' ? 'São Paulo/TJSP' : 'Justiça Federal',
                inversaoOnus: 'não',
                honorarios: item.honorariosSugeridos.toString(),
                honorariosEdit: item.honorariosSugeridos.toString(),
                depositoJudicial: 'Não',
                dataHonorarios: item.dataPublicacao,
                dataHonorariosEdit: item.dataPublicacao
              },
              archived: false,
              lastChecked: new Date().toISOString(),
              isProvisional: true // Marcador de importação provisória
            };
            
            showToast("A API do Datajud está indisponível. Processo importado provisoriamente com os dados do Diário Oficial.", 7000);
          }
          
          // Mescla com as informações extraídas do diário oficial (caso tenha vindo da API oficial)
          if (!officialProcess.isProvisional) {
            officialProcess.expertInfo.perito = currentUserEmail;
            officialProcess.expertInfo.objetoPericia = item.objetoSugerido;
            officialProcess.expertInfo.objetoPericiaEdit = item.objetoSugerido;
            officialProcess.expertInfo.honorarios = item.honorariosSugeridos.toString();
            officialProcess.expertInfo.honorariosEdit = item.honorariosSugeridos.toString();
            officialProcess.expertInfo.dataHonorarios = item.dataPublicacao;
            officialProcess.expertInfo.dataHonorariosEdit = item.dataPublicacao;
          }
          
          // Injeta a movimentação de publicação do Diário Oficial nos andamentos
          if (!officialProcess.movimentos) officialProcess.movimentos = [];
          
          const hasDjeMov = officialProcess.movimentos.some(m => m.nome === 'PUBLICAÇÃO DE NOMEAÇÃO (RADAR)');
          if (!hasDjeMov) {
            officialProcess.movimentos.unshift({
              nome: 'PUBLICAÇÃO DE NOMEAÇÃO (RADAR)',
              dataHora: new Date(item.dataPublicacao).toISOString(),
              detalhes: item.trecho
            });
          }
          
          officialProcess.userEmail = currentUserEmail;
          officialProcess.id = `${currentUserEmail}_${officialProcess.numeroProcesso}`;
          officialProcess.archived = false;
          
          await ProcessService.add(officialProcess);
          
          const markResponse = await fetch('/api/radar/import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${jwtToken}`
            },
            body: JSON.stringify({ id: item.id })
          });
          
          if (!markResponse.ok) {
            console.error("Erro ao registrar importação no radar backend.");
          }
          
          showToast(`Processo ${formatProcessNumber(item.numeroProcesso)} importado com sucesso!`);
          await updateRadarBadgeCount();
          document.getElementById('btn-dash-tab-processes').click();
          await renderDashboard();
        } catch (err) {
          showToast("Erro ao importar do radar: " + err.message);
        }
      });
      
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `
      <div style="color: var(--md-sys-color-error); text-align: center; padding: 24px;">
        Erro ao carregar o radar de nomeações: ${err.message}
      </div>
    `;
  }
}

/* ==========================================================================
   ANÁLISE DE PROCESSOS COM IA (GROQ)
   ========================================================================== */

async function callAIApi(prompt) {
  console.log('[AI] Enviando prompt para servidor proxy. Tamanho:', prompt.length);

  const response = await authFetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    let errMsg = 'Erro na análise de IA.';
    try {
      const err = await response.json();
      errMsg = err.error || errMsg;
    } catch(ex) {}
    throw new Error(`${errMsg} (${response.status})`);
  }

  const data = await response.json();
  console.log('[AI] Resposta bruta da Groq:', data);

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Resposta vazia da IA.');

  console.log('[AI] Conteúdo da resposta:', text.substring(0, 200));

  let jsonStr = text.trim();

  // Tenta extrair o JSON de dentro de blocos de marcação markdown ```json ... ```
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match && match[1]) {
    jsonStr = match[1].trim();
  } else {
    // Se não encontrou o bloco, busca a primeira ocorrência de '{' e a última '}'
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1).trim();
    }
  }

  const parsed = JSON.parse(jsonStr);
  console.log('[AI] JSON parseado:', parsed);

  if (!parsed.summary) parsed.summary = '';
  if (!parsed.fields) parsed.fields = {};
  if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
  return parsed;
}

function buildAIPrompt(proc) {
  const expert = proc.expertInfo || {};
  const tasks = proc.tasks || [];

  // Constrói lista de movimentações (limitado às 30 mais recentes para evitar exceder limites de tokens da IA)
  const movimentosStr = (proc.movimentos || []).slice(0, 10).map((m, i) => {
    const data = m.dataHora ? new Date(m.dataHora).toLocaleString('pt-BR') : 'data não informada';
    return `  ${i+1}. [${data}] ${m.nome}${m.detalhes ? ' - ' + m.detalhes : ''}`;
  }).join('\n');

  // Constrói lista completa de partes
  const partesStr = (proc.partes || []).map(p => {
    return `  - ${p.nome} (${p.polo === 'ATIVO' ? 'Requerente' : 'Requerido'}, ${p.tipo || 'N/I'})`;
  }).join('\n');

  // Assuntos
  const assuntosStr = (proc.assuntos || []).map(a => a.nome).join(', ');

  // Expert info completa
  let expertStr = '';
  if (expert.autor) expertStr += `\n- Autor: ${expert.autor}`;
  if (expert.reu) expertStr += `\n- Réu: ${expert.reu}`;
  if (expert.perito) expertStr += `\n- Perito: ${expert.perito}`;
  if (expert.justicaGratuita) expertStr += `\n- Justiça Gratuita: ${expert.justicaGratuita}`;
  if (expert.cidadeEstado) expertStr += `\n- Comarca: ${expert.cidadeEstado}`;
  if (expert.objetoPericia) expertStr += `\n- Objeto da Perícia: ${expert.objetoPericia}`;
  if (expert.inversaoOnus) expertStr += `\n- Inversão do Ônus: ${expert.inversaoOnus}`;
  if (expert.honorarios) expertStr += `\n- Honorários: ${expert.honorarios}`;
  if (expert.depositoJudicial) expertStr += `\n- Depósito Judicial: ${expert.depositoJudicial}`;
  if (expert.valorDeposito) expertStr += `\n- Valor do Depósito: ${expert.valorDeposito}`;
  if (expert.dataDeposito) expertStr += `\n- Data do Depósito: ${expert.dataDeposito}`;
  if (expert.dataEntregaLaudo) expertStr += `\n- Data Entrega do Laudo: ${expert.dataEntregaLaudo}`;
  if (expert.resumoProcesso) expertStr += `\n- Resumo do Processo: ${expert.resumoProcesso}`;

  // Filtro Inteligente de PDF (Keyword Context Scanner)
  // Preserva os primeiros 5.000 caracteres (capa/foro/partes do processo) e anexa trechos com termos chave do restante do PDF de trás para frente
  let pdfText = '';
  if (proc.pdfText) {
    pdfText = proc.pdfText.substring(0, 5000);
    
    let relevantExcerpts = [];
    let currentLength = pdfText.length;
    
    // Tier 1: Termos jurídicos de nomeação, honorários e prova altamente cruciais
    const tier1 = ['perito', 'nomeio', 'nomeação', 'honorários', 'depósito', 'arbitro', 'inversão', 'ônus', 'ufesp'];
    // Tier 2: Termos secundários de ritos e prazos que podem gerar muito ruído/exceder o buffer
    const tier2 = ['laudo', 'prazo', 'intimação', 'intime', 'gratuita'];

    if (proc.pdfText.includes('[PÁGINA ')) {
      const pageBlocks = proc.pdfText.split(/\[PÁGINA /);
      
      // Pass 1: Busca apenas Tier 1 de trás para frente para priorizar dados de expert e perícia
      for (let p = pageBlocks.length - 1; p >= 1; p--) {
        const block = pageBlocks[p];
        const closeBracketIndex = block.indexOf(']');
        if (closeBracketIndex === -1) continue;
        
        const pageNum = block.substring(0, closeBracketIndex).trim();
        const pageContent = block.substring(closeBracketIndex + 1);
        
        const pageLines = pageContent.split('\n');
        for (let i = pageLines.length - 1; i >= 0; i--) {
          const line = pageLines[i].trim();
          if (line.length < 10) continue;
          
          const lineLower = line.toLowerCase();
          const hasTier1 = tier1.some(kw => lineLower.includes(kw));
          
          if (hasTier1) {
            const prevLine = i > 0 ? pageLines[i-1].trim() : '';
            const nextLine = i < pageLines.length - 1 ? pageLines[i+1].trim() : '';
            const excerpt = `\n[Página ${pageNum} - Linha ${i}]:\n${prevLine ? prevLine + '\n' : ''}${line}\n${nextLine ? nextLine + '\n' : ''}`;
            
            if (currentLength + excerpt.length < 6500) {
              relevantExcerpts.push(excerpt);
              currentLength += excerpt.length;
            } else {
              break;
            }
          }
        }
        if (currentLength >= 6500) break;
      }
      
      // Pass 2: Se ainda houver cota de caracteres, busca Tier 2 de trás para frente
      if (currentLength < 6500) {
        for (let p = pageBlocks.length - 1; p >= 1; p--) {
          const block = pageBlocks[p];
          const closeBracketIndex = block.indexOf(']');
          if (closeBracketIndex === -1) continue;
          
          const pageNum = block.substring(0, closeBracketIndex).trim();
          const pageContent = block.substring(closeBracketIndex + 1);
          
          const pageLines = pageContent.split('\n');
          for (let i = pageLines.length - 1; i >= 0; i--) {
            const line = pageLines[i].trim();
            if (line.length < 10) continue;
            
            const lineLower = line.toLowerCase();
            const hasTier1 = tier1.some(kw => lineLower.includes(kw));
            if (hasTier1) continue; // Evita duplicar o que já foi lido no Pass 1
            
            const hasTier2 = tier2.some(kw => lineLower.includes(kw));
            if (hasTier2) {
              const prevLine = i > 0 ? pageLines[i-1].trim() : '';
              const nextLine = i < pageLines.length - 1 ? pageLines[i+1].trim() : '';
              const excerpt = `\n[Página ${pageNum} - Linha ${i}]:\n${prevLine ? prevLine + '\n' : ''}${line}\n${nextLine ? nextLine + '\n' : ''}`;
              
              if (currentLength + excerpt.length < 6500) {
                relevantExcerpts.push(excerpt);
                currentLength += excerpt.length;
              } else {
                break;
              }
            }
          }
          if (currentLength >= 6500) break;
        }
      }
    } else {
      // Fallback para PDFs antigos sem marcação de página
      // Pass 1
      const lines = proc.pdfText.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.length < 10) continue;
        const lineLower = line.toLowerCase();
        const hasTier1 = tier1.some(kw => lineLower.includes(kw));
        if (hasTier1) {
          const prevLine = i > 0 ? lines[i-1].trim() : '';
          const nextLine = i < lines.length - 1 ? lines[i+1].trim() : '';
          const excerpt = `\n[Trecho relevante - Linha ${i}]:\n${prevLine ? prevLine + '\n' : ''}${line}\n${nextLine ? nextLine + '\n' : ''}`;
          if (currentLength + excerpt.length < 6500) {
            relevantExcerpts.push(excerpt);
            currentLength += excerpt.length;
          } else {
            break;
          }
        }
      }
      // Pass 2
      if (currentLength < 6500) {
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.length < 10) continue;
          const lineLower = line.toLowerCase();
          const hasTier1 = tier1.some(kw => lineLower.includes(kw));
          if (hasTier1) continue;
          const hasTier2 = tier2.some(kw => lineLower.includes(kw));
          if (hasTier2) {
            const prevLine = i > 0 ? lines[i-1].trim() : '';
            const nextLine = i < lines.length - 1 ? lines[i+1].trim() : '';
            const excerpt = `\n[Trecho genérico - Linha ${i}]:\n${prevLine ? prevLine + '\n' : ''}${line}\n${nextLine ? nextLine + '\n' : ''}`;
            if (currentLength + excerpt.length < 6500) {
              relevantExcerpts.push(excerpt);
              currentLength += excerpt.length;
            } else {
              break;
            }
          }
        }
      }
    }
    
    if (relevantExcerpts.length > 0) {
      pdfText += '\n\n--- [TRECHOS SELECIONADOS DO PROCESSO COM AS PÁGINAS DE ORIGEM] ---\n' + relevantExcerpts.join('\n');
    }
  }

  return `Você é um assistente jurídico especializado em direito processual civil brasileiro (CPC). Sua função principal e OBRIGAÇÃO MANDATÓRIA ABSOLUTA é EXTRAIR os dados cadastrais do processo e da Ficha Técnica do Expert/Perito a partir do texto do PDF e das seções informadas.
 
INSTRUÇÕES MANDATÓRIAS DE PREENCHIMENTO:
- É OBRIGATÓRIO EXTRAIR E PREENCHER os dados de AUTOR, RÉU, CLASSE, ASSUNTO e ÓRGÃO JULGADOR.
- Analise a capa e o cabeçalho do PDF (primeiras páginas) e consulte os blocos "PARTES DO PROCESSO" e "DADOS COMPLETOS DO PROCESSO" fornecidos abaixo.
- NUNCA retorne "Autor Não Informado", "Réu Não Informado", "Ação Judicial" ou "Assunto Geral" no JSON se houver qualquer nome ou dado de processo no PDF ou nos blocos de texto abaixo.
- As informações de "perito" (nome completo do perito nomeado), "inversaoOnus", "honorarios" e "depositoJudicial" também devem ser extraídas atentamente se presentes no PDF.

PREENCHA TODOS OS CAMPOS. Retorne UM JSON válido com esta estrutura exata:
{
  "summary": "resumo detalhado em 3-6 frases extraído do PDF, cobrindo partes, objeto, estágio atual e próximos passos processuais",
  "fields": {
    "autor": "nome completo do autor/requerente extraído do PDF ou das partes (NUNCA retorne 'Autor Não Informado' se houver um nome real)",
    "reu": "nome completo do réu/requerido extraído do PDF ou das partes (NUNCA retorne 'Réu Não Informado' se houver um nome real)",
    "classe": "classe processual exata (ex: 'Procedimento Comum Cível', 'Execução de Título Extrajudicial')",
    "assunto": "assunto principal do processo (ex: 'Indenização por Dano Moral', 'Prestação de Serviços')",
    "orgao": "órgão julgador / vara (ex: '1ª Vara Cível da Comarca de São Paulo')",
    "perito": "nome completo do perito judicial nomeado extraído do PDF (ou 'Não nomeado' se não encontrado)",
    "inversaoOnus": "indique se há decisão ou requerimento de inversão do ônus da prova: 'Sim', 'Não' ou 'Não informado'",
    "honorarios": null,
    "depositoJudicial": "indique se houve depósito judicial dos honorários: 'Sim', 'Não', 'Parcial' ou 'Não informado'",
    "valorDeposito": null,
    "dataDeposito": "data em que o depósito judicial foi realizado no formato AAAA-MM-DD ou null se não encontrado"
  },
  "tasks": [
    {
      "title": "título claro da tarefa",
      "description": "descrição detalhada com base no CPC",
      "deadline_days": 5,
      "cpc_article": "465",
      "decision_page": "página ou trecho do PDF onde consta a intimação ou decisão do juiz (ex: 'Página 3' ou null se não encontrado)"
    }
  ]
}

REGRAS SEVERAS:
- OBRIGAÇÃO DE PREENCHER AUTOR, RÉU, CLASSE, ASSUNTO E ÓRGÃO: Se os nomes das partes constarem na seção PARTES DO PROCESSO ou no texto da capa do PDF, é MANDATÓRIO colocar os nomes completos exatos no JSON.
- Jamais coloque valores fictícios ou inventados. Se honorários ou depósitos não constarem explicitamente no PDF, retorne null.
- CRIAÇÃO DE TAREFAS DO PERITO: Crie APENAS tarefas que são atribuições diretas do Perito Judicial no processo e que foram expressamente determinadas/solicitadas em alguma decisão/despacho constante no texto do PDF.

DADOS COMPLETOS DO PROCESSO:
- Número: ${proc.numeroProcesso}
- Tribunal: ${proc.tribunal || 'N/I'}
- Grau: ${proc.grau || 'N/I'}
- Órgão Julgador: ${proc.orgaoJulgador?.nome || 'N/I'}
- Classe: ${proc.classe?.nome || 'N/I'} (código: ${proc.classe?.codigo || 'N/I'})
- Assuntos: ${assuntosStr || 'N/I'}
- Data de Ajuizamento: ${proc.dataAjuizamento ? new Date(proc.dataAjuizamento).toLocaleDateString('pt-BR') : 'N/I'}
- Última Atualização: ${proc.dataHoraUltimaAtualizacao ? new Date(proc.dataHoraUltimaAtualizacao).toLocaleString('pt-BR') : 'N/I'}
- Formato: ${proc.formato?.nome || 'N/I'}

FICHA TÉCNICA DO PERITO:${expertStr || '\n- Nenhum dado cadastrado'}

PARTES DO PROCESSO:
${partesStr || '  Nenhuma parte cadastrada'}

MOVIMENTAÇÕES DO PROCESSO (${(proc.movimentos || []).length} no total):
${movimentosStr || '  Nenhuma movimentação'}

${pdfText ? `\n=== TEXTO DO PDF DO PROCESSO (USAR PARA EXTRAIR AUTOR, RÉU, CLASSE, ASSUNTO, ÓRGÃO E DECISÕES) ===\n${pdfText}\n=== FIM DO TEXTO DO PDF ===\n` : '\n(Nenhum PDF anexado a este processo)\n'}

TAREFAS EXISTENTES NO SISTEMA:
${tasks.length ? JSON.stringify(tasks.map(t => ({ title: t.title, description: t.description, cpcArticle: t.cpcArticle })), null, 2) : 'Nenhuma'}

INSTRUÇÃO FINAL: Analise TODO o conteúdo acima. Extraia obrigatoriamente os dados reais de Autor, Réu, Classe, Assunto e Órgão. Retorne SOMENTE o JSON válido sem formatação markdown em volta.`;
}

function renderAIAnalysis() {
  const container = document.getElementById('ai-analysis-container');
  if (!container || !activeProcess) return;

  const cached = activeProcess.__aiResult;

  if (cached) {
    renderAIResult(cached, container);
    return;
  }

  container.innerHTML = `
    <div class="ai-empty-state">
      <span class="material-symbols-rounded" style="font-size: 50px; color: #7c3aed;">smart_toy</span>
      <h4>Análise com IA Generativa</h4>
      <p>Complete automaticamente os dados do processo, gere um resumo e crie tarefas com prazos baseados no CPC.</p>
      <button class="btn-ai-generate" id="btn-ai-start">
        <span class="material-symbols-rounded">auto_fix_high</span>
        Gerar Análise
      </button>
      <div class="ai-tech-message">Powered by Groq AI</div>
    </div>
  `;

  document.getElementById('btn-ai-start')?.addEventListener('click', performAIAnalysis);
}

async function performAIAnalysis() {
  const container = document.getElementById('ai-analysis-container');
  if (!container || !activeProcess) return;

  container.innerHTML = `
    <div class="ai-loading">
      <span class="ai-loading-spinner material-symbols-rounded">progress_activity</span>
      <p>Buscando dados atualizados do processo na API Datajud...</p>
    </div>
  `;

  let datajudFetched = false;

  try {
    // PASSO 1: Tenta buscar dados atualizados do Datajud antes de analisar
    const cleanCNJ = activeProcess.numeroProcesso.replace(/[^0-9]/g, '');
    if (cleanCNJ.length === 20) {
      try {
        const courtAlias = detectCourtFromCNJ(cleanCNJ);
        if (courtAlias) {
          const query = buildDatajudQuery(cleanCNJ, 1);

          const resp = await authFetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': '' },
            body: JSON.stringify({ tribunal: courtAlias, query, timeout: 30000 })
          });

          console.log('[AI] Datajud status:', resp.status);
          if (resp.ok) {
            const data = await resp.json();
            const hits = data.hits?.hits || [];
            console.log('[AI] Hits:', hits.length);
            if (hits.length > 0) {
              const mapped = mapDatajudProcess(hits[0], courtAlias);
              if (mapped.classe?.nome) activeProcess.classe = mapped.classe;
              if (mapped.assuntos?.length) activeProcess.assuntos = mapped.assuntos;
              if (mapped.orgaoJulgador?.nome) activeProcess.orgaoJulgador = mapped.orgaoJulgador;
              if (mapped.partes?.length) {
                activeProcess.partes = mapped.partes;
                if (!activeProcess.expertInfo) activeProcess.expertInfo = {};
                const ativos = mapped.partes.filter(p => p.polo === 'ATIVO').map(p => p.nome).join(', ');
                const passivos = mapped.partes.filter(p => p.polo === 'PASSIVO').map(p => p.nome).join(', ');
                if (ativos) activeProcess.expertInfo.autor = ativos;
                if (passivos) activeProcess.expertInfo.reu = passivos;
              }
              if (mapped.movimentos?.length) {
                activeProcess.movimentos = mapped.movimentos;
                activeProcess.dataHoraUltimaAtualizacao = mapped.dataHoraUltimaAtualizacao;
              }
              if (mapped.dataAjuizamento) activeProcess.dataAjuizamento = mapped.dataAjuizamento;
              activeProcess.hasUpdate = true;
              await ProcessService.update(activeProcess);
              datajudFetched = true;
            } else {
              console.log('[AI] CNJ não encontrado no Datajud');
            }
          } else {
            console.warn('[AI] Datajud erro HTTP:', resp.status);
          }
        }
      } catch (e) {
        console.warn('[AI] Falha ao buscar dados do Datajud:', e);
      }
    }

    container.innerHTML = `
      <div class="ai-loading">
        <span class="ai-loading-spinner material-symbols-rounded">progress_activity</span>
        <p>Analisando processo com IA${datajudFetched ? ' (dados atualizados do Datajud encontrados!)' : ' (processo sem dados do Datajud)'}...</p>
      </div>
    `;

    // PASSO 2: Chama a IA com os dados (agora enriquecidos)
    const prompt = buildAIPrompt(activeProcess);
    activeProcess.__aiPrompt = prompt;
    const result = await callAIApi(prompt);

    activeProcess.__aiResult = result;

    if (!activeProcess.aiData) activeProcess.aiData = {};
    activeProcess.aiData.result = result;
    await ProcessService.update(activeProcess);

    renderAIResult(result, container);
  } catch (err) {
    console.error('[AI] Erro:', err);
    container.innerHTML = `
      <div class="ai-empty-state">
        <span class="material-symbols-rounded" style="font-size: 50px; color: var(--md-sys-color-error);">error</span>
        <h4>Erro na análise</h4>
        <p>${err.message}</p>
        <button class="btn-ai-generate" id="btn-ai-retry">
          <span class="material-symbols-rounded">refresh</span>
          Tentar novamente
        </button>
      </div>
    `;
    document.getElementById('btn-ai-retry')?.addEventListener('click', performAIAnalysis);
  }
}

function dateFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { date: `${y}-${m}-${day}`, display: `${day}/${m}/${y}` };
}

function isPlaceholderValue(v) {
  if (!v || !String(v).trim()) return true;
  const s = String(v).trim().toLowerCase();
  if ([
    'não', 'não informado', 'não informada', 'não nomeado', 'autor não informado', 
    'réu não informado', 'ação judicial', 'assunto geral', 'vara não informada',
    'não cadastrada', 'não localizada', 'não classificada', 'classe não classificada', '-'
  ].includes(s)) {
    return true;
  }
  return s.includes('não informado') || s.includes('não informada') || s.includes('não nomeado');
}

function checkIfFieldsDiffer(data) {
  if (!activeProcess || !data?.fields) return false;
  const f = data.fields;
  const info = activeProcess.expertInfo || {};
  const isValid = v => !isPlaceholderValue(v);

  if (isValid(f.autor) && f.autor !== info.autor) return true;
  if (isValid(f.reu) && f.reu !== info.reu) return true;
  if (isValid(f.perito) && f.perito !== info.perito) return true;
  if (isValid(f.inversaoOnus) && f.inversaoOnus !== info.inversaoOnus) return true;
  if (isValid(f.depositoJudicial) && f.depositoJudicial !== info.depositoJudicial) return true;
  
  if (f.honorarios !== undefined && f.honorarios !== null) {
    const currentHonorarios = parseFloat(info.honorarios);
    const aiHonorarios = parseFloat(f.honorarios);
    if (!isNaN(aiHonorarios) && aiHonorarios !== currentHonorarios) return true;
  }
  if (f.valorDeposito !== undefined && f.valorDeposito !== null) {
    const currentValorDeposito = parseFloat(info.valorDeposito);
    const aiValorDeposito = parseFloat(f.valorDeposito);
    if (!isNaN(aiValorDeposito) && aiValorDeposito !== currentValorDeposito) return true;
  }
  if (f.dataDeposito && f.dataDeposito !== info.dataDeposito) return true;

  if (isValid(f.classe) && f.classe !== activeProcess.classe?.nome) return true;
  const currentAssunto = activeProcess.assuntos?.[0]?.nome || '';
  if (isValid(f.assunto) && f.assunto !== currentAssunto) return true;
  if (isValid(f.orgao) && f.orgao !== activeProcess.orgaoJulgador?.nome) return true;

  return false;
}

function isFieldMatching(fieldName, aiValue) {
  if (!activeProcess) return false;
  if (isPlaceholderValue(aiValue)) return false;

  const info = activeProcess.expertInfo || {};

  switch (fieldName) {
    case 'autor': return !isPlaceholderValue(info.autor) && info.autor === aiValue;
    case 'reu': return !isPlaceholderValue(info.reu) && info.reu === aiValue;
    case 'perito': return !isPlaceholderValue(info.perito) && info.perito === aiValue;
    case 'inversaoOnus': return !isPlaceholderValue(info.inversaoOnus) && info.inversaoOnus === aiValue;
    case 'depositoJudicial': return !isPlaceholderValue(info.depositoJudicial) && info.depositoJudicial === aiValue;
    case 'dataDeposito': return info.dataDeposito === aiValue;
    case 'classe': return activeProcess.classe?.nome && !isPlaceholderValue(activeProcess.classe.nome) && activeProcess.classe.nome === aiValue;
    case 'assunto': {
      const currentAssunto = activeProcess.assuntos?.[0]?.nome || '';
      return currentAssunto && !isPlaceholderValue(currentAssunto) && currentAssunto === aiValue;
    }
    case 'orgao': return activeProcess.orgaoJulgador?.nome && !isPlaceholderValue(activeProcess.orgaoJulgador.nome) && activeProcess.orgaoJulgador.nome === aiValue;
    case 'honorarios': {
      const currentHonorarios = parseFloat(info.honorarios);
      const aiHonorarios = parseFloat(aiValue);
      return !isNaN(aiHonorarios) && aiHonorarios === currentHonorarios;
    }
    case 'valorDeposito': {
      const currentValorDeposito = parseFloat(info.valorDeposito);
      const aiValorDeposito = parseFloat(aiValue);
      return !isNaN(aiValorDeposito) && aiValorDeposito === currentValorDeposito;
    }
    default: return false;
  }
}

function renderAIResult(data, container) {
  const hasFields = data.fields && Object.values(data.fields).some(v => !isPlaceholderValue(v));
  const fieldsDiffer = checkIfFieldsDiffer(data);

  let fieldsHtml = '';
  if (data.fields) {
    const renderFieldItem = (label, name, value, isCurrency = false) => {
      if (!value) return '';
      const formattedVal = isCurrency ? formatCurrency(value) : value;
      const isPlaceholder = isPlaceholderValue(value);
      const isApplied = !isPlaceholder && isFieldMatching(name, value);
      
      let badge = '';
      if (isPlaceholder) {
        badge = `
          <span style="font-size: 11px; background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; margin-left: 8px;">
            <span class="material-symbols-rounded" style="font-size: 13px;">help_outline</span> Não Informado
          </span>
        `;
      } else if (isApplied) {
        badge = `
          <span style="font-size: 11px; background: #d1fae5; color: #065f46; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; margin-left: 8px;">
            <span class="material-symbols-rounded" style="font-size: 13px;">check_circle</span> Preenchido
          </span>
        `;
      }
      
      const style = isApplied ? 'style="color: #065f46;"' : (isPlaceholder ? 'style="color: var(--md-sys-color-outline);"' : '');
      
      return `<li ${style}><strong>${label}:</strong> ${formattedVal} ${badge}</li>`;
    };

    fieldsHtml = `
      <div class="ai-section">
        <h5><span class="material-symbols-rounded">edit_note</span> Campos a Preencher</h5>
        <ul>
          ${renderFieldItem('Autor', 'autor', data.fields.autor)}
          ${renderFieldItem('Réu', 'reu', data.fields.reu)}
          ${renderFieldItem('Classe', 'classe', data.fields.classe)}
          ${renderFieldItem('Assunto', 'assunto', data.fields.assunto)}
          ${renderFieldItem('Órgão', 'orgao', data.fields.orgao)}
          ${renderFieldItem('Perito Nomeado', 'perito', data.fields.perito)}
          ${renderFieldItem('Inversão do Ônus', 'inversaoOnus', data.fields.inversaoOnus)}
          ${renderFieldItem('Depósito Judicial', 'depositoJudicial', data.fields.depositoJudicial)}
          ${renderFieldItem('Honorários Arbitrados', 'honorarios', data.fields.honorarios, true)}
          ${renderFieldItem('Valor Depósito', 'valorDeposito', data.fields.valorDeposito, true)}
          ${renderFieldItem('Data Depósito', 'dataDeposito', data.fields.dataDeposito)}
        </ul>
        ${hasFields ? (fieldsDiffer ? `
          <button class="btn-ai-apply" id="btn-apply-fields">
            <span class="material-symbols-rounded">check</span> Aplicar ao Processo
          </button>
        ` : `
          <button class="btn-ai-apply" disabled style="background: #22c55e; cursor: default;">
            <span class="material-symbols-rounded">check_circle</span> Informações Já Aplicadas
          </button>
        `) : ''}
      </div>`;
  }

  const existingTasks = activeProcess.tasks || [];
  const suggestedTasks = data.tasks || [];
  
  // Filtra apenas as novas tarefas (não duplicadas por título)
  const newTasks = suggestedTasks.filter(t => {
    if (!t.title) return false;
    return !existingTasks.some(ex => ex.title.toLowerCase() === t.title.toLowerCase());
  });

  let tasksHtml = '';
  if (data.tasks && data.tasks.length > 0) {
    tasksHtml = `
      <div class="ai-section">
        <h5><span class="material-symbols-rounded">checklist</span> Tarefas Sugeridas</h5>
        <ul>
          ${data.tasks.map(t => {
            const di = dateFromNow(t.deadline_days || 5);
            let originLinkHtml = '';
            if (t.decision_page) {
              if (activeProcess.pdfPath) {
                const pageNum = t.decision_page.replace(/[^0-9]/g, '');
                originLinkHtml = `<div style="margin-top: 6px; font-size: 11px;"><a href="#" onclick="openProcessPdfAtPage(${pageNum}); return false;" style="display: inline-flex; align-items: center; gap: 4px; color: var(--md-sys-color-primary); text-decoration: none;"><span class="material-symbols-rounded" style="font-size: 14px;">open_in_new</span> Ver decisão na ${t.decision_page}</a></div>`;
              } else {
                originLinkHtml = `<div style="margin-top: 6px; font-size: 11px; color: var(--md-sys-color-outline); display: inline-flex; align-items: center; gap: 4px;"><span class="material-symbols-rounded" style="font-size: 14px;">description</span> Localizado na ${t.decision_page}</div>`;
              }
            }
            
            const isDup = existingTasks.some(ex => ex.title.toLowerCase() === t.title.toLowerCase());
            const taskBadge = isDup ? `
              <span style="font-size: 11px; background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; font-weight: 500;">
                <span class="material-symbols-rounded" style="font-size: 13px;">check_circle</span> Já criada
              </span>
            ` : '';

            return `<li>
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <strong>${t.title}</strong>
                ${taskBadge}
              </div>
              <span>${t.description || ''}</span>
              ${originLinkHtml}
              <div class="deadline-info" style="margin-top: 6px;">Prazo: ${di.display} (${t.deadline_days || 5} dias) | CPC art. ${t.cpc_article || 'N/A'}</div>
            </li>`;
          }).join('')}
        </ul>
        ${newTasks.length > 0 ? `
          <button class="btn-ai-apply" id="btn-apply-tasks">
            <span class="material-symbols-rounded">task_alt</span> Criar Tarefas no Sistema (${newTasks.length})
          </button>
        ` : `
          <button class="btn-ai-apply" disabled style="background: #22c55e; cursor: default;">
            <span class="material-symbols-rounded">check_circle</span> Todas as Tarefas Criadas
          </button>
        `}
      </div>`;
  }

  container.innerHTML = `
    <div class="ai-result">
      <div class="ai-result-header">
        <h4><span class="material-symbols-rounded">auto_fix_high</span> Análise Concluída</h4>
        <span style="font-size: 12px; color: var(--md-sys-color-outline);">Gerado por IA</span>
      </div>
      <div class="ai-section">
        <h5><span class="material-symbols-rounded">summary</span> Resumo do Processo</h5>
        <p>${data.summary || 'Nenhum resumo disponível.'}</p>
      </div>
      ${fieldsHtml}
      ${tasksHtml}
      <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 8px;">
        <button class="btn-ai-generate" id="btn-ai-regenerate">
          <span class="material-symbols-rounded">refresh</span> Regenerar
        </button>
        <button class="md-btn md-btn-tonal" id="btn-ai-clear">
          <span class="material-symbols-rounded">close</span> Limpar
        </button>
      </div>
      <div class="ai-tech-message">As sugestões são baseadas na análise do conteúdo do processo. Revise antes de aplicar.</div>
      <details style="margin-top: 16px; font-size: 11px; color: var(--md-sys-color-outline); cursor: pointer;">
        <summary>🔍 Ver dados brutos (debug)</summary>
        <div style="margin-top: 8px; padding: 8px; background: var(--md-sys-color-surface-variant); border-radius: 8px; overflow-x: auto;">
          <p><strong>Prompt enviado à IA:</strong></p>
          <pre style="white-space: pre-wrap; font-family: monospace; font-size: 11px;">${(activeProcess.__aiPrompt || 'N/D').substring(0, 3000)}</pre>
          <hr style="margin: 8px 0; border-color: var(--md-sys-color-outline-variant);">
          <p><strong>Resposta da IA (JSON):</strong></p>
          <pre style="white-space: pre-wrap; font-family: monospace; font-size: 11px;">${JSON.stringify(data, null, 2)}</pre>
          <hr style="margin: 8px 0; border-color: var(--md-sys-color-outline-variant);">
          <p><strong>Dados do processo salvos no IndexedDB:</strong></p>
          <pre style="white-space: pre-wrap; font-family: monospace; font-size: 11px;">${JSON.stringify({
            classe: activeProcess.classe,
            assuntos: activeProcess.assuntos,
            orgaoJulgador: activeProcess.orgaoJulgador,
            partes: activeProcess.partes?.map(p => ({ nome: p.nome, polo: p.polo })),
            movimentos: activeProcess.movimentos?.length,
            dataAjuizamento: activeProcess.dataAjuizamento,
            expertInfo: activeProcess.expertInfo
          }, null, 2)}</pre>
        </div>
      </details>
    </div>`;

  if (hasFields) {
    document.getElementById('btn-apply-fields')?.addEventListener('click', () => applyAIFields(data));
  }
  if (data.tasks && data.tasks.length > 0) {
    document.getElementById('btn-apply-tasks')?.addEventListener('click', () => createAITasks(data));
  }
  document.getElementById('btn-ai-regenerate')?.addEventListener('click', () => {
    delete activeProcess.__aiResult;
    if (activeProcess.aiData) delete activeProcess.aiData.result;
    renderAIAnalysis();
  });
  document.getElementById('btn-ai-clear')?.addEventListener('click', () => {
    delete activeProcess.__aiResult;
    if (activeProcess.aiData) delete activeProcess.aiData.result;
    ProcessService.update(activeProcess).then(() => renderAIAnalysis());
  });
}

function applyAIFields(data) {
  if (!activeProcess || !data?.fields) return;
  const f = data.fields;
  const isValid = v => !isPlaceholderValue(v);

  if (!activeProcess.expertInfo) activeProcess.expertInfo = {};
  if (!Array.isArray(activeProcess.partes)) activeProcess.partes = [];

  if (isValid(f.autor)) {
    activeProcess.expertInfo.autor = f.autor;
    const ativoIndex = activeProcess.partes.findIndex(p => p.polo === 'ATIVO');
    if (ativoIndex !== -1) {
      activeProcess.partes[ativoIndex].nome = f.autor;
    } else {
      activeProcess.partes.push({ nome: f.autor, polo: 'ATIVO', tipo: 'Física' });
    }
  }

  if (isValid(f.reu)) {
    activeProcess.expertInfo.reu = f.reu;
    const passivoIndex = activeProcess.partes.findIndex(p => p.polo === 'PASSIVO');
    if (passivoIndex !== -1) {
      activeProcess.partes[passivoIndex].nome = f.reu;
    } else {
      activeProcess.partes.push({ nome: f.reu, polo: 'PASSIVO', tipo: 'Física' });
    }
  }

  if (isValid(f.perito)) activeProcess.expertInfo.perito = f.perito;
  if (isValid(f.inversaoOnus)) activeProcess.expertInfo.inversaoOnus = f.inversaoOnus;
  if (isValid(f.depositoJudicial)) activeProcess.expertInfo.depositoJudicial = f.depositoJudicial;
  
  if (f.honorarios !== undefined && f.honorarios !== null && !isNaN(parseFloat(f.honorarios))) {
    activeProcess.expertInfo.honorarios = parseFloat(f.honorarios);
  }
  if (f.valorDeposito !== undefined && f.valorDeposito !== null && !isNaN(parseFloat(f.valorDeposito))) {
    activeProcess.expertInfo.valorDeposito = parseFloat(f.valorDeposito);
  }
  if (f.dataDeposito) {
    activeProcess.expertInfo.dataDeposito = f.dataDeposito;
  }

  if (isValid(f.classe)) {
    if (!activeProcess.classe) activeProcess.classe = {};
    activeProcess.classe.nome = f.classe;
  }
  if (isValid(f.assunto)) {
    if (!activeProcess.assuntos || activeProcess.assuntos.length === 0) {
      activeProcess.assuntos = [{ nome: f.assunto }];
    } else {
      activeProcess.assuntos[0].nome = f.assunto;
    }
  }
  if (isValid(f.orgao)) {
    if (!activeProcess.orgaoJulgador) activeProcess.orgaoJulgador = {};
    activeProcess.orgaoJulgador.nome = f.orgao;
  }

  ProcessService.update(activeProcess).then(() => {
    // Atualiza modal DOM
    if (document.getElementById('modal-classe')) document.getElementById('modal-classe').textContent = activeProcess.classe?.nome || '-';
    if (document.getElementById('modal-assunto')) document.getElementById('modal-assunto').textContent = activeProcess.assuntos?.[0]?.nome || '-';
    if (document.getElementById('modal-orgao')) document.getElementById('modal-orgao').textContent = activeProcess.orgaoJulgador?.nome || '-';
    
    if (typeof renderExpertInfoCard === 'function') renderExpertInfoCard(activeProcess);
    if (typeof renderDashboard === 'function') renderDashboard();

    const btn = document.getElementById('btn-apply-fields');
    if (btn) {
      btn.textContent = '✓ Aplicado!';
      btn.disabled = true;
      btn.style.background = '#22c55e';
    }
    setTimeout(renderAIAnalysis, 1000);
  });
}

function createAITasks(data) {
  if (!activeProcess || !data?.tasks?.length) return;
  if (!Array.isArray(activeProcess.tasks)) activeProcess.tasks = [];

  let created = 0;
  for (const t of data.tasks) {
    if (!t.title) continue;

    const isDup = activeProcess.tasks.some(ex =>
      ex.title.toLowerCase() === t.title.toLowerCase()
    );
    if (isDup) continue;

    const di = dateFromNow(t.deadline_days || 5);
    activeProcess.tasks.push({
      id: `task-${Date.now()}-${Math.round(Math.random() * 1000)}-${created}`,
      title: t.title,
      date: di.date,
      description: t.description || '',
      cpcArticle: t.cpc_article || '',
      decisionPage: t.decision_page || '',
      completed: false,
      source: 'ai',
      alarmDate: null,
      alarmTriggered: false
    });
    created++;
  }

  if (created > 0) {
    ProcessService.update(activeProcess).then(() => {
      const btn = document.getElementById('btn-apply-tasks');
      if (btn) {
        btn.textContent = `✓ ${created} tarefa(s) criada(s)!`;
        btn.disabled = true;
        btn.style.background = '#22c55e';
      }
      if (typeof renderTasksList === 'function') renderTasksList();
      if (typeof renderCalendarWidget === 'function') renderCalendarWidget();
      setTimeout(renderAIAnalysis, 1000);
    });
  }
}
