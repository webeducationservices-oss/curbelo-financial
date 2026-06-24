// Shared SMS-consent helper (Twilio A2P 10DLC proof-of-consent).
// Holds the CANONICAL disclosure text shown on the forms (the "exact version
// shown" Twilio requires) and builds a proof-of-consent record — tags + a
// human-readable note block — from a form submission. Server-side only.
//
// IMPORTANT: keep the wording in DISCLOSURES word-for-word identical to the
// checkbox labels rendered on contact.html and sms-signup.html. When the text
// changes, bump CONSENT_VERSION so older records stay tied to what was shown.

const CONSENT_VERSION = "2026-06-24";

const BRAND = "Curbelo Financial Coaching";

const DISCLOSURES = {
  informational:
    "I agree to receive appointment reminders, account notifications, service updates, and customer service text messages from " +
    BRAND +
    " at the phone number provided. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. View our Terms and Conditions and Privacy Policy.",
  marketing:
    "I agree to receive recurring promotional and marketing text messages from " +
    BRAND +
    ", including special offers, company news, and service promotions. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase. View our Terms and Conditions and Privacy Policy.",
};

// Truthy for the value an HTML checkbox submits when checked ("yes"/"on"/"true"/"1").
// Unchecked checkboxes are simply absent from the payload — so absence = no consent.
function checked(v) {
  if (v === true) return true;
  const s = String(v || "").trim().toLowerCase();
  return s === "yes" || s === "on" || s === "true" || s === "1";
}

function clientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.headers["x-real-ip"] || (req.socket && req.socket.remoteAddress) || "";
}

// Returns { hasConsent, types: [], tags: [], notes: [] }.
// Only records AFFIRMATIVE consent — never inferred from a phone number alone.
function buildConsentRecord(body, req) {
  const info = checked(body.sms_consent_informational);
  const mkt = checked(body.sms_consent_marketing);
  if (!info && !mkt) return { hasConsent: false, types: [], tags: [], notes: [] };

  const types = [];
  if (info) types.push("informational");
  if (mkt) types.push("marketing");

  const tags = [];
  if (info) tags.push("SMS Consent: Informational");
  if (mkt) tags.push("SMS Consent: Marketing");

  const version = (body.sms_consent_version || CONSENT_VERSION).toString().slice(0, 40);
  const ip = clientIp(req);
  const ua = (req.headers["user-agent"] || "").slice(0, 300);
  const when = new Date().toISOString();
  const where = body.form_location || "";
  const formName = body.form_name || body.form_type || "website form";

  const notes = ["── SMS CONSENT (proof of opt-in) ──"];
  if (info) notes.push('Informational SMS: YES — disclosure shown: "' + DISCLOSURES.informational + '"');
  if (mkt) notes.push('Marketing SMS: YES — disclosure shown: "' + DISCLOSURES.marketing + '"');
  notes.push("Consent version: " + version);
  notes.push("Captured (UTC): " + when);
  notes.push("Source/method: website form — " + formName + (where ? " (" + where + ")" : ""));
  if (ip) notes.push("IP at consent: " + ip);
  if (ua) notes.push("User agent: " + ua);
  notes.push("Brand sending messages: " + BRAND);

  return { hasConsent: true, types, tags, notes };
}

module.exports = { CONSENT_VERSION, BRAND, DISCLOSURES, buildConsentRecord, checked, clientIp };
