import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import http from 'http';
import https from 'https';
import compression from 'compression';

// Agente HTTP persistente para manter conexões abertas com a Freepay
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });
const pickAgent  = (url) => url.protocol === 'http:' ? httpAgent : httpsAgent;
const fetchOptions = { agent: pickAgent };

// Carregar variáveis de ambiente
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================================================
// OTIMIZAÇÃO 1: Pré-computar o header de autenticação UMA VEZ na inicialização
// Antes: Buffer.from + base64 era recalculado em CADA requisição
// =============================================================================
let FREEPAY_AUTH_HEADER = null;

function buildAuthHeader() {
  const publicKey = process.env.FREEPAY_PUBLIC_KEY;
  const secretKey = process.env.FREEPAY_SECRET_KEY;
  if (publicKey && secretKey) {
    FREEPAY_AUTH_HEADER = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;
    console.log('✅ Auth header Freepay pré-computado na inicialização.');
  } else {
    console.warn('⚠️  FREEPAY_PUBLIC_KEY / FREEPAY_SECRET_KEY não configuradas.');
  }
}
buildAuthHeader();

// =============================================================================
// OTIMIZAÇÃO 2: Endpoint como constante (evita recriar string a cada requisição)
// =============================================================================
const FREEPAY_ENDPOINT = 'https://api.freepaybrasil.com/v1/payment-transaction/create';
const FREEPAY_TIMEOUT_MS = 8000; // Timeout explícito de 8s

// =============================================================================
// Converte qualquer valor monetário para centavos inteiros (sem regex pesada)
// =============================================================================
function toIntCents(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isInteger(value) ? value : Math.round(value * 100);
  if (typeof value === 'string') {
    // OTIMIZAÇÃO: Limpeza de string mais rápida sem regex complexa para casos simples
    const clean = value.replace(/[R$\s\.]/g, '').replace(',', '.');
    const n = parseFloat(clean);
    return isNaN(n) ? null : Math.round(n * 100);
  }
  return null;
}

// Middleware
app.use(cors());

// =============================================================================
// OTIMIZAÇÃO 4: Compressão Gzip — filtro corrigido
// Não comprimir imagens/fontes já comprimidas; usar filtro padrão para o resto
// =============================================================================
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    const url = req.url || '';
    // Não recomprimir assets já comprimidos
    if (/\.(webp|png|jpg|jpeg|gif|avif|ico|woff2?)$/i.test(url)) {
      return false;
    }
    // Usar filtro padrão do módulo compression para o resto
    return compression.filter(req, res);
  }
}));

// OTIMIZAÇÃO 3: Reduzir limite do body de 10mb para 1mb (payload PIX é pequeno)
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ limit: '1mb', extended: true }));

