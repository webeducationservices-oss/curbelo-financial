// Vercel serverless function — pushes website form leads into SuiteDash CRM.
// Used by the contact form + newsletter signup (the AI tools push to the CRM
// themselves, server-side). Secrets are read from Vercel env vars
// (SUITEDASH_PUBLIC_ID / SUITEDASH_SECRET_KEY) and never exposed to the browser.

const { pushLead, tagsFor, looksLikeSpam } = require("./_crm.js");
const { buildConsentRecord } = require("./_consent.js");
const { persistLead } = require("./_leads.js");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  let body = req.body;
  if (!body || typeof body !== "object") {
    try { body = JSON.parse(await readRaw(req)); } catch { body = {}; }
  }

  // Honeypot — bots fill this; pretend success so they move on
  if (body._honey) return res.status(200).json({ success: true, skipped: "honeypot" });

  const first = (body.first_name || "").trim();
  const last = (body.last_name || "").trim();
  const email = (body.email || "").trim();
  if (!email || (!first && !last)) {
    return res.status(200).json({ success: false, error: "Missing required fields (name + email)" });
  }

  // Cold-pitch spam (e.g., MAVIS / vettedvas.com) never reaches the CRM, and we
  // still answer success so the spammer's retry logic stops. But it is no longer
  // a silent discard: the blocklist can false-positive on a real client, so the
  // submission is persisted (flagged, no notification email) and stays rescuable.
  const spamReason = looksLikeSpam(body);
  if (spamReason) {
    console.warn("[lead] blocked spam:", spamReason, "email=", body.email);
    await persistLead("blocked-spam-review", {
      ...body,
      form_location: body.form_location || "",
      review_reason: "spam_blocklist",
      blocked_by: spamReason,
      original_form_type: body.form_type || "contact",
    }, { review: true });
    return res.status(200).json({ success: true, skipped: "spam" });
  }

  const formType = (body.form_type || "contact").toLowerCase();
  const tags = tagsFor(formType);

  const notes = [];
  if (body.interest) notes.push("Interest: " + body.interest);
  if (body.message) notes.push("Message: " + body.message);
  if (body.referral) notes.push("Referred by: " + body.referral);
  notes.push("Source: curbelofinancialcoaching.com" + (body.form_location ? " (" + body.form_location + ")" : ""));
  notes.push("Submitted: " + new Date().toISOString());

  // SMS opt-in proof (Twilio A2P 10DLC) — only recorded on affirmative consent,
  // stored separately for informational vs marketing. Never inferred from phone.
  const consent = buildConsentRecord(body, req);
  if (consent.hasConsent) {
    tags.push(...consent.tags);
    notes.push("", ...consent.notes);
  }

  const result = await pushLead({
    first_name: first,
    last_name: last,
    email,
    phone: body.phone,
    tags,
    notes,
  });

  return res.status(200).json(result);
};

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}
