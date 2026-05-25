// Vercel serverless function — Budget Builder tool.
// Takes questionnaire answers, asks Claude to generate a personalized monthly budget,
// builds a CSV spreadsheet, and emails it (via Resend) to the user + George + Justin.
// All secrets come from Vercel env vars; nothing is exposed to the browser.

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const FROM = "Curbelo Financial Coaching <budget@sitenotifications.org>";
const COACH_EMAIL = "gcfinancialcoach21@gmail.com";
const ADMIN_EMAIL = "justin@webeducationservices.com";

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
  const income = parseFloat(body.monthly_income);
  if (!email || !first || !(income > 0)) {
    return res.status(200).json({ success: false, error: "Missing required fields (name, email, income)" });
  }

  // reCAPTCHA (cost protection) — only if secret configured
  const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY;
  if (RECAPTCHA_SECRET && body.recaptcha_token) {
    try {
      const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `secret=${encodeURIComponent(RECAPTCHA_SECRET)}&response=${encodeURIComponent(body.recaptcha_token)}`
      });
      const v = await r.json();
      if (v.success && typeof v.score === "number" && v.score < 0.3) {
        return res.status(200).json({ success: true, skipped: "low recaptcha score" });
      }
    } catch (e) { console.warn("[budget] recaptcha verify failed (continuing):", String(e)); }
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!ANTHROPIC_API_KEY || !RESEND_API_KEY) {
    console.error("[budget] missing ANTHROPIC_API_KEY or RESEND_API_KEY");
    return res.status(200).json({ success: false, error: "Service not configured" });
  }

  // ---- Build the prompt for Claude ----
  const inputs = {
    name: first + " " + last,
    household_size: body.household_size || "",
    budgeting_with: body.budgeting_with || "",
    monthly_income: income,
    pay_frequency: body.pay_frequency || "",
    housing: num(body.housing), utilities: num(body.utilities),
    transportation: num(body.transportation), food: num(body.food),
    debt_payments: num(body.debt_payments), subscriptions: num(body.subscriptions),
    other_expenses: num(body.other_expenses), current_savings_monthly: num(body.current_savings_monthly),
    top_goal: body.top_goal || "", challenge: (body.challenge || "").slice(0, 600)
  };

  const system = "You are a warm, judgment-free financial coach assistant for Curbelo Financial Coaching (George Curbelo, Ramsey-certified). " +
    "Given a person's monthly finances, produce a realistic, encouraging personalized monthly budget. " +
    "Adapt a sensible framework (e.g. 50/30/20, or debt-focused if that's their goal) to THEIR numbers and goal. " +
    "The recommended amounts must sum to no more than their monthly income (leave a small buffer if possible). " +
    "Return ONLY a valid JSON object (no markdown, no commentary) with EXACTLY this shape: " +
    '{"framework_note": string, "categories": [{"name": string, "type": "Need"|"Want"|"Savings"|"Debt", "current": number|null, "recommended": number, "tip": string}], "total_recommended": number, "monthly_leftover": number, "coach_notes": [string, string, string]}. ' +
    "Include categories for income areas they listed plus Savings and (if relevant) Debt Payoff and an Emergency Fund line. Keep tips to one short sentence. Keep coach_notes to 3 encouraging, specific notes.";

  const userMsg = "Here are the client's monthly finances (USD). Build their budget:\n" + JSON.stringify(inputs, null, 2);

  let budget;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2500,
        system,
        messages: [{ role: "user", content: userMsg }]
      })
    });
    const data = await r.json();
    if (!r.ok) { console.error("[budget] Claude error", r.status, JSON.stringify(data).slice(0, 300)); return res.status(200).json({ success: false, error: "Generation failed" }); }
    const text = (data.content || []).map(b => b.text || "").join("");
    const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    budget = JSON.parse(jsonStr);
  } catch (e) {
    console.error("[budget] Claude/parse failed:", String(e));
    return res.status(200).json({ success: false, error: "Generation failed" });
  }

  // ---- Build CSV ----
  const csv = buildCSV(inputs, budget);
  const csvB64 = Buffer.from(csv, "utf-8").toString("base64");
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // ---- Email via Resend (To: client, Bcc: coach + admin) ----
  const notesHtml = (budget.coach_notes || []).map(n => `<li style="margin-bottom:6px">${escapeHtml(n)}</li>`).join("");
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;line-height:1.6">
    <div style="background:linear-gradient(135deg,#0a1f44,#1a5fb4);padding:22px 26px;border-radius:12px 12px 0 0;color:#fff">
      <h1 style="margin:0;font-size:20px">Your Personalized Budget</h1>
      <p style="margin:6px 0 0;color:#cfe0f5;font-size:14px">Curbelo Financial Coaching &middot; ${dateStr}</p>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px 26px">
      <p>Hi ${escapeHtml(first)},</p>
      <p>Thanks for using the Budget Builder! Your personalized monthly budget spreadsheet is attached as a CSV — open it in Excel, Google Sheets, or Numbers and start putting every dollar to work.</p>
      <p style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px 16px;font-size:14px">${escapeHtml(budget.framework_note || "A budget built around your income and goals.")}</p>
      ${notesHtml ? `<h3 style="font-size:15px;margin-top:20px">A few notes from your coach</h3><ul style="padding-left:18px;font-size:14px">${notesHtml}</ul>` : ""}
      <p style="margin-top:22px">Want help putting this into action and staying accountable? <a href="https://www.curbelofinancialcoaching.com/contact/" style="color:#1a5fb4;font-weight:600">Book a free 30-minute assessment</a> with George.</p>
      <p style="margin:2px 0">You've got this,<br><b>George Curbelo</b><br>Curbelo Financial Coaching<br><a href="tel:+17273165747" style="color:#1a5fb4">(727) 316-5747</a></p>
    </div>
  </div>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        bcc: [COACH_EMAIL, ADMIN_EMAIL],
        reply_to: "info@curbelofinancialcoaching.com",
        subject: "Your personalized budget spreadsheet — Curbelo Financial Coaching",
        html,
        attachments: [{ filename: `Curbelo-Budget-${first}.csv`, content: csvB64 }]
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("[budget] Resend error", r.status, JSON.stringify(data).slice(0, 300)); return res.status(200).json({ success: false, error: "Email failed" }); }
  } catch (e) {
    console.error("[budget] Resend failed:", String(e));
    return res.status(200).json({ success: false, error: "Email failed" });
  }

  return res.status(200).json({ success: true });
};

