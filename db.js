const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;
let useSupabase = false;

// Configuração do Fallback Local JSON
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RADAR_FILE = path.join(DATA_DIR, 'radar.json');
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');

// Helpers locais para ler e salvar JSON de forma segura e assíncrona
async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

async function readJsonFile(filePath, defaultVal = []) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return defaultVal;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Inicialização do Banco de Dados / Arquivos Locais
async function initDb() {
  if (supabaseUrl && supabaseKey && supabaseUrl.trim() !== '' && supabaseKey.trim() !== '') {
    try {
      supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false }
      });
      // Testa a conexão realizando uma query leve na tabela users com limite de 4 segundos
      let timeoutId;
      const connectionTest = supabase.from('users').select('email').limit(1);
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Tempo limite de conexão esgotado (4s)')), 4000);
      });

      try {
        const { error } = await Promise.race([connectionTest, timeout]);
        clearTimeout(timeoutId);
        
        if (error) {
          console.error('⚠️ Falha de comunicação com o Supabase. Verifique se as tabelas existem ou se as credenciais estão corretas:', error.message);
          console.log('🔄 Utilizando persistência em arquivos JSON locais temporariamente.');
          useSupabase = false;
        } else {
          console.log('🔌 Conectado ao Supabase com sucesso!');
          useSupabase = true;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.error('⚠️ Erro ao tentar inicializar o cliente do Supabase:', err.message);
        console.log('🔄 Utilizando persistência em arquivos JSON locais temporariamente.');
        useSupabase = false;
      }
    } catch (err) {
      console.error('⚠️ Erro ao criar o cliente do Supabase:', err.message);
      console.log('🔄 Utilizando persistência em arquivos JSON locais temporariamente.');
      useSupabase = false;
    }
  } else {
    console.log('ℹ️ Credenciais do Supabase ausentes no .env. Utilizando persistência em arquivos JSON locais.');
    useSupabase = false;
  }

  if (!useSupabase) {
    // Garante que o diretório data e os arquivos JSON iniciais existam
    await ensureDir(DATA_DIR);
    const usersExist = await fs.access(USERS_FILE).then(() => true).catch(() => false);
    if (!usersExist) {
      await writeJsonFile(USERS_FILE, []);
    }
    const radarExist = await fs.access(RADAR_FILE).then(() => true).catch(() => false);
    if (!radarExist) {
      await writeJsonFile(RADAR_FILE, []);
    }
    const blacklistExist = await fs.access(BLACKLIST_FILE).then(() => true).catch(() => false);
    if (!blacklistExist) {
      await writeJsonFile(BLACKLIST_FILE, []);
    }
  }
}

// === API DE USUÁRIOS ===

async function findUserByEmail(email) {
  if (!email) return null;
  const emailClean = email.trim().toLowerCase();

  if (useSupabase) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', emailClean)
      .maybeSingle();

    if (error) {
      console.error(`[Supabase] Erro ao buscar usuário ${emailClean}:`, error);
      throw error;
    }
    return data;
  } else {
    const users = await readJsonFile(USERS_FILE);
    return users.find(u => u.email === emailClean) || null;
  }
}

async function createUser(user) {
  const emailClean = user.email.trim().toLowerCase();
  const formattedUser = {
    ...user,
    email: emailClean
  };

  if (useSupabase) {
    const { error } = await supabase
      .from('users')
      .insert([formattedUser]);

    if (error) {
      console.error(`[Supabase] Erro ao criar usuário ${emailClean}:`, error);
      throw error;
    }
  } else {
    const users = await readJsonFile(USERS_FILE);
    users.push(formattedUser);
    await writeJsonFile(USERS_FILE, users);
  }
  return formattedUser;
}

async function updateUser(email, updateFields) {
  if (!email) return;
  const emailClean = email.trim().toLowerCase();

  if (useSupabase) {
    const { error } = await supabase
      .from('users')
      .update(updateFields)
      .eq('email', emailClean);

    if (error) {
      console.error(`[Supabase] Erro ao atualizar usuário ${emailClean}:`, error);
      throw error;
    }
  } else {
    const users = await readJsonFile(USERS_FILE);
    const index = users.findIndex(u => u.email === emailClean);
    if (index !== -1) {
      users[index] = { ...users[index], ...updateFields };
      await writeJsonFile(USERS_FILE, users);
    }
  }
}

async function deleteUser(email) {
  if (!email) return;
  const emailClean = email.trim().toLowerCase();

  if (useSupabase) {
    // Remove usuário e também as nomeações associadas (integridade referencial opcional)
    const { error: errRadar } = await supabase
      .from('radar')
      .delete()
      .eq('userEmail', emailClean);
    if (errRadar) {
      console.error(`[Supabase] Erro ao remover radar do usuário excluído ${emailClean}:`, errRadar);
    }

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('email', emailClean);

    if (error) {
      console.error(`[Supabase] Erro ao remover usuário ${emailClean}:`, error);
      throw error;
    }
  } else {
    const users = await readJsonFile(USERS_FILE);
    const index = users.findIndex(u => u.email === emailClean);
    if (index !== -1) {
      users.splice(index, 1);
      await writeJsonFile(USERS_FILE, users);
    }
  }
}

// === API DO RADAR ===

async function getRadarForUser(email) {
  if (!email) return [];
  const emailClean = email.trim().toLowerCase();

  if (useSupabase) {
    const { data, error } = await supabase
      .from('radar')
      .select('*')
      .eq('userEmail', emailClean)
      .eq('imported', false);

    if (error) {
      console.error(`[Supabase] Erro ao buscar radar para ${emailClean}:`, error);
      throw error;
    }
    return data || [];
  } else {
    const radar = await readJsonFile(RADAR_FILE);
    return radar.filter(item => item.userEmail === emailClean && !item.imported);
  }
}

