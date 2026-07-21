const https = require('https');
const http = require('http');

/**
 * Serviço de Integração com a API v3 do Asaas
 * Suporta Sandbox (https://sandbox.asaas.com/api/v3) e Produção (https://www.asaas.com/api/v3)
 */
class AsaasService {
  constructor() {
    this.apiKey = process.env.ASAAS_API_KEY || '';
    this.env = (process.env.ASAAS_ENV || 'sandbox').toLowerCase();
    this.baseUrl = this.env === 'production' 
      ? 'https://www.asaas.com/api/v3' 
      : 'https://sandbox.asaas.com/api/v3';
  }

  /**
   * Helper para realizar requisições HTTP/HTTPS para a API do Asaas
   */
  request(method, endpoint, payload = null) {
    return new Promise((resolve, reject) => {
      const apiKey = process.env.ASAAS_API_KEY || this.apiKey;
      const env = (process.env.ASAAS_ENV || this.env).toLowerCase();
      const isSandbox = env === 'sandbox' || apiKey.includes('_hmlg_');
      const baseUrl = isSandbox
        ? 'https://sandbox.asaas.com/api/v3'
        : 'https://www.asaas.com/api/v3';

      const url = new URL(`${baseUrl}${endpoint}`);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const postData = payload ? JSON.stringify(payload) : null;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          'access_token': apiKey,
          'User-Agent': 'RadarPerito-Integration'
        }
      };

      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = client.request(options, (res) => {
        let responseBody = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          let parsed;
          try {
            parsed = responseBody ? JSON.parse(responseBody) : {};
          } catch (e) {
            parsed = { raw: responseBody };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            console.error(`[Asaas API Error] HTTP ${res.statusCode}:`, parsed);
            const msg = parsed.errors?.[0]?.description || `Erro na API do Asaas (HTTP ${res.statusCode})`;
            reject(new Error(msg));
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Asaas Network Error]', err);
        reject(err);
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  /**
   * Busca cliente por CPF/CNPJ ou E-mail no Asaas
   */
  async findCustomer(cpfCnpjOrEmail) {
    try {
      const clean = cpfCnpjOrEmail.trim();
      const param = clean.includes('@') ? `email=${encodeURIComponent(clean)}` : `cpfCnpj=${encodeURIComponent(clean.replace(/[^0-9]/g, ''))}`;
      const res = await this.request('GET', `/customers?${param}`);
      if (res.data && res.data.length > 0) {
        return res.data[0];
      }
      return null;
    } catch (err) {
      console.warn('[Asaas] Falha ao buscar cliente:', err.message);
      return null;
    }
  }

  /**
   * Cria ou obtém cliente no Asaas
   */
  async createOrGetCustomer({ name, email, cpfCnpj, phone }) {
    const cleanCpf = (cpfCnpj || '').replace(/[^0-9]/g, '');
    const cleanEmail = (email || '').trim().toLowerCase();

    // 1. Tenta buscar existente por CPF
    if (cleanCpf) {
      const existingByCpf = await this.findCustomer(cleanCpf);
      if (existingByCpf) return existingByCpf;
    }

    // 2. Tenta buscar existente por E-mail
    if (cleanEmail) {
      const existingByEmail = await this.findCustomer(cleanEmail);
      if (existingByEmail) return existingByEmail;
    }

    // 3. Cria novo cliente no Asaas
    const payload = {
      name: name.trim(),
      email: cleanEmail,
      cpfCnpj: cleanCpf,
      mobilePhone: (phone || '').replace(/[^0-9]/g, ''),
      notificationDisabled: false
    };

    console.log(`[Asaas] Criando novo cliente: ${cleanEmail}`);
    return await this.request('POST', '/customers', payload);
  }

  /**
   * Cria uma assinatura recorrente no Asaas (Mensal: R$ 49.90 / Anual: R$ 399.20)
   */
  async createSubscription({ customerId, plan, billingType }) {
    const isAnnual = plan === 'annual';
    const value = isAnnual ? 399.20 : 49.90;
    const cycle = isAnnual ? 'YEARLY' : 'MONTHLY';
    const description = isAnnual 
      ? 'Radar Perito Premium - Assinatura Anual' 
      : 'Radar Perito Premium - Assinatura Mensal';

    const nextDueDate = new Date();
    nextDueDate.setDate(nextDueDate.getDate() + 1);
    const formattedDueDate = nextDueDate.toISOString().split('T')[0];

    const payload = {
      customer: customerId,
      billingType: billingType || 'UNDEFINED',
      value: value,
      nextDueDate: formattedDueDate,
      cycle: cycle,
      description: description,
      externalReference: JSON.stringify({ plan, customerId })
    };

    console.log(`[Asaas] Criando assinatura (${cycle}) de R$ ${value} para cliente ${customerId}`);
    const sub = await this.request('POST', '/subscriptions', payload);

    return {
      subscriptionId: sub.id,
      value: sub.value,
      cycle: sub.cycle,
      status: sub.status
    };
  }

  /**
   * Cria uma cobrança única avulsa no Asaas
   */
  async createPayment({ customerId, plan, billingType }) {
    const isAnnual = plan === 'annual';
    const value = isAnnual ? 399.20 : 49.90;
    const description = isAnnual 
      ? 'Radar Perito Premium - Assinatura Anual (R$ 399,20)' 
      : 'Radar Perito Premium - Assinatura Mensal (R$ 49,90)';

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const formattedDueDate = dueDate.toISOString().split('T')[0];

    const payload = {
      customer: customerId,
      billingType: billingType || 'UNDEFINED',
      value: value,
      dueDate: formattedDueDate,
      description: description,
      externalReference: JSON.stringify({ plan, customerId })
    };

    console.log(`[Asaas] Criando cobrança avulsa de R$ ${value} para cliente ${customerId}`);
    const payment = await this.request('POST', '/payments', payload);

    return {
      paymentId: payment.id,
      invoiceUrl: payment.invoiceUrl || payment.bankSlipUrl,
      value: payment.value,
      status: payment.status
    };
  }

  /**
   * Obtém detalhes de um cliente no Asaas por ID
   */
  async getCustomerById(customerId) {
    return await this.request('GET', `/customers/${customerId}`);
  }
}

module.exports = new AsaasService();
