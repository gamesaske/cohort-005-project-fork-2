# Email delivery provider for Cadence

**Status:** Research (resolves issue #3). No existing `docs/research/` convention existed; this is the first note placed here, alongside `docs/agents/`.

**Date:** 2026-11-13

## Question

Which third-party email delivery service best fits Cadence? Candidates: Resend, Postmark, SendGrid, AWS SES. Evaluated against: fit with the React Router / Node / SQLite stack, developer experience and SDK quality, pricing at low volume, deliverability reputation, and templating support.

## Cadence stack context

From `package.json`: ESM project (`"type": "module"`), React 19, React Router 8.3, TypeScript 5.9, `better-sqlite3`. There is no managed cloud infrastructure implied by the stack, and no email dependency is installed yet. Email is sent over an HTTPS API from a React Router `action`/`loader`, so any of the candidates is technically compatible — the differences are in SDK ergonomics, templating, low-volume pricing, and deliverability.

Relevant consequence of the stack: React 19 + TypeScript makes a React-component-based email templating story (render emails as React components) a natural fit, which is directly relevant below.

## Candidate findings (primary sources)

### Resend

- **Node SDK:** package `resend`. Send via `resend.emails.send({ from, to, subject, html | text | react })`, returns `{ data, error }`. First-class TypeScript types. Source: https://resend.com/docs/send-with-nodejs
- **Templating:** Native React templating via the `react` parameter — pass a React Email component (called as a function, e.g. `WelcomeEmail({ name })`, not JSX). React Email (https://react.email) is the open-source templating library maintained by the Resend team. Source: https://resend.com/docs/send-with-nodejs
- **Pricing (low volume):** Free tier = 3,000 emails/month, 100 emails/day, 3 domains, 30-day data retention. First paid tier (Pro) = $20/mo for 50,000 emails, 10 domains. Source: https://resend.com/pricing

### Postmark

- **Node SDK:** package `postmark`. `sendEmail` for ad-hoc; docs steer production transactional mail to `sendEmailWithTemplate` with a `TemplateAlias` and typed `TemplateModel`. ESM + TypeScript (`import { ServerClient } from "postmark"`). Source: https://postmarkapp.com/developer/integration/official-libraries
- **Templating:** Server-side hosted templates referenced by alias; application passes a typed data object. Keeps template HTML out of the codebase. Source: same as above.
- **Pricing (low volume):** Free Developer plan = 100 emails/month, no expiration (testing/evaluation only). First real paid plan (Basic) = $15/mo for 10,000 emails, $1.80 per additional 1,000; unused emails do not roll over. Source: https://postmarkapp.com/pricing
- **Reputation:** Postmark positions itself specifically around transactional-email deliverability and speed; it only recently allows broadcast/bulk on separate streams. (Positioning per postmarkapp.com; treat as vendor claim.)

### SendGrid (Twilio SendGrid)

- **Node SDK:** package `@sendgrid/mail`. Construct a message object and call `send()`; API key from env. Dynamic Transactional Templates are supported. Quickstart does not state TypeScript types explicitly. Source: https://www.twilio.com/docs/sendgrid/for-developers/sending-email/quickstart-nodejs
- **Templating:** Dynamic Transactional Templates (Handlebars-based, hosted in the SendGrid UI). Source: same quickstart ("Sending Email with Dynamic Transactional Templates").
- **Pricing (low volume):** Free tier = 100 emails/day for 60 days only (not a permanent free tier). First paid tier (Essentials) starts ~$19.95/mo; Pro starts ~$89.95/mo. Source: https://www.twilio.com/en-us/products/email-api/pricing
- **Note:** The domain redirects (sendgrid.com → twilio.com/sendgrid); product is now under Twilio, heavier marketing/console surface.

### AWS SES

- **SDK:** AWS SDK for JavaScript v3 (`@aws-sdk/client-ses` / `client-sesv2`), modular and typed. (Standard AWS SDK; not separately fetched here.)
- **Templating:** SES supports basic templates (name + subject/HTML/text with `{{variables}}`) but has no rich component authoring story; you bring your own renderer.
- **Pricing (low volume):** À la carte $0.10 per 1,000 emails with no mandatory monthly fee; Essentials plan $0.16 per 1,000 (0–10M/mo). New AWS customers get up to $200 in Free Tier credits for 6 months (the old "62,000 free from EC2" model is gone). Attachments billed at $0.12/GB. Source: https://aws.amazon.com/ses/pricing/
- **Note:** Cheapest at any real volume, but requires AWS account, IAM, domain/DKIM setup, and sandbox-exit request before production sending. Most operational overhead of the four.

## Comparison at Cadence's expected (low) volume

| Provider | Permanent free tier | First paid tier | Native React/TS templating | Setup overhead |
| --- | --- | --- | --- | --- |
| **Resend** | 3,000/mo (100/day) | $20/mo → 50k | Yes — React Email, same team | Lowest |
| **Postmark** | 100/mo (eval only) | $15/mo → 10k | No (hosted templates, typed model) | Low |
| **SendGrid** | 60-day trial only | ~$19.95/mo | No (Handlebars dynamic templates) | Medium |
| **AWS SES** | $200 credits / 6mo | $0.10–0.16 /1k | No (bring your own) | High |

## Recommendation

**Use Resend.**

Rationale:

- **Best stack fit.** Cadence is React 19 + TypeScript. Resend sends React Email components directly via the `react` parameter, so transactional emails are authored as typed React components in-repo — no separate template language or hosted-template UI. React Email is maintained by the same team, so the templating and delivery paths are designed together.
- **Best low-volume economics.** A genuine, permanent free tier of 3,000 emails/month (100/day) covers an early-stage course platform with no spend. Postmark's free tier is only 100/month (evaluation); SendGrid's free tier expires after 60 days.
- **Cleanest DX.** `{ data, error }` return shape and first-class types match how the rest of the app is written; minimal setup versus AWS SES's IAM/sandbox/DKIM process.

### Trade-offs and when to reconsider

- **Resend is the youngest provider** with the shortest deliverability track record. If Cadence later sends high-value or high-volume transactional mail and sees deliverability issues, **Postmark** is the strongest alternative — it is purpose-built for transactional deliverability, has typed hosted templates, and a $15/mo entry plan. The cost of switching is low because both are HTTPS APIs behind a thin send function.
- **Choose AWS SES only if** cost at scale dominates (it is ~10x cheaper per email than Resend's Pro tier) and the team accepts the AWS setup/operational overhead and building its own templating. Not worth it at Cadence's current volume.
- **SendGrid** is not recommended for Cadence: no permanent free tier, higher entry price than Postmark, Handlebars/hosted templates rather than React components, and a heavier Twilio console — it brings no advantage for this stack.

### Suggested implementation shape (for a later decision/ticket)

- Add the `resend` package and `react-email` for component templates.
- Wrap sending in a single server-only module (e.g. `app/lib/email.server.ts`) that exposes a typed `sendEmail` so the provider can be swapped without touching callers.
- Keep the API key in an env var; render React Email components server-side inside the sending module.

## Sources

- Resend pricing — https://resend.com/pricing
- Resend Node.js / React Email docs — https://resend.com/docs/send-with-nodejs
- React Email — https://react.email
- Postmark pricing — https://postmarkapp.com/pricing
- Postmark official libraries — https://postmarkapp.com/developer/integration/official-libraries
- SendGrid Email API pricing — https://www.twilio.com/en-us/products/email-api/pricing
- SendGrid Node.js quickstart — https://www.twilio.com/docs/sendgrid/for-developers/sending-email/quickstart-nodejs
- AWS SES pricing — https://aws.amazon.com/ses/pricing/