async function getExistingRadarIds(email) {
  if (!email) return new Set();
  const emailClean = email.trim().toLowerCase();

  if (useSupabase) {
    const { data, error } = await supabase
      .from('radar')
      .select('id')
      .eq('userEmail', emailClean);

    if (error) {
      console.error(`[Supabase] Erro ao buscar ids de radar para ${emailClean}:`, error);
      throw error;
    }
    return new Set((data || []).map(r => r.id));
  } else {
    const radar = await readJsonFile(RADAR_FILE);
    return new Set(radar.filter(item => item.userEmail === emailClean).map(item => item.id));
  }
}

async function insertRadarItems(items) {
  if (!items || items.length === 0) return;

  if (useSupabase) {
    const { error } = await supabase
      .from('radar')
      .insert(items);

    if (error) {
      console.error('[Supabase] Erro ao inserir itens de radar:', error);
      throw error;
    }
  } else {
    const radar = await readJsonFile(RADAR_FILE);
    radar.push(...items);
    await writeJsonFile(RADAR_FILE, radar);
  }
}

async function markRadarAsImported(id, email) {
  if (!id || !email) return;
  const emailClean = email.trim().toLowerCase();

  if (useSupabase) {
    const { error } = await supabase
      .from('radar')
      .update({ imported: true })
      .eq('id', id)
      .eq('userEmail', emailClean);

    if (error) {
      console.error(`[Supabase] Erro ao marcar radar como importado (${id}):`, error);
      throw error;
    }
  } else {
    const radar = await readJsonFile(RADAR_FILE);
    const item = radar.find(r => r.id === id && r.userEmail === emailClean);
    if (item) {
      item.imported = true;
      await writeJsonFile(RADAR_FILE, radar);
    }
  }
}

async function purgeMockRadarItems() {
  const mockProcessos = ['1011405-32.2025.8.26.0002', '5001243-85.2026.4.03.6100'];

  if (useSupabase) {
    const { error } = await supabase
      .from('radar')
      .delete()
      .in('numeroProcesso', mockProcessos);

    if (error) {
      console.error('[Supabase] Erro ao purgar registros fictícios do radar:', error);
    }
  } else {
    const radar = await readJsonFile(RADAR_FILE);
    const filtered = radar.filter(item => !mockProcessos.includes(item.numeroProcesso));
    if (filtered.length !== radar.length) {
      await writeJsonFile(RADAR_FILE, filtered);
    }
  }
}

// === API DE CONTROLE DE USUÁRIOS E BLACKLIST (DEV/ADMIN) ===

async function getAllUsers() {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('createdAt', { ascending: false });
    if (error) {
      console.error('[Supabase] Erro ao buscar todos os usuários:', error);
      throw error;
    }
    return data || [];
  } else {
    return await readJsonFile(USERS_FILE);
  }
}

async function getBlacklist() {
  if (useSupabase) {
    const { data, error } = await supabase
      .from('blacklist')
      .select('*')
      .order('createdAt', { ascending: false });
    if (error) {
      console.error('[Supabase] Erro ao buscar blacklist:', error);
      throw error;
    }
    return data || [];
  } else {
    return await readJsonFile(BLACKLIST_FILE);
  }
}

async function addToBlacklist(email, reason = 'Sem motivo informado') {
  const emailClean = email.trim().toLowerCase();
  const item = {
    email: emailClean,
    reason: reason,
    createdAt: new Date().toISOString()
  };

  if (useSupabase) {
    const { error } = await supabase
      .from('blacklist')
      .upsert([item]);
    if (error) {
      console.error(`[Supabase] Erro ao adicionar e-mail ${emailClean} à blacklist:`, error);
      throw error;
    }
  } else {
    const list = await readJsonFile(BLACKLIST_FILE);
    const index = list.findIndex(i => i.email === emailClean);
    if (index !== -1) {
      list[index] = item;
    } else {
      list.push(item);
    }
    await writeJsonFile(BLACKLIST_FILE, list);
  }
  return item;
}

async function removeFromBlacklist(email) {
  const emailClean = email.trim().toLowerCase();

  if (useSupabase) {
    const { error } = await supabase
      .from('blacklist')
      .delete()
      .eq('email', emailClean);
    if (error) {
      console.error(`[Supabase] Erro ao remover e-mail ${emailClean} da blacklist:`, error);
      throw error;
    }
  } else {
    const list = await readJsonFile(BLACKLIST_FILE);
    const filtered = list.filter(i => i.email !== emailClean);
    await writeJsonFile(BLACKLIST_FILE, filtered);
  }
}

async function isEmailBlacklisted(email) {
  if (!email) return false;
  const emailClean = email.trim().toLowerCase();

  if (useSupabase) {
    const { data, error } = await supabase
      .from('blacklist')
      .select('email')
      .eq('email', emailClean)
      .maybeSingle();
    if (error) {
      console.error(`[Supabase] Erro ao verificar e-mail ${emailClean} na blacklist:`, error);
      return false;
    }
    return !!data;
  } else {
    const list = await readJsonFile(BLACKLIST_FILE);
    return list.some(i => i.email === emailClean);
  }
}

module.exports = {
  initDb,
  findUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  getRadarForUser,
  getExistingRadarIds,
  insertRadarItems,
  markRadarAsImported,
  purgeMockRadarItems,
  getAllUsers,
  getBlacklist,
  addToBlacklist,
  removeFromBlacklist,
  isEmailBlacklisted
};
