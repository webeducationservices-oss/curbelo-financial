// Vercel serverless function — Vacation Planner tool.
// Takes the questionnaire answers, asks Claude to build a realistic, debt-free
// vacation savings plan, builds a CSV, and emails it (via Resend) to the user
// + George + Justin. Also pushes a tagged lead into the CRM (server-side).
// All secrets come from Vercel env vars; nothing is exposed to the browser.

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const FROM = "Curbelo Financial Coaching <tools@sitenotifications.org>";
const COACH_EMAIL = "gcfinancialcoach21@gmail.com";
const ADMIN_EMAIL = "justin@webeducationservices.com";
const { pushLead, tagsFor } = require("./_crm.js");

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
    } catch (e) { console.warn("[vacation] recaptcha verify failed (continuing):", String(e)); }
  }

  const inputs = {
    name: first + " " + last,
    destination: body.destination || "",
    trip_type: body.trip_type || "",
    travelers: body.travelers || "",
    timeframe: body.timeframe || "",
    nights: num(body.nights),
    travel_cost: num(body.travel_cost),
    lodging_cost: num(body.lodging_cost),
    food_fun_cost: num(body.food_fun_cost),
    extras_cost: num(body.extras_cost),
    already_saved: num(body.already_saved),
    monthly_save: num(body.monthly_save),
    must_have: (body.must_have || "").slice(0, 400),
  };

  // Push the lead into the CRM (server-side, tagged) — capture it regardless of
  // whether the plan generation/email below succeeds.
  await pushLead({
    first_name: first, last_name: last, email,
    tags: tagsFor("vacation-planner"),
    notes: [
      "Tool: Vacation Planner",
      inputs.destination ? "Destination: " + inputs.destination : "",
      inputs.trip_type ? "Trip type: " + inputs.trip_type : "",
      inputs.timeframe ? "Timeframe: " + inputs.timeframe : "",
      inputs.travelers ? "Travelers: " + inputs.travelers : "",
      inputs.monthly_save != null ? "Can save/month: $" + inputs.monthly_save : "",
      inputs.must_have ? "Must-have: " + inputs.must_have : "",
      "Source: curbelofinancialcoaching.com (/vacation-planner/)",
      "Submitted: " + new Date().toISOString(),
    ],
  });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!ANTHROPIC_API_KEY || !RESEND_API_KEY) {
    console.error("[vacation] missing ANTHROPIC_API_KEY or RESEND_API_KEY");
    return res.status(200).json({ success: false, error: "Service not configured" });
  }

  const system =
    "You are a warm, judgment-free financial coach assistant for Curbelo Financial Coaching (George Curbelo, Ramsey-certified). " +
    "Build a realistic, encouraging VACATION SAVINGS PLAN so the person can take their trip CASH — no credit-card debt, no 'January regret.' " +
    "If they gave cost estimates, sum them for the total; if some are blank, estimate sensible amounts from the destination, trip type, nights, and number of travelers. " +
    "Figure out how much they still need (total minus what they've already saved), and a realistic monthly savings target to hit it within their timeframe. " +
    "If the monthly amount they say they can save is too low for their timeframe, set on_track to false and gently suggest either saving a bit more, pushing the date, or trimming the budget. " +
    "Return ONLY a valid JSON object (no markdown, no commentary) with EXACTLY this shape: " +
    '{"trip_summary": string, "total_estimated_cost": number, "already_saved": number, "amount_still_needed": number, "recommended_monthly_savings": number, "months_to_goal": number, "on_track": boolean, "timeline_note": string, "budget_breakdown": [{"category": string, "estimated": number, "tip": string}], "savings_tips": [string, string, string], "coach_notes": [string, string, string]}. ' +
    "budget_breakdown should cover the main trip costs (travel, lodging, food & fun, extras, and a small buffer). Keep every tip and note to one short, specific sentence.";

  const userMsg = "Here are the client's vacation details (USD). Build their savings plan:\n" + JSON.stringify(inputs, null, 2);

  let plan;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: userMsg }] }),
    });
    const data = await r.json();
    if (!r.ok) { console.error("[vacation] Claude error", r.status, JSON.stringify(data).slice(0, 300)); return res.status(200).json({ success: false, error: "Generation failed" }); }
    const text = (data.content || []).map((b) => b.text || "").join("");
    plan = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch (e) {
    console.error("[vacation] Claude/parse failed:", String(e));
    return res.status(200).json({ success: false, error: "Generation failed" });
  }

  const csv = buildCSV(inputs, plan);
  const csvB64 = Buffer.from(csv, "utf-8").toString("base64");
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const dest = inputs.destination || "your getaway";

  const tipsHtml = (plan.savings_tips || []).map((t) => `<li style="margin-bottom:6px">${escapeHtml(t)}</li>`).join("");
  const notesHtml = (plan.coach_notes || []).map((n) => `<li style="margin-bottom:6px">${escapeHtml(n)}</li>`).join("");
  const trackColor = plan.on_track ? "#065f46" : "#92400e";
  const trackBg = plan.on_track ? "#ecfdf5" : "#fffbeb";
  const trackBorder = plan.on_track ? "#a7f3d0" : "#fde68a";

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;line-height:1.6">
    <div style="background:linear-gradient(135deg,#0a1f44,#1a5fb4);padding:22px 26px;border-radius:12px 12px 0 0;color:#fff">
      <h1 style="margin:0;font-size:20px">Your Vacation Savings Plan</h1>
      <p style="margin:6px 0 0;color:#cfe0f5;font-size:14px">Curbelo Financial Coaching &middot; ${dateStr}</p>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px 26px">
      <p>Hi ${escapeHtml(first)},</p>
      <p>${escapeHtml(plan.trip_summary || "Here's your plan to take this trip the smart way — paid for in cash.")}</p>
      <div style="background:${trackBg};border:1px solid ${trackBorder};border-radius:10px;padding:16px 18px;margin:18px 0;text-align:center">
        <div style="font-size:13px;color:${trackColor};text-transform:uppercase;letter-spacing:.5px;font-weight:700">Save this much each month</div>
        <div style="font-size:30px;font-weight:800;color:#0a1f44;margin:4px 0">$${money(plan.recommended_monthly_savings)}<span style="font-size:15px;font-weight:600;color:#64748b">/mo</span></div>
        <div style="font-size:13px;color:#475569">for about ${money(plan.months_to_goal)} months &middot; goal: $${money(plan.total_estimated_cost)} total</div>
      </div>
      <p style="background:${trackBg};border:1px solid ${trackBorder};border-radius:8px;padding:12px 16px;font-size:14px;color:${trackColor}">${escapeHtml(plan.timeline_note || "")}</p>
      <p style="font-size:14px;margin-bottom:6px"><strong>Already saved:</strong> $${money(plan.already_saved)} &nbsp;·&nbsp; <strong>Still to go:</strong> $${money(plan.amount_still_needed)}</p>
      ${tipsHtml ? `<h3 style="font-size:15px;margin-top:20px">Smart ways to save faster</h3><ul style="padding-left:18px;font-size:14px">${tipsHtml}</ul>` : ""}
      ${notesHtml ? `<h3 style="font-size:15px;margin-top:20px">A few notes from your coach</h3><ul style="padding-left:18px;font-size:14px">${notesHtml}</ul>` : ""}
      <p style="margin-top:14px;font-size:14px">Your full month-by-month plan and budget breakdown for ${escapeHtml(dest)} is attached as a spreadsheet (CSV) — open it in Excel, Google Sheets, or Numbers.</p>
      <p style="margin-top:22px">Want help actually hitting this goal? <a href="https://www.curbelofinancialcoaching.com/contact/" style="color:#1a5fb4;font-weight:600">Book a free 30-minute assessment</a> with George.</p>
      <p style="margin:2px 0">Happy travels,<br><b>George Curbelo</b><br>Curbelo Financial Coaching<br><a href="tel:+17273165747" style="color:#1a5fb4">(727) 316-5747</a></p>
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
        subject: "Your vacation savings plan — Curbelo Financial Coaching",
        html,
        attachments: [{ filename: `Curbelo-Vacation-Plan-${first}.csv`, content: csvB64 }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("[vacation] Resend error", r.status, JSON.stringify(data).slice(0, 300)); return res.status(200).json({ success: false, error: "Email failed" }); }
  } catch (e) {
    console.error("[vacation] Resend failed:", String(e));
    return res.status(200).json({ success: false, error: "Email failed" });
  }

  return res.status(200).json({ success: true });
};

