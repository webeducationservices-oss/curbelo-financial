// Shared helper — pushes a website lead into SuiteDash CRM.
// Used by /api/lead, /api/budget-builder, /api/vacation-planner, /api/needs-vs-wants.
// Files in /api prefixed with "_" are NOT exposed as routes by Vercel.
// Secrets come from Vercel env vars (SUITEDASH_PUBLIC_ID / SUITEDASH_SECRET_KEY).

const SUITEDASH_ENDPOINT = "https://app.suitedash.com/secure-api/contact";

// Friendly CRM tag for each form / tool so George can see what they filled out.
const FORM_TYPE_TAGS = {
  newsletter: "Newsletter",
  contact: "Contact Form",
  "budget-tool": "Budget Builder",
  "vacation-planner": "Vacation Planner",
  "needs-vs-wants": "Needs vs Wants",
};

// Returns the standard tag list for a given form_type, e.g. ["Website Lead","Budget Builder"].
function tagsFor(formType) {
  const t = (formType || "contact").toLowerCase();
  return ["Website Lead", FORM_TYPE_TAGS[t] || "Contact Form"];
}

// opts: { first_name, last_name, email, phone, tags: [], notes: [] }
// Returns { success, uid } or { success: false, ... }. Never throws.
async function pushLead(opts) {
  const PUBLIC_ID = process.env.SUITEDASH_PUBLIC_ID;
  const SECRET_KEY = process.env.SUITEDASH_SECRET_KEY;
  if (!PUBLIC_ID || !SECRET_KEY) {
    console.error("[crm] SuiteDash credentials not configured in env");
    return { success: false, error: "CRM not configured" };
  }

  const email = (opts.email || "").trim();
  const first = (opts.first_name || "").trim();
  const last = (opts.last_name || "").trim();
  if (!email || (!first && !last)) return { success: false, error: "Missing name/email" };

  const payload = {
    first_name: first || "(not provided)",
    last_name: last || "(not provided)",
    email,
    role: "Lead",
    tags: opts.tags && opts.tags.length ? opts.tags : ["Website Lead"],
    background_info: (opts.notes || []).filter(Boolean).join("\n"),
  };
  if (opts.phone) payload.phone = String(opts.phone).trim();

  try {
    const r = await fetch(SUITEDASH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Public-ID": PUBLIC_ID,
        "X-Secret-Key": SECRET_KEY,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.success === false) {
      console.error("[crm] SuiteDash rejected", r.status, JSON.stringify(data).slice(0, 200));
      return { success: false, status: r.status };
    }
    return { success: true, uid: data && data.data && data.data.uid };
  } catch (e) {
    console.error("[crm] SuiteDash request failed", String(e));
    return { success: false, error: "CRM request failed" };
  }
}

module.exports = { pushLead, tagsFor, FORM_TYPE_TAGS };
