# Is Web Push worth it for web-only Cadence?

Research findings for GitHub issue #4 (`wayfinder:research`).
Feeds a later push-decision ticket.

**Date:** 2026-11-13
**Scope:** Cadence is a web app with no mobile app, so "push" = **Web Push**:
service-worker browser notifications delivered via the W3C Push API, not native
mobile push.

---

## TL;DR recommendation: **DEFER** (do not build for first release; do not drop)

Web Push is technically feasible for a web-only product and **cheap to run** — it
needs only a VAPID key pair and an open-source server library, with **no paid
provider required**. Desktop and Android reach is excellent. The catch is **iOS**:
Web Push works there only when the user has manually added Cadence to their Home
Screen as a PWA, which is a real adoption gate for a course platform most users
will open in a normal browser tab.

Because the delivery infrastructure is low-cost and standards-based, the blocker
is **not** cost — it is whether we have a notification use case strong enough to
justify a permission prompt, and whether iOS reach matters to our audience. Those
are product questions, not feasibility questions. Build the groundwork knowledge
now (this doc), but defer shipping Web Push until there is a concrete, valuable
trigger (e.g. streak/cadence reminders) and a decision on whether to nudge iOS
users to install the PWA.

---

## 1. What Web Push actually is

The **Push API** lets a server push messages to a browser even when the site is
not focused or open. It is built on three pieces that must all work together:

1. A registered, active **service worker** that handles incoming push events.
2. A **push subscription** created via `PushManager.subscribe()`, which returns a
   `PushSubscription` containing a unique endpoint URL plus encryption keys.
3. A third-party **push service** (run by the browser vendor) that stores and
   delivers the message to that endpoint.

The server pushes to the endpoint; the service worker wakes on the `push` event
and calls `ServiceWorkerRegistration.showNotification()`.
Source: [MDN — Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).

Requirements worth noting: HTTPS + a service worker are mandatory, the endpoint
URL must be kept secret (anyone with it can push to the user), and apps must
guard against CSRF when subscribing.
Source: [MDN — Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).

---

## 2. Browser / platform support

