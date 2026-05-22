// Vercel serverless function — pushes website form leads into SuiteDash CRM.
// Secrets are read from Vercel env vars (SUITEDASH_PUBLIC_ID / SUITEDASH_SECRET_KEY),
// never hard-coded and never exposed to the browser.

const SUITEDASH_ENDPOINT = 'https://app.suitedash.com/secure-api/contact';

module.exports = async (req, res) => {
  // CORS (same-origin in practice, but permissive POST is harmless here)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  // Parse body (Vercel usually parses JSON automatically; fall back to raw read)
  let body = req.body;
  if (!body || typeof body !== 'object') {
    try { body = JSON.parse(await readRaw(req)); } catch { body = {}; }
  }

  // Honeypot — bots fill this; pretend success so they move on
  if (body._honey) return res.status(200).json({ success: true, skipped: 'honeypot' });

  const first = (body.first_name || '').trim();
  const last  = (body.last_name || '').trim();
  const email = (body.email || '').trim();

  if (!email || (!first && !last)) {
    return res.status(200).json({ success: false, error: 'Missing required fields (name + email)' });
  }

  const PUBLIC_ID = process.env.SUITEDASH_PUBLIC_ID;
  const SECRET_KEY = process.env.SUITEDASH_SECRET_KEY;
  if (!PUBLIC_ID || !SECRET_KEY) {
    console.error('[lead] SuiteDash credentials not configured in env');
    return res.status(200).json({ success: false, error: 'CRM not configured' });
  }

  // Tags + notes
  const formType = (body.form_type || 'contact').toLowerCase();
  const tags = ['Website Lead'];
  tags.push(formType === 'newsletter' ? 'Newsletter' : 'Contact Form');

  const notes = [];
  if (body.interest) notes.push('Interest: ' + body.interest);
  if (body.message) notes.push('Message: ' + body.message);
  if (body.referral) notes.push('Referred by: ' + body.referral);
  notes.push('Source: curbelofinancialcoaching.com' + (body.form_location ? ' (' + body.form_location + ')' : ''));
  notes.push('Submitted: ' + new Date().toISOString());

  const payload = {
    first_name: first || '(not provided)',
    last_name: last || '(not provided)',
    email,
    role: 'Lead',
    tags,
    background_info: notes.join('\n')
  };
  if (body.phone) payload.phone = String(body.phone).trim();

  try {
    const r = await fetch(SUITEDASH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Public-ID': PUBLIC_ID,
        'X-Secret-Key': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.success === false) {
      console.error('[lead] SuiteDash rejected', r.status, JSON.stringify(data).slice(0, 300));
      return res.status(200).json({ success: false, status: r.status, crm: data && data.message });
    }
    return res.status(200).json({ success: true, uid: data && data.data && data.data.uid });
  } catch (e) {
    console.error('[lead] SuiteDash request failed', String(e));
    return res.status(200).json({ success: false, error: 'CRM request failed' });
  }
};

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}
