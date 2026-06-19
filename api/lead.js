// Vercel serverless function — pushes website form leads into SuiteDash CRM.
// Used by the contact form + newsletter signup (the AI tools push to the CRM
// themselves, server-side). Secrets are read from Vercel env vars
// (SUITEDASH_PUBLIC_ID / SUITEDASH_SECRET_KEY) and never exposed to the browser.

const { pushLead, tagsFor, looksLikeSpam } = require("./_crm.js");

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

  // Silent-drop cold-pitch spam (e.g., MAVIS / vettedvas.com) — return success
  // so the spammer thinks it worked, but never reaches the CRM.
  const spamReason = looksLikeSpam(body);
  if (spamReason) {
    console.warn("[lead] dropped spam:", spamReason, "email=", body.email);
    return res.status(200).json({ success: true, skipped: "spam" });
  }

  const formType = (body.form_type || "contact").toLowerCase();

  const notes = [];
  if (body.interest) notes.push("Interest: " + body.interest);
  if (body.message) notes.push("Message: " + body.message);
  if (body.referral) notes.push("Referred by: " + body.referral);
  notes.push("Source: curbelofinancialcoaching.com" + (body.form_location ? " (" + body.form_location + ")" : ""));
  notes.push("Submitted: " + new Date().toISOString());

  const result = await pushLead({
    first_name: first,
    last_name: last,
    email,
    phone: body.phone,
    tags: tagsFor(formType),
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