Per [caniuse — Push API](https://caniuse.com/push-api), global support is
~**96.9%** (83.36% full + 13.57% partial — the "partial" bucket is essentially
iOS, see below).

**Full, frictionless support (desktop + Android):**

- Chrome 50+ (desktop & Android)
- Firefox 44+ (desktop & Android)
- Edge 17+
- Opera 42+ (desktop), Opera Mobile
- Samsung Internet, UC Browser for Android

Source: [caniuse — Push API](https://caniuse.com/push-api).

**Safari / Apple (the asterisk):**

- macOS Safari: partial from 16.1, full from 18.0.
- iOS/iPadOS Safari: **partial only**, and gated on PWA install (see §3).

Source: [caniuse — Push API](https://caniuse.com/push-api).

**No support:** Internet Explorer, Opera Mini.

For a web-only product, the practical read: desktop (all major browsers) and
Android browsers are a non-issue. iOS is the one platform with a structural
limitation.

---

## 3. The iOS / Safari limitation (the decisive constraint)

Apple added Web Push with **iOS/iPadOS 16.4** (Feb 2023), but **only for web apps
added to the Home Screen** — i.e. installed PWAs. It does **not** work for sites
open in ordinary Safari tabs.

Key facts from Apple/WebKit:

- "Now with iOS and iPadOS 16.4, we are adding support for Web Push to **Home
  Screen web apps**." Web Push is exclusively for installed PWAs, not Safari tabs.
- The permission request must be triggered by **direct user interaction** (e.g.
  tapping a "subscribe" button); iOS then shows the native permission prompt.
- It uses the **same standards-based Web Push** (Push API + Notifications API +
  Service Workers) as other browsers, so app code is portable.
- Delivery on Apple devices rides the **Apple Push Notification service (APNs)**;
  servers must allow endpoints under `*.push.apple.com`.
- **No Apple Developer Program membership required.**

Source: [WebKit — Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

**Why this matters for Cadence:** a course platform is overwhelmingly opened in a
browser tab (desktop or mobile). Reaching iOS users with push requires them to
first "Add to Home Screen" and launch Cadence from that icon — an extra, manual,
unprompted step most users will never take. So effective iOS push reach is far
below the raw ~96.9% figure; treat iOS push as "available only to the subset of
power users who install the PWA."

---

## 4. Infrastructure: what actually delivers a push

The delivery stack is fully standardised and does **not** require a commercial
push provider.

**Web Push protocol (RFC 8030).** Three roles: the **user agent** (browser)
subscribes with a **push service** and hands the resulting push URI to the
**application server**; the application server POSTs messages to that URI; the
push service stores them (per a TTL header) and delivers them to the browser.
Source: [RFC 8030](https://datatracker.ietf.org/doc/html/rfc8030).

**VAPID (RFC 8292).** The application server identifies itself to the push
service with a signed JWT. We generate one **ECDSA P-256 key pair** (ES256); the
public key goes to the browser at subscribe time (`applicationServerKey`), and
each push request carries a JWT signed with the private key (claims: `aud` = push
service origin, `exp` ≤ 24h, optional `sub` contact). This ties subscriptions to
our server and gives push-service operators a contact. VAPID needs no account or
fee — it is just a key pair we create and store once.
Source: [RFC 8292](https://datatracker.ietf.org/doc/html/rfc8292).

**Push services are vendor-run and free to us.** Chrome uses FCM endpoints,
Firefox uses Mozilla's autopush, Apple uses APNs, Edge uses WNS. We never contract
with them directly — the browser picks the endpoint; our server just POSTs to the
URL it returns.

**Provider vs self-hosted.** We do **not** need a paid provider (OneSignal,
Pusher Beams, etc.). A Node server can send directly with the open-source
[`web-push`](https://github.com/web-push-libs/web-push) library, which implements
RFC 8030 + message encryption + VAPID, supports FCM/Mozilla/Apple, and ships a
`generateVAPIDKeys()` helper. Cadence's stack (React Router / TypeScript / Node /
SQLite) can adopt it directly: store the VAPID key pair in config, persist each
`PushSubscription` in SQLite/Drizzle, and POST messages server-side.
Source: [web-push library](https://github.com/web-push-libs/web-push).

**Cost summary:** engineering cost only (service worker + subscription UI +
subscription storage + a send path). No per-message or provider fees at our scale.
A provider becomes worth considering only for analytics, segmentation, or
large-scale fan-out — none of which a first release needs.

---

## 5. Does the reach justify the cost for a web-only audience?

- **Cost is low**, not high: standards-based, self-hostable, no provider fees.
  This reframes the ticket's premise — the question isn't "is the infra too
  expensive," it's "is there a use case worth the user-trust spend of a permission
  prompt."
- **Desktop + Android reach is strong.** Those users get push with no friction.
- **iOS reach is weak in practice** because of the Home-Screen-install gate.
- **Permission is a scarce, one-shot resource.** MDN cites that ~60% of push
  permission prompts are blocked, and prompts should only appear on real user
  interaction with a clear value proposition; Safari 12.1+/Firefox 68+ already
  require a user gesture.
  Source: [MDN — Push API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Push_API/Best_Practices).
  A course platform should not burn that prompt until it has a genuinely useful,
  time-sensitive trigger.

**Conclusion:** feasibility and cost are not blockers. The deciding factors are
(a) whether we have a notification worth sending and (b) how much we care about
iOS. Neither is settled, so **defer** rather than commit for first release — and
do not drop, because adding it later is cheap and the knowledge is captured here.

---

## 6. What the push-decision ticket should decide next

1. Is there a concrete first notification use case (e.g. streak/cadence reminders,
   new lesson available)? No use case → keep deferring.
2. Do we care about iOS push? If yes, plan an "Add to Home Screen" nudge; if no,
   scope push as desktop + Android only and set expectations accordingly.
3. When built: use the `web-push` library + a stored VAPID key pair; persist
   subscriptions in SQLite/Drizzle; gate the permission prompt behind a clear,
   user-initiated opt-in.

---

## Sources (primary)

- [MDN — Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [MDN — Push API Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Push_API/Best_Practices)
- [WebKit — Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [caniuse — Push API](https://caniuse.com/push-api)
- [RFC 8030 — Generic Event Delivery Using HTTP Push (Web Push protocol)](https://datatracker.ietf.org/doc/html/rfc8030)
- [RFC 8292 — Voluntary Application Server Identification (VAPID) for Web Push](https://datatracker.ietf.org/doc/html/rfc8292)
- [web-push server library](https://github.com/web-push-libs/web-push)