function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function readRaw(req) { return new Promise((resolve, reject) => { let d = ""; req.on("data", c => (d += c)); req.on("end", () => resolve(d)); req.on("error", reject); }); }
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function cell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function money(n) { return (n === null || n === undefined || isNaN(n)) ? "" : Math.round(Number(n)); }

function buildCSV(inputs, b) {
  const rows = [];
  rows.push([`Curbelo Financial Coaching — Personalized Monthly Budget for ${inputs.name}`]);
  rows.push([new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })]);
  rows.push([]);
  rows.push(["Monthly take-home income", "", "", money(inputs.monthly_income)]);
  rows.push(["Top goal", inputs.top_goal || ""]);
  rows.push([]);
  rows.push(["CATEGORY", "TYPE", "CURRENT ($)", "RECOMMENDED ($)", "COACH TIP"]);
  (b.categories || []).forEach(c => {
    rows.push([c.name || "", c.type || "", money(c.current), money(c.recommended), c.tip || ""]);
  });
  rows.push([]);
  rows.push(["TOTAL RECOMMENDED", "", "", money(b.total_recommended)]);
  rows.push(["LEFTOVER (income − recommended)", "", "", money(b.monthly_leftover)]);
  rows.push([]);
  rows.push(["COACH NOTES"]);
  (b.coach_notes || []).forEach(n => rows.push([n]));
  rows.push([]);
  rows.push(["Built free at curbelofinancialcoaching.com/budget-builder — book a free assessment at curbelofinancialcoaching.com/contact"]);
  return rows.map(r => r.map(cell).join(",")).join("\r\n");
}
