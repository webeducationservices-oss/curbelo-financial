// Shared helper — persists a tool submission to the shared `leads` table
// (and the site's Forms Log sheet) via myaieditor's form-notify endpoint.
//
// Why: the three AI assessments email the client their result and push a tagged
// contact into SuiteDash, but they never went through form-notify — so nothing
// landed in `leads`. SuiteDash is Curbelo's actual pipeline so no lead was lost,
// but this closes the gap so the data is consistent with every other WES site
// (and is already there if Curbelo ever gets an admin portal).
//
// It persists WITHOUT emailing: we call form-notify as a trusted internal caller
// (x-internal-secret) with skip_notification, so George doesn't get a second
// notification on top of the result email the tool already sends him.
//
// Best-effort — never throws, so a form-notify hiccup can never break a tool.

const FORM_NOTIFY = "https://myaieditor.com/api/form-notify";
const SITE_SLUG = "curbelo-financial";

// form-notify only copies string values into leads.raw_data, so coerce
// everything (the tools submit numbers for income/expenses).
function stringify(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

// opts.notify === true sends the normal form-notify email as well. Use it for
// submissions we would otherwise have dropped (low reCAPTCHA score, blocklist
// hit) so a human actually sees them and can rescue a false positive.
//
// opts.review === true means "this row was ALREADY judged and is being stored so
// a human can look at it". Those skip form-notify's content filters, because the
// whole point of the row is to survive a spam verdict -- letting form-notify drop
// it would delete the safety net this file exists to provide.
//
// Everything else opts INTO those filters. The endpoints here are public: anyone
// can POST to them, and the x-internal-secret makes form-notify treat the payload
// as authenticated upstream and skip the gibberish-name and dotted-Gmail checks
// that nothing on this site replicates.
//
// Returns { success, accepted }. `accepted` is false ONLY on an explicit spam
// verdict, so a form-notify outage never looks like spam to a caller.
async function persistLead(formType, fields, opts) {
  const secret = process.env.INTERNAL_FORM_SECRET;
  if (!secret) {
    console.warn("[leads] INTERNAL_FORM_SECRET not set — skipping leads persistence");
    return { success: false, error: "not configured" };
  }

  const payload = {
    ...stringify(fields),
    // these win over anything in fields
    site_slug: SITE_SLUG,
    form_type: formType,
  };
  if (!(opts && opts.notify)) payload.skip_notification = "true";
  delete payload._honey;
  delete payload.recaptcha_token;

  const headers = { "Content-Type": "application/json", "x-internal-secret": secret };
  if (!(opts && opts.review)) headers["x-internal-content-check"] = "1";

  try {
    const r = await fetch(FORM_NOTIFY, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!r.ok) {
      console.error("[leads] form-notify rejected", r.status, (await r.text()).slice(0, 200));
      return { success: false, status: r.status };
    }
    // 200 never means accepted -- form-notify answers 200 for every rejection.
    const j = await r.json().catch(() => null);
    if (j && j.accepted === false) {
      console.warn("[leads] form-notify judged this spam:", j.reason, "type=", formType);
      return { success: true, accepted: false, reason: j.reason };
    }
    return { success: true, accepted: true };
  } catch (e) {
    console.error("[leads] form-notify request failed:", String(e));
    return { success: false, error: "request failed" };
  }
}

module.exports = { persistLead };
