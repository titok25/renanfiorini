/**
 * /api/create-pix — Handler otimizado (CommonJS)
 *
 * OTIMIZAÇÕES aplicadas:
 *  1. Removido loop de regex (collectStrings/moneyRegex) que varria todo o body
 *  2. Auth header pré-computado via módulo-level cache
 *  3. AbortController com timeout de 8s para o fetch Freepay
 *  4. Payload enxuto — sem campos desnecessários
 *  5. Campo 'title' adicionado aos itens (exigido pela Freepay)
 */

// Cache do auth header no escopo do módulo (reutilizado entre invocações)
let _cachedAuth = null;
function getAuthHeader() {
  if (_cachedAuth) return _cachedAuth;
  const pub = process.env.FREEPAY_PUBLIC_KEY;
  const sec = process.env.FREEPAY_SECRET_KEY;
  if (pub && sec) {
    _cachedAuth = `Basic ${Buffer.from(`${pub}:${sec}`).toString('base64')}`;
  }
  return _cachedAuth;
}

const FREEPAY_ENDPOINT = 'https://api.freepaybrasil.com/v1/payment-transaction/create';
const TIMEOUT_MS = 8000;

const parseMoneyToCents = v => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 100);
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9,\.]/g, '').replace(',', '.'));
    return isNaN(n) ? null : Math.round(n * 100);
  }
  return null;
};

module.exports = async function (req, res) {
  try {
    if (req.method === 'GET') return res.status(200).json({ ok: true });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    const amount = body.amount;

    const authHeader = getAuthHeader();
    if (!authHeader) return res.status(500).json({ error: 'freepay_keys_missing' });

    let amountCents = parseMoneyToCents(amount);

    const fpPayload = { payment_method: 'pix' };
    if (process.env.FREEPAY_POSTBACK_URL) fpPayload.postback_url = process.env.FREEPAY_POSTBACK_URL;

    // Normalizar customer
    if (body.customer) {
      const customer = Object.assign({}, body.customer);
      const doc = customer.document;
      if (doc) {
        const digits = (typeof doc === 'string' ? doc : String(doc.number || '')).replace(/\D/g, '');
        const type = digits.length === 11 ? 'cpf' : digits.length === 14 ? 'cnpj' : undefined;
        customer.document = { ...(type ? { type } : {}), number: digits };
      }
      fpPayload.customer = customer;
    }

    // Normalizar items
    if (Array.isArray(body.items) && body.items.length) {
      const items = body.items.map(it => {
        const unitCents = parseMoneyToCents(it.unit_price) || 0;
        const quantity = Math.max(1, parseInt(it.quantity, 10) || 1);
        return { 
          name: it.name || 'item',
          title: it.name || 'item',  // CORREÇÃO: Freepay exige 'title'
          quantity, 
          unit_price: unitCents 
        };
      });
      fpPayload.items = items;
      fpPayload.amount = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
    } else {
      fpPayload.items = [{ 
        name: 'RANGER RAPTOR 0KM',
        title: 'RANGER RAPTOR 0KM',  // CORREÇÃO: Freepay exige 'title'
        quantity: 1, 
        unit_price: amountCents 
      }];
    }

    if (body.metadata) fpPayload.metadata = body.metadata;

    if (!fpPayload.amount || Number(fpPayload.amount) <= 0) {
      return res.status(400).json({ error: 'invalid_amount' });
    }

    // Fetch com timeout
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let resp;
    try {
      resp = await fetch(FREEPAY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(fpPayload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(tid);
    }

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }

    // Normalizar resposta
    if (json && json.data) {
      const d = json.data;
      if (!d.transactionId && d.id) d.transactionId = d.id;
      if (!d.calculatedAmount) d.calculatedAmount = d.amount || d.total;
      if (!d.pixCode) {
        const pixObj = d.pix || d.payment || d.data || {};
        d.pixCode = pixObj.qr_code || pixObj.copy_and_paste || pixObj.qrcode || pixObj.code || null;
      }
    }

    return res.status(resp.status || 200).json(json);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'timeout', message: 'Freepay não respondeu a tempo.' });
    }
    console.error('create-pix error', err && err.stack || err);
    return res.status(500).json({ error: 'internal_error', detail: String(err) });
  }
};
