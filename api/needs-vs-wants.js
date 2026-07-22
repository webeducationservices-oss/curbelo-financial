// Vercel serverless function — Needs vs Wants (Couples) tool.
// Takes how a couple tagged common spending items (Need / Want / Depends) plus
// their shared goal and biggest disagreement, asks Claude for an alignment read
// + a simple shared "spending agreement," builds a CSV, and emails it (via
// Resend) to the user + George + Justin. Also pushes a tagged CRM lead.
// All secrets come from Vercel env vars; nothing is exposed to the browser.

const CLAUDE_MODEL = "claude-sonnet-4-6"; // Sonnet 4 retired 2026-06-15
const FROM = "Curbelo Financial Coaching <tools@sitenotifications.org>";
const COACH_EMAIL = "gcfinancialcoach21@gmail.com";
const ADMIN_EMAIL = "justin@webeducationservices.com";
const { pushLead, tagsFor } = require("./_crm.js");
const { persistLead } = require("./_leads.js");

// Form field name -> human label. Keep in sync with needs-vs-wants.html.
const ITEMS = {
  item_dining: "Dining out & takeout",
  item_subs: "Streaming & subscriptions",
  item_fitness: "Gym & fitness",
  item_clothes: "New clothes & shoes",
  item_tech: "Latest phone & gadgets",
  item_travel: "Travel & vacations",
  item_coffee: "Daily coffee & treats",
  item_car: "A newer / nicer car",
  item_home: "Home décor & upgrades",
  item_kids: "Kids' activities & extras",
};

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

  // Honeypot
  if (body._honey) return res.status(200).json({ success: true, skipped: "honeypot" });

  const first = (body.first_name || "").trim();
  const last = (body.last_name || "").trim();
  const email = (body.email || "").trim();
  if (!email || !first) {
    return res.status(200).json({ success: false, error: "Missing required fields (name, email)" });
  }

  // reCAPTCHA (cost protection) — only if secret configured
  const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY;
  if (RECAPTCHA_SECRET && body.recaptcha_token) {
    try {
      const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${encodeURIComponent(RECAPTCHA_SECRET)}&response=${encodeURIComponent(body.recaptcha_token)}`,
      });
      const v = await r.json();
      if (v.success && typeof v.score === "number" && v.score < 0.3) {
        return res.status(200).json({ success: true, skipped: "low recaptcha score" });
      }
    } catch (e) { console.warn("[needs] recaptcha verify failed (continuing):", String(e)); }
  }

  // Collect their categorizations
  const choices = {};
  Object.keys(ITEMS).forEach((k) => { if (body[k]) choices[ITEMS[k]] = String(body[k]).trim(); });

  const inputs = {
    name: first + " " + last,
    partner_name: (body.partner_name || "").slice(0, 60),
    categorizations: choices,
    shared_goal: (body.shared_goal || "").slice(0, 300),
    biggest_disagreement: (body.disagreement || "").slice(0, 400),
  };

  // Push the lead into the CRM (server-side, tagged).
  await pushLead({
    first_name: first, last_name: last, email,
    tags: tagsFor("needs-vs-wants"),
    notes: [
      "Tool: Needs vs Wants (Couples)",
      inputs.partner_name ? "Partner: " + inputs.partner_name : "",
      inputs.shared_goal ? "Shared goal: " + inputs.shared_goal : "",
      inputs.biggest_disagreement ? "Biggest disagreement: " + inputs.biggest_disagreement : "",
      "Source: curbelofinancialcoaching.com (/needs-vs-wants/)",
      "Submitted: " + new Date().toISOString(),
    ],
  });

  // Also persist to the shared `leads` table (silently — no extra email; George
  // already gets the result email and the tagged SuiteDash contact).
  await persistLead("needs-vs-wants", { ...body, form_location: "/needs-vs-wants/" });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!ANTHROPIC_API_KEY || !RESEND_API_KEY) {
    console.error("[needs] missing ANTHROPIC_API_KEY or RESEND_API_KEY");
    return res.status(200).json({ success: false, error: "Service not configured" });
  }

  const system =
    "You are a warm, judgment-free financial coach assistant for Curbelo Financial Coaching (George Curbelo, Ramsey-certified). " +
    "A couple just sorted common spending items as Need, Want, or 'Depends,' and shared one money goal and their biggest money disagreement. " +
    "Help them get ON THE SAME PAGE — no blame, no shame, team-first. " +
    "Give an encouraging read on how aligned they seem, name the spots couples like them most often clash on (use their 'Depends'/'Want' picks and stated disagreement), and give them a simple, practical SHARED SPENDING AGREEMENT they can actually follow. " +
    "Return ONLY a valid JSON object (no markdown, no commentary) with EXACTLY this shape: " +
    '{"alignment_summary": string, "likely_friction": [string, string, string], "spending_agreement": [string, string, string, string], "coach_notes": [string, string, string]}. ' +
    "spending_agreement = 3-4 concrete shared rules (e.g., a dollar threshold above which they check in with each other first, a monthly 'fun money' allowance each, a once-a-month money date). Keep every line to one short, specific sentence.";

  const userMsg = "Here are the couple's answers. Give them their results:\n" + JSON.stringify(inputs, null, 2);

  let out;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: userMsg }] }),
    });
    const data = await r.json();
    if (!r.ok) { console.error("[needs] Claude error", r.status, JSON.stringify(data).slice(0, 300)); return res.status(200).json({ success: false, error: "Generation failed" }); }
    const text = (data.content || []).map((b) => b.text || "").join("");
    out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch (e) {
    console.error("[needs] Claude/parse failed:", String(e));
    return res.status(200).json({ success: false, error: "Generation failed" });
  }

  const csv = buildCSV(inputs, out);
  const csvB64 = Buffer.from(csv, "utf-8").toString("base64");
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const agreementHtml = (out.spending_agreement || []).map((a) => `<li style="margin-bottom:8px">${escapeHtml(a)}</li>`).join("");
  const frictionHtml = (out.likely_friction || []).map((f) => `<li style="margin-bottom:6px">${escapeHtml(f)}</li>`).join("");
  const notesHtml = (out.coach_notes || []).map((n) => `<li style="margin-bottom:6px">${escapeHtml(n)}</li>`).join("");

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;line-height:1.6">
    <div style="background:linear-gradient(135deg,#0a1f44,#1a5fb4);padding:22px 26px;border-radius:12px 12px 0 0;color:#fff">
      <h1 style="margin:0;font-size:20px">Your Needs vs. Wants Results</h1>
      <p style="margin:6px 0 0;color:#cfe0f5;font-size:14px">Curbelo Financial Coaching &middot; ${dateStr}</p>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px 26px">
      <p>Hi ${escapeHtml(first)},</p>
      <p style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px 16px;font-size:14px">${escapeHtml(out.alignment_summary || "You're taking a great step by talking about money as a team.")}</p>
      ${agreementHtml ? `<h3 style="font-size:16px;margin-top:22px;color:#0a1f44">Your Shared Spending Agreement</h3><p style="font-size:13px;color:#64748b;margin-top:0">A few simple rules to decide together — stick them on the fridge.</p><ol style="padding-left:18px;font-size:14px">${agreementHtml}</ol>` : ""}
      ${frictionHtml ? `<h3 style="font-size:15px;margin-top:20px">Where couples like you tend to clash</h3><ul style="padding-left:18px;font-size:14px">${frictionHtml}</ul>` : ""}
      ${notesHtml ? `<h3 style="font-size:15px;margin-top:20px">A few notes from your coach</h3><ul style="padding-left:18px;font-size:14px">${notesHtml}</ul>` : ""}
      <p style="margin-top:14px;font-size:14px">Your full answers and agreement are attached as a spreadsheet (CSV) you can save and revisit.</p>
      <p style="margin-top:22px">Want to build a money plan you both feel good about? <a href="https://www.curbelofinancialcoaching.com/contact/" style="color:#1a5fb4;font-weight:600">Book a free 30-minute assessment</a> with George.</p>
      <p style="margin:2px 0">You've got this — together,<br><b>George Curbelo</b><br>Curbelo Financial Coaching<br><a href="tel:+17273165747" style="color:#1a5fb4">(727) 316-5747</a></p>
    </div>
  </div>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        bcc: [COACH_EMAIL, ADMIN_EMAIL],
        reply_to: "info@curbelofinancialcoaching.com",
        subject: "Your needs vs. wants results — Curbelo Financial Coaching",
        html,
        attachments: [{ filename: `Curbelo-Needs-vs-Wants-${first}.csv`, content: csvB64 }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("[needs] Resend error", r.status, JSON.stringify(data).slice(0, 300)); return res.status(200).json({ success: false, error: "Email failed" }); }
  } catch (e) {
    console.error("[needs] Resend failed:", String(e));
    return res.status(200).json({ success: false, error: "Email failed" });
  }

  return res.status(200).json({ success: true });
};

function readRaw(req) { return new Promise((resolve, reject) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); req.on("error", reject); }); }
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function cell(v) { if (v === null || v === undefined) return ""; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

function buildCSV(inputs, o) {
  const rows = [];
  rows.push([`Curbelo Financial Coaching — Needs vs. Wants (Couples) for ${inputs.name}`]);
  rows.push([new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })]);
  rows.push([]);
  if (inputs.partner_name) rows.push(["Partner", inputs.partner_name]);
  if (inputs.shared_goal) rows.push(["Shared goal", inputs.shared_goal]);
  rows.push([]);
  rows.push(["SPENDING ITEM", "YOUR CALL"]);
  Object.keys(inputs.categorizations).forEach((k) => rows.push([k, inputs.categorizations[k]]));
  rows.push([]);
  rows.push(["ALIGNMENT", o.alignment_summary || ""]);
  rows.push([]);
  rows.push(["YOUR SHARED SPENDING AGREEMENT"]);
  (o.spending_agreement || []).forEach((a, i) => rows.push([i + 1 + ". " + a]));
  rows.push([]);
  rows.push(["WHERE COUPLES LIKE YOU TEND TO CLASH"]);
  (o.likely_friction || []).forEach((f) => rows.push([f]));
  rows.push([]);
  rows.push(["COACH NOTES"]);
  (o.coach_notes || []).forEach((n) => rows.push([n]));
  rows.push([]);
  rows.push(["Built free at curbelofinancialcoaching.com/toolkit — book a free assessment at curbelofinancialcoaching.com/contact"]);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