function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function readRaw(req) { return new Promise((resolve, reject) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); req.on("error", reject); }); }
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function cell(v) { if (v === null || v === undefined) return ""; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function money(n) { return n === null || n === undefined || isNaN(n) ? "" : Math.round(Number(n)); }

function buildCSV(inputs, p) {
  const rows = [];
  rows.push([`Curbelo Financial Coaching — Vacation Savings Plan for ${inputs.name}`]);
  rows.push([new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })]);
  rows.push([]);
  rows.push(["Destination", inputs.destination || ""]);
  rows.push(["Trip type", inputs.trip_type || ""]);
  rows.push(["Travelers", inputs.travelers || ""]);
  rows.push(["Timeframe", inputs.timeframe || ""]);
  if (inputs.nights != null) rows.push(["Nights", inputs.nights]);
  rows.push([]);
  rows.push(["Total estimated cost", "", money(p.total_estimated_cost)]);
  rows.push(["Already saved", "", money(p.already_saved)]);
  rows.push(["Amount still needed", "", money(p.amount_still_needed)]);
  rows.push(["Recommended monthly savings", "", money(p.recommended_monthly_savings)]);
  rows.push(["Months to goal", "", money(p.months_to_goal)]);
  rows.push(["On track for your timeframe?", "", p.on_track ? "Yes" : "Not yet — see note"]);
  rows.push([]);
  rows.push(["BUDGET BREAKDOWN", "ESTIMATED ($)", "TIP"]);
  (p.budget_breakdown || []).forEach((b) => rows.push([b.category || "", money(b.estimated), b.tip || ""]));
  rows.push([]);
  rows.push(["SMART WAYS TO SAVE FASTER"]);
  (p.savings_tips || []).forEach((t) => rows.push([t]));
  rows.push([]);
  rows.push(["COACH NOTES"]);
  (p.coach_notes || []).forEach((n) => rows.push([n]));
  rows.push([]);
  rows.push(["Built free at curbelofinancialcoaching.com/toolkit — book a free assessment at curbelofinancialcoaching.com/contact"]);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
