# Curbelo Financial Coaching — Twilio A2P 10DLC Compliance

This documents the SMS opt-in / consent implementation on www.curbelofinancialcoaching.com,
for Twilio A2P 10DLC campaign registration and carrier review.

- **Brand (must match Twilio registration):** Curbelo Financial Coaching
- **Website:** https://www.curbelofinancialcoaching.com/
- **Support email:** info@curbelofinancialcoaching.com
- **Support phone:** (727) 316-5747
- **Use case:** ACCOUNT_NOTIFICATION — appointment reminders, account notifications, service updates, and customer service messages. **No promotional/marketing texts.**
- **Consent disclosure version:** 2026-06-24 (see `api/_consent.js`)

## Resubmission (after rejection 30924, 2026-06)

Carriers rejected the campaign because the opt-in page advertised marketing texts while the
campaign is registered as ACCOUNT_NOTIFICATION (use-case mismatch). **Fix applied 2026-06:** removed
the marketing opt-in checkbox and all promotional wording from the opt-in page, the contact form,
and the linked Terms — the opt-in now describes account-notification messaging only, matching the
use case. Edit the SAME campaign and resubmit (no new vetting fee).

- Campaign SID: `CM4b91fa0cc1e0bddfc3a996b149523aaa`
- Brand Registration SID: `BN7046a7e6c7d020bb937352c5924a3a81`
- Messaging Service SID: `MGb0d95f3b71813ddbaf470e316d8bbef2`
- Use case: `ACCOUNT_NOTIFICATION`

---

## Public URLs for registration (Section 12)

| Item | URL |
|------|-----|
| SMS opt-in page | https://www.curbelofinancialcoaching.com/sms-signup/ |
| Contact form (also collects phone + consent) | https://www.curbelofinancialcoaching.com/contact/ |
| Privacy Policy | https://www.curbelofinancialcoaching.com/privacy-policy/ |
| Terms & Conditions | https://www.curbelofinancialcoaching.com/terms-and-conditions/ |

All pages are public (no login), served over HTTPS, and linked from the footer of every page.

**Screenshots to attach** (capture from the live opt-in page): full opt-in form; the consent
checkbox shown unchecked by default; the Privacy Policy + Terms links visible in/near the form.

---

## Twilio message-flow / opt-in description (Section 13 — paste into registration)

End users opt in by visiting https://www.curbelofinancialcoaching.com/sms-signup/ (or the contact
form at https://www.curbelofinancialcoaching.com/contact/), entering their mobile phone number, and
voluntarily checking an unchecked consent box agreeing to receive appointment reminders, account
notifications, service updates, and customer service messages from Curbelo Financial Coaching. The
consent disclosure shown at the checkbox states the message types, that message frequency varies,
that message and data rates may apply, and that users can reply STOP to unsubscribe or HELP for
assistance. SMS consent is optional and is not required to submit the form or to purchase any product
or service. This program does not send promotional or marketing text messages. Terms and Conditions:
https://www.curbelofinancialcoaching.com/terms-and-conditions/. Privacy Policy:
https://www.curbelofinancialcoaching.com/privacy-policy/. The Privacy Policy states that mobile phone
numbers and messaging consent information are not shared with third parties or affiliates for
marketing or promotional purposes.

**Exact consent-checkbox language (as shown to the consumer):**
> I agree to receive appointment reminders, account notifications, service updates, and customer
> service text messages from Curbelo Financial Coaching at the phone number provided. Message
> frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.
> View our Terms and Conditions and Privacy Policy.

---

## Sample messages (Sections 10, 12)

**Opt-in confirmation:**
> Curbelo Financial Coaching: You're subscribed to appointment reminders & account updates. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to unsubscribe.

**Sample appointment reminder:**
> Curbelo Financial Coaching: Reminder — your free coaching call is tomorrow at 2:00 PM ET. Reply HELP for help, STOP to unsubscribe.

**Sample account/service notification:**
> Curbelo Financial Coaching: Your session notes and budget worksheet are ready. Reply HELP for help, STOP to unsubscribe.

**HELP reply:**
> Curbelo Financial Coaching: For assistance, contact us at info@curbelofinancialcoaching.com or (727) 316-5747. Reply STOP to unsubscribe.

**STOP reply (single final confirmation):**
> Curbelo Financial Coaching: You have been unsubscribed and will receive no further text messages. Reply START to subscribe again.

---

## Proof-of-consent record (Section 7) — IMPLEMENTED

Every submission flows to two stores (see `components.js` → `/api/lead` + form-notify):

1. **SuiteDash CRM** via `/api/lead` (`api/lead.js` + `api/_consent.js`)
2. **Google Sheet "Forms Log"** via `myaieditor.com/api/form-notify` (exportable)

Recorded on affirmative consent only (never inferred from a phone number):

| Field | Source |
|-------|--------|
| Phone number | form field `phone` |
| SMS consent status | checkbox `sms_consent_informational` → CRM tag "SMS Consent: Informational" |
| Date & time of consent (UTC) | server timestamp in `/api/lead` |
| Exact disclosure version + full text shown | `sms_consent_version` + canonical text in `api/_consent.js` |
| IP address | `x-forwarded-for` header (server-side) |
| User agent | `user-agent` header (server-side) |
| Form / page URL + form name | `form_location`, `form_name` |
| Source / method | "website form" |

Consent records are exportable from the Forms Log Google Sheet and visible per-contact in SuiteDash.

---

## Sending-side configuration — TODO in Twilio / sending app (Sections 8, 9, 10)

> The website now captures and stores compliant consent. The items below live in the Twilio
> Console and/or whatever application sends the messages. There is **no automated SMS sender
> connected yet** — configure these before sending the first message.

- **STOP / START / HELP (Section 9):** enable Twilio **Advanced Opt-Out** on the Messaging Service
  so STOP immediately suppresses + sends one final confirmation, HELP returns the help text above,
  and START re-subscribes only on intentional opt-in. (Or implement an inbound webhook with the same
  behavior.) Use the confirmation/HELP copy above.
- **Consent enforcement (Section 8):** before sending, the sender must verify (a) an active consent
  record exists, (b) the number hasn't opted out, and (c) the sending brand matches Curbelo Financial
  Coaching. Use the CRM tag / Forms Log as the source of truth. (All messages are account-notification;
  do not send promotional content under this campaign.)
- **Outgoing format (Section 10):** include the brand name in messages; include opt-out instructions in
  the first message and at reasonable intervals (see samples above).

---

## Final QA (Section 14)

- [x] No consent checkbox is checked by default (`sms_consent_informational` renders unchecked)
- [x] SMS consent is optional and forms submit without it (plain `<input type=checkbox>`, not `required`)
- [x] Opt-in describes ACCOUNT_NOTIFICATION messaging only — no marketing/promotional wording anywhere in the opt-in flow or linked Terms (aligns with the registered use case)
- [x] Consent language at the checkbox includes all four required elements: message type, frequency, "message and data rates may apply", and STOP opt-out
- [x] Legal links functional; Privacy Policy + Terms public over HTTPS, linked in every footer
- [x] Business name on site matches the Twilio brand: "Curbelo Financial Coaching"
- [x] Phone number is not added to any SMS audience without an affirmative checkbox
- [x] No placeholder/bracket content remains
- [x] Consent records can be exported (Forms Log Google Sheet)
- [ ] STOP prevents future messages — **enable in Twilio (sending-side, above)**
- [ ] Consent enforcement before send — **implement in sending app (above)**