// =============================================================================
// OTIMIZAÇÃO 5: Cache headers para imagens e assets estáticos
// Permite que o navegador cache imagens por 30 dias
// =============================================================================
app.use((req, res, next) => {
  const url = req.url.split('?')[0];
  // Imagens: cache por 30 dias (immutable = não muda sem rename)
  if (/\.(webp|png|jpg|jpeg|gif|svg|ico|avif)$/i.test(url)) {
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    // NÃO definir ETag manualmente — deixar o Express/etag padrão gerenciar
  }
  // Fontes: cache por 1 ano
  else if (/\.(woff2?|ttf|otf|eot)$/i.test(url)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  // CSS/JS: cache por 7 dias
  else if (/\.(css|js)$/i.test(url)) {
    res.set('Cache-Control', 'public, max-age=604800');
  }
  // HTML: sem cache
  else if (/\.html$/i.test(url) || url === '/') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  // Headers de segurança
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Servir arquivos estáticos
app.use(express.static(join(__dirname, '.'), {
  maxAge: '30d',
  etag: true,
  lastModified: true,
  index: 'index.html',
}));

// =============================================================================
// ROTA POST /api/create-pix — OTIMIZADA
// Removido: loop de regex varrendo TODO o body (collectStrings + moneyRegex)
//           que era executado a cada chamada e causava atraso desnecessário
// =============================================================================
app.post('/api/create-pix', async (req, res) => {
  const t0 = Date.now();
    try {
      const { amount, customer, items, metadata } = req.body;

      // OTIMIZAÇÃO: Validação em uma única linha para economizar ciclos
      if (!amount || !customer?.document || !customer?.phone) {
        return res.status(400).json({ error: 'Incomplete data' });
      }

    // Sem chaves → modo demo (dev) ou erro (prod)
    if (!FREEPAY_AUTH_HEADER) {
      console.warn('⚠️  Chaves Freepay não configuradas!');
      if (process.env.NODE_ENV === 'production') {
        return res.status(500).json({ error: 'Configuração incompleta: FREEPAY_PUBLIC_KEY e FREEPAY_SECRET_KEY são obrigatórias.' });
      }
      const amountDemo = toIntCents(amount);
      return res.status(200).json({
        success: true,
        data: {
          transactionId: 'demo_' + Date.now(),
          pixCode: '00020126580014br.gov.bcb.pix0136DEMO12345678905204000053039865406' + amountDemo + '5802BR5913RAZOR LTDA6009SAO PAULO62070503***6304',
          amount: amountDemo,
          status: 'pending',
          message: 'PIX de demonstração (Chaves API ausentes)'
        }
      });
    }

    // Normalizar dados
    const amountCents = toIntCents(amount);
    const cpfClean = customer.document.replace(/\D/g, '');
    let phoneClean = customer.phone.replace(/\D/g, '');
    if (phoneClean.length === 10 || phoneClean.length === 11) phoneClean = '55' + phoneClean;
    if (!phoneClean.startsWith('+')) phoneClean = '+' + phoneClean;

    // Montar payload direto — sem processamento extra
    const fpPayload = {
      amount: amountCents,
      payment_method: 'pix',
      postback_url: process.env.FREEPAY_POSTBACK_URL || 'https://webhook.site/freepay-notification',
      customer: {
        name: customer.name,
        email: customer.email,
        phone: phoneClean,
        document: { type: 'cpf', number: cpfClean }
      },
      metadata: metadata || { description: 'Compra de títulos Ranger Raptor 0KM' }
    };

    if (Array.isArray(items) && items.length > 0) {
      fpPayload.items = items.map(it => ({
        name: it.name || 'Produto',
        title: it.name || 'Produto',  // CORREÇÃO: Freepay exige o campo 'title'
        quantity: Math.max(1, parseInt(it.quantity) || 1),
        unit_price: toIntCents(it.unit_price)
      }));
    } else {
      fpPayload.items = [{ 
        name: 'RANGER RAPTOR 0KM', 
        title: 'RANGER RAPTOR 0KM',  // CORREÇÃO: Freepay exige o campo 'title'
        quantity: 1, 
        unit_price: amountCents 
      }];
    }

    // OTIMIZAÇÃO: AbortController com timeout reduzido para 5s (fail fast)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    let response;
    try {
      // OTIMIZAÇÃO: Iniciar o fetch o mais rápido possível
      response = await fetch(FREEPAY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': FREEPAY_AUTH_HEADER,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(fpPayload),
        signal: controller.signal,
        ...fetchOptions
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Freepay API Error',
        message: data.message || 'Erro ao processar pagamento',
        details: data,
        errors: data.errors || []
      });
    }

    // OTIMIZAÇÃO: Retornar apenas o essencial para reduzir o tamanho do pacote JSON
    let result = { success: true };
    if (data?.data) {
      const d = data.data;
      const pixObj = d.pix || d.payment || d.data || {};
      result.pixCode = d.pixCode || pixObj.qr_code || pixObj.copy_and_paste || pixObj.qrcode || pixObj.code || pixObj.payload;
      result.transactionId = d.transactionId || d.id;
    }

    return res.status(200).json(result);

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`❌ Timeout Freepay após ${FREEPAY_TIMEOUT_MS}ms`);
      return res.status(504).json({ error: 'timeout', message: 'Gateway de pagamento não respondeu a tempo. Tente novamente.' });
    }
    console.error('❌ Erro em /api/create-pix:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Health check
app.get('/health', (_req, res) => res.status(200).json({
  status: 'ok',
  uptime: Math.floor(process.uptime()),
  timestamp: new Date().toISOString()
}));

// SPA fallback — deve vir por último
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
  console.log(`🏥 Health: http://0.0.0.0:${PORT}/health`);
  console.log(`✅ Compressão Gzip ativada (filtro corrigido)`);
  console.log(`✅ Cache headers configurados (ETag correto)`);
  console.log(`✅ Headers de segurança ativados`);
});
