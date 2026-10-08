// Receives enquiries from the landing page and forwards them to the client's CRM.
// The CRM secret lives only in Vercel environment variables — never in the page.
//
// Required env:  LEAD_INGEST_SECRET        — value for the x-webhook-secret header
// Optional env:  CRM_MARKETING_PLATFORM_ID — UUID of the "website" platform in the CRM
//                CRM_COUNTRY_ID            — UUID of the market (country) in the CRM
//                CRM_WEBHOOK_URL           — overrides the default webhook address

const CRM_WEBHOOK_URL = 'https://sgkluotanrzfqgqookdo.supabase.co/functions/v1/create-client-webhook';
const PHONE_RE = /^\+380(?:[3-6]\d|73|89|9[1-9])\d{7}$/;
const NAME_RE = /^[A-Za-zА-Яа-яІіЇїЄєҐґЁёЪъЫыЭэ'’ʼ\- ]{2,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'invalid_body' });

  // Hidden field only bots fill in: accept silently, send nothing
  if (body.website) return res.status(200).json({ ok: true });

  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').replace(/[^\d+]/g, '');
  const business = String(body.business || '').trim();
  const message = String(body.message || '').trim().slice(0, 1000);

  if (!NAME_RE.test(name)) return res.status(422).json({ ok: false, error: 'invalid_name' });
  if (!PHONE_RE.test(phone)) return res.status(422).json({ ok: false, error: 'invalid_phone' });
  if (business !== 'ФОП' && business !== 'ТОВ') return res.status(422).json({ ok: false, error: 'invalid_business' });

  const secret = process.env.LEAD_INGEST_SECRET;
  if (!secret) {
    console.error('LEAD_INGEST_SECRET is not set — lead was NOT delivered:', { name, phone, business });
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  const payload = {
    display_name: `${name} (${business})`,
    full_name: name,
    phone,
    comment: [`Заявка з сайту: експрес-аудит ${business}`, message && `Повідомлення: ${message}`].filter(Boolean).join('. '),
    source: 'site',
  };
  if (UUID_RE.test(process.env.CRM_MARKETING_PLATFORM_ID || '')) payload.marketing_platform_id = process.env.CRM_MARKETING_PLATFORM_ID;
  if (UUID_RE.test(process.env.CRM_COUNTRY_ID || '')) payload.country_id = process.env.CRM_COUNTRY_ID;

  try {
    const crm = await fetch(process.env.CRM_WEBHOOK_URL || CRM_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!crm.ok) {
      console.error('CRM rejected lead:', crm.status, (await crm.text()).slice(0, 500), { name, phone, business });
      return res.status(502).json({ ok: false, error: 'crm_rejected' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('CRM request failed:', err && err.message, { name, phone, business });
    return res.status(502).json({ ok: false, error: 'crm_unreachable' });
  }
};
