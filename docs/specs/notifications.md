# Notifications in Cadence — implementation spec

> **Status:** ready to hand off to the implementation effort.
> **Source:** this spec assembles the decisions charted on the wayfinding map
> [Notifications in Cadence](https://github.com/gamesaske/cohort-005-project-fork-2/issues/1).
> Each section links the ticket that decided it; the ticket holds the full
> reasoning and rejected alternatives. This document is the single hand-off
> artifact — read it top to bottom, then open the linked ADRs and prototype
> branches for detail.

Cadence ships notifications on two channels for the first release: an **in-app
feed** (our own infrastructure, on Cadence's SQLite) and **email** (via Resend).
Push is deferred. Six notification types fire from existing domain events, each
to exactly one recipient. In-app delivery is always on; email is tunable per
type, per course, and account-wide, with a non-suppressible transactional tier.

---

## 1. Scope

**In scope for the first release:** six transactional notification types; the
in-app feed + bell; email via Resend; the per-type / per-course / account-wide
email preference model; the preferences settings surface; the data model and
fan-out dispatcher.

**Out of scope** (carried forward — do not build these):

- **Native mobile push** — Cadence has no mobile app (map-level out of scope).
- **Web Push** — deferred, not dropped; see §4.3 for the reopen trigger.
- **Email retry / durable job queue** — failures are logged, not retried
  ([ADR-0014](../adr/0014-in-app-notifications-are-canonical-email-is-best-effort.md)).
- **Resend provider message-id capture** — not stored.
- **Distinguishing _suppressed_ from _failed_** in `emailSentAt` — a null value
  conflates "muted/preference-off" with "send failed".
- **Multi-recipient fan-out** — the dispatcher's shape allows it, but every
  first-release type is 1:1.

---

## 2. The six notification types

Decided in [Which Cadence events notify whom](https://github.com/gamesaske/cohort-005-project-fork-2/issues/2).

| # | Enum | Event | Recipient | Course-scoped |
|---|------|-------|-----------|:-:|
| 1 | `RefundRequested` | Refund Request opened | the Platform Admin | no |
| 2 | `RefundApproved` | Refund Request approved | the buyer (Student or Team Admin) | no |
| 3 | `RefundDeclined` | Refund Request declined | the buyer (Student or Team Admin) | no |
| 4 | `NewEnrollment` | New enrollment (individual purchase, team licence, or seat claimed) | the course's Instructor | yes |
| 5 | `QuestionPosted` | Question posted (Student's top-level lesson comment) | the course's Instructor | yes |
| 6 | `QuestionAnswered` | Question answered (staff reply) | the asking Student | yes |

**Inclusion test** (for anyone proposing a seventh type later): an event earns a
notification only if it is _actionable_ (the recipient must do something) or
_materially consequential_ (money moved, access gained/lost, a decision landed
on them). Plus two rules:

- **No self-notification** for your own immediate action — the UI already
  confirms it. Notify only on the later, out-of-band outcome (so opening a
  Refund Request notifies the Admin, not the buyer; the buyer is notified when
  it is decided).
- **One notification = one recipient.** One event may spawn several
  notifications; consequences fold into the recipient's single notification
  (e.g. "enrollment ended / seats voided" folds into the buyer's Refund-approved
  notification, not a separate one).

> **Terminology:** the original "new quiz question for an Instructor" idea is the
> **student-question** feature — a Student's top-level lesson comment awaiting a
> staff reply, surfaced as an "Unanswered Question". It is **not** a quiz
> question. See the `Questions` cluster in `GLOSSARY.md`.

---

## 3. Channels

- **In-app feed — ours to build.** Canonical, always-on, never suppressible.
  Stored in Cadence's SQLite. The bell is the authoritative record of what a
  user was told.
- **Email — via Resend.** The only tunable channel. Best-effort; may silently
  not arrive. See §7 for copy, §8 for delivery.
- **Push — deferred.** Not built, not dropped. See §4.3.

### 3.1 Email provider: Resend

Decided in [Pick an email delivery provider for Cadence](https://github.com/gamesaske/cohort-005-project-fork-2/issues/3).
Full research with citations: `docs/research/email-delivery-provider.md` (branch
`research/email-delivery-provider`, not merged).

- **Why Resend:** React 19 / TS fit — transactional emails are authored as typed
  React Email components in-repo via the SDK's `react` param (no separate
  template language); best low-volume economics (permanent 3,000/mo free tier);
  clean `{ data, error }` DX.
- **Fallbacks, if ever needed:** Postmark if deliverability becomes critical; AWS
  SES only if cost-at-scale dominates. SendGrid not recommended.
- **Implementation:** wrap sending behind one swappable server-only module,
  `app/lib/email.server.ts`, exposing a typed `sendEmail`, so the provider stays
  replaceable.

### 3.2 Push: deferred

Decided in [Decide whether Cadence sends push notifications](https://github.com/gamesaske/cohort-005-project-fork-2/issues/5).

None of the six transactional first-release types justify spending a browser
permission prompt (~60% of prompts are blocked). Channel routing (§4) considers
only in-app + email.

**Reopen trigger:** the first _time-sensitive re-engagement_ notification — a
streak / cadence reminder ("your daily lesson is waiting"). That is the first
type in-app + email genuinely underserve.

**iOS constraint (recorded so it isn't re-derived):** iOS/iPadOS delivers Web
Push (16.4+) only to Home-Screen-installed PWAs, **not** Safari tabs. Cadence is
opened mostly in a tab, so effective iOS reach is low. Feasibility is not the
blocker — self-hostable via one VAPID key pair + the `web-push` lib, no provider
fees at our scale.

---

## 4. Routing & preferences

Decided in [Route notification types to channels and define preferences](https://github.com/gamesaske/cohort-005-project-fork-2/issues/6).

### 4.1 Default channel routing

| # | Notification | In-app | Email default |
|---|--------------|:------:|:-------------:|
| 1 | Refund Request opened → Admin | always | **on** |
| 2 | Refund approved → buyer | always | **on** (transactional) |
| 3 | Refund declined → buyer | always | **on** (transactional) |
| 4 | New enrollment → Instructor | always | **off** (opt-in) |
| 5 | Question posted → Instructor | always | **on** |
| 6 | Question answered → Student | always | **on** |

### 4.2 Transactional tier (non-suppressible)

Refund **approved** (#2) and **declined** (#3) emails are **Transactional
Notifications**: they always send, have no toggle, and are exempt from Mute —
like a receipt confirming money moved.
See [ADR-0013](../adr/0013-refund-emails-bypass-notification-preferences.md).

### 4.3 Preference model

- **Per-type email toggle**, per user, stored as an **override on the type
  default** (absence = use the default). A user who changes nothing stores
  nothing.
- Toggles are **filtered to the role's receivable types** (`recipientRoles` in
  §6). Transactional types have no toggle.
- **Per-course override layer** for course-scoped types (#4, #5, #6): a user may
  override the global per-type setting on a specific course.
- **"Mute all email"** — one account-level switch suppressing all _tunable_
  notification email. Email channel only; the in-app feed is untouched.
  Transactional refund emails are exempt and still send.

### 4.4 Resolution order (effective email for a user / type / course)

```
1. transactional?        → always send (ignores Mute + all preferences)
2. user.emailMuted?      → suppress
3. per-course override set for (type, courseId)?   → use it
4. global override set for (type, courseId = null)? → use it
5. else                  → NOTIFICATION_TYPE_META[type].emailDefault
```

---

## 5. In-app feed UI

Decided in [Prototype the in-app notification feed UI](https://github.com/gamesaske/cohort-005-project-fork-2/issues/7).
Chosen direction: **Variant A — dropdown-first glance list** (validated against a
rejected two-pane triage inbox and rejected grouped activity-stream cards).

Prototype (throwaway, three variants via `?variant=A|B|C` at
`/prototype/notifications`): branch
[`prototype/notifications-feed`](https://github.com/gamesaske/cohort-005-project-fork-2/tree/prototype/notifications-feed)
(not merged).

- **Entry point:** a **bell + unread-count badge** in the app chrome. Clicking
  opens a **dropdown feed panel**, the primary surface.
- **Dropdown feed:** items grouped **Today / Earlier**, newest first; a **"Mark
  all read"** header action; a **"View all notifications"** footer link to the
  dedicated page.
- **Per-item row:** type-coloured icon chip + bold one-line title + muted
  one-line detail + relative timestamp. Transactional items carry a **lock
  marker** ("always emailed, exempt from Mute").
- **Read/unread:** unread rows get a subtle background tint **and** a leading
  dot; clicking a row marks it read and decrements the badge.
- **Dedicated page:** single-column reverse-chron list mirroring the dropdown
  row layout, with an **All / Unread** filter and an inline action link per item.
- **Live arrival:** a toast (sonner, already wired in the app shell) fires on
  arrival and prepends an unread item.

**Build-time decision (does not change the design):** the real app shell is a
**left sidebar with no top bar**; the prototype invented a top bar to host the
bell. Decide where the bell lives — add a slim top bar vs. place it in the
sidebar.

---

## 6. Data model & fan-out architecture

Decided in [Decide the notification data model and fan-out architecture](https://github.com/gamesaske/cohort-005-project-fork-2/issues/10).
Recorded as [ADR-0014](../adr/0014-in-app-notifications-are-canonical-email-is-best-effort.md).
Follows existing Drizzle conventions (nullable-timestamp state columns,
integer-boolean mode, code-level enums).

### 6.1 `notifications` table

| column | type | notes |
|--------|------|-------|
| `id` | integer PK autoinc | |
| `recipientUserId` | integer notNull → users | the one recipient |
| `actorUserId` | integer nullable → users | who caused it; nullable for future system notifications |
| `type` | text notNull `$type<NotificationType>()` | one of the six |
| `courseId` | integer nullable → courses | context / deep-link; set for all six, nullable for the future |
| `title` | text notNull | **frozen** at write (immune to later edits/deletes of the source) |
| `detail` | text notNull | frozen at write |
| `actionUrl` | text notNull | deep-link; the sole navigation mechanism |
| `readAt` | text nullable | null = unread (matches `completedAt`/`resolvedAt` pattern) |
| `emailSentAt` | text nullable | set on **successful** send only |
| `createdAt` | text notNull `$defaultFn` | |

Likely index on `(recipientUserId, readAt)` for the feed + unread badge — a
build-time detail.

### 6.2 `notification_preferences` table — sparse overrides

Absence of a row = use the default.

`id`, `userId` notNull → users, `type` text, `courseId` integer nullable →
courses, `emailEnabled` integer boolean. **Unique on `(userId, type, courseId)`.**
`courseId = null` → the global per-type override; `courseId` set → the per-course
override.

### 6.3 `users.emailMuted`

Integer boolean, default `false` — the "Mute all email" switch. One boolean,
one-to-one with the user, so a column, not a settings table.

### 6.4 `NOTIFICATION_TYPE_META` (code-level source of truth)

A single map keyed by the `NotificationType` enum (extends the feed prototype's
`TYPE_META`). The row stores only `type`; transactional-ness and course-scoping
are **type properties derived from here, never columns**.

| Enum | Recipient (resolved at fan-out) | `recipientRoles` (settings filter) | Course-scoped | Email default | Transactional |
|------|---------------------------------|-----------------------------------|:-:|:-:|:-:|
| `RefundRequested` | the Platform Admin | {Admin} | no | on | no |
| `RefundApproved` | the buyer | {Student, Team Admin} | no | on (forced) | yes |
| `RefundDeclined` | the buyer | {Student, Team Admin} | no | on (forced) | yes |
| `NewEnrollment` | the course's Instructor | {Instructor} | yes | off | no |
| `QuestionPosted` | the course's Instructor | {Instructor} | yes | on | no |
| `QuestionAnswered` | the asking Student | {Student} | yes | on | no |

`recipientRoles` is a **set** (used to filter the settings UI) because a refund
buyer is a Student for an individual purchase but a Team Admin for a team
licence. The actual recipient _userId_ is resolved from the triggering event.

### 6.5 Fan-out: `notify()`

A single dispatcher `notify()` in `app/lib/notifications.server.ts`, called from
each of the six domain actions. It:

1. **writes the in-app row inside the domain action's transaction** — always-on
   canonical channel, atomic with the event;
2. **after commit**, calls `resolveEmailDelivery(recipient, type, courseId)` and,
   if it returns true, sends via the `sendEmail` wrapper (§3.1) **best-effort** —
   failures logged at error level, no retry, never fails the user's request —
   stamping `emailSentAt` on success.

`resolveEmailDelivery` applies the §4.4 chain, short-circuiting in order:
transactional → muted → per-course override → global override → type default.

**Idempotency** rides on each source event's own guard (a refund resolves once,
an enrollment row is unique, a Question/answer is a distinct insert) — no
notification-level dedupe key.

### 6.6 Canonical-vs-best-effort guarantee (ADR-0014)

The in-app row is written in-transaction and can never be lost; email is a
post-commit side-effect that never blocks or rolls back the event. An email can
silently not arrive while the in-app notification is present and correct — **the
in-app feed, not the inbox, is the source of truth** for what a user was told.
Transactional emails follow the same best-effort post-commit path: their
guarantee is "always attempted", not "always delivered".

---

## 7. Email content

Decided in [Draft the email content for each notification type](https://github.com/gamesaske/cohort-005-project-fork-2/issues/8).
Copy spec only — React Email components are built in the implementation effort.
Rendered mockups of all six: branch
[`prototype/notification-emails`](https://github.com/gamesaske/cohort-005-project-fork-2/tree/prototype/notification-emails)
(`app/lib/email/notification-emails.prototype.html`, not merged).

Each email = a React Email component with the subject passed to `sendEmail`;
`{{placeholders}}` are interpolated at send.

### 7.1 Refund Request opened → Platform Admin (tunable)
- **Subject:** `Refund request to review — {{courseTitle}}`
- **Voice:** terse, operational. Names the buyer, full amount, quotes the buyer's
  refund reason; notes no other admin has claimed it; one line on what
  approve/decline each do.
- **CTA:** Review the request → `/admin/refunds`

### 7.2 Refund approved → buyer (**Transactional** — always sends)
- **Subject:** `Your refund for {{courseTitle}} is on its way`
- **Voice:** warm, reassuring. Confirms the full `{{amount}}` back to the original
  payment method (may take a few days). States the enrollment has ended but
  progress is kept (ADR-0001).
- **CTA:** Browse your courses → `/courses`
- **Footer:** "sent even if you've muted Cadence emails" (ADR-0013 visibility).

### 7.3 Refund declined → buyer (**Transactional** — always sends)
- **Subject:** `An update on your refund request for {{courseTitle}}`
- **Voice:** respectful, non-defensive. States no money returned, access/progress
  untouched; **quotes the admin's decline reason** (`{{declineReason}}`); points
  to raising a new request.
- **CTA:** Go to {{courseTitle}} → `/courses/:slug`
- **Footer:** Mute-exemption line (ADR-0013).

### 7.4 New enrollment → Instructor (**email default OFF — opt-in**)
- **Subject:** `New student on {{courseTitle}}`
- **Voice:** light, celebratory. Names the student and the running enrollment
  count.
- **CTA:** See your students → `/instructor/:courseId/students`
- **Footer:** "you turned on email for new enrollments" + settings link.

### 7.5 Question posted → Instructor (tunable)
- **Subject:** `New question on {{courseTitle}}`
- **Voice:** prompt-to-act; a student is waiting. Names student + lesson, quotes a
  question excerpt.
- **CTA:** Answer the question → `/instructor/questions`

### 7.6 Question answered → asking Student (tunable)
- **Subject:** `Your question on {{courseTitle}} has an answer`
- **Voice:** helpful, encouraging to continue. Attributes the answer to "the
  course" (the course's voice, per glossary), quotes an answer excerpt.
- **CTA:** Read the full answer → `/courses/:slug/lessons/:lessonId`

### 7.7 Cross-cutting conventions
- Brand wordmark header; single primary CTA button per email; plain-text-friendly
  body; a settings link in every **tunable** email's footer; **Transactional**
  emails instead carry the Mute-exemption line.
- Subjects are course-scoped where a course exists; no notification-type jargon in
  the subject. Amounts shown as concrete figures.

### 7.8 Open build items (non-blocking)
- Approved-refund CTA points at `/courses` since no purchases/receipts view exists
  yet; revisit if one is built.
- Question CTAs could deep-link to the specific question/answer anchor rather than
  the queue/lesson top, once the feed's linking scheme is implemented.

---

## 8. Preferences UI

Decided in [Prototype the notification preferences UI](https://github.com/gamesaske/cohort-005-project-fork-2/issues/9).
Chosen direction: **Variant A — type-first list** (validated against a rejected
types×courses matrix and a rejected course-first accordion).

Prototype (3 variants + role-preview + live resolved-state readout): branch
[`prototype/notification-preferences`](https://github.com/gamesaske/cohort-005-project-fork-2/tree/prototype/notification-preferences),
route `/prototype/notification-preferences?variant=A|B|C&role=instructor|student|admin`
(not merged).

- **Home:** a **Notifications** section within `/settings`. In-app always-on is
  stated, never a toggle — a single "In-app: always on" pill on the card header.
- **Mute-all banner** at the top: one "Mute all email" switch. While on, every
  tunable toggle is disabled/greyed with a note that transactional refund emails
  still send.
- **One card, one row per role-visible type** (role-filtered via
  `recipientRoles`): type-coloured icon + bold label + muted one-line description
  + right-aligned **email toggle**. Icons/tints reuse the feed's `TYPE_META` so
  the two surfaces share a visual language.
- **Transactional types** render a locked **"Always emailed"** pill instead of a
  toggle — no control, Mute-exempt (ADR-0013).
- **Course-scoped types** carry a **"Customize per course"** disclosure (collapsed
  by default; a badge shows the count of courses currently overridden). Expanded,
  it reveals an indented per-course list: each course row has its own toggle,
  labelled **"inherits default (on/off)"** until overridden, with a **reset**
  affordance to drop the override.
- **Resolution order is faithfully reflected:** each toggle shows the
  fully-resolved value (muted → per-course → global → default); Mute visually wins
  over everything tunable.

**Build-time decisions (non-blocking):** exact placement in Settings (dedicated
`/settings/notifications` subpage vs tab vs section); whether to keep an
"effective delivery" readout in production; the overridden-count badge
wording/placement.

---

## 9. References

**ADRs**
- [ADR-0013 — Refund-decision emails bypass notification preferences and Mute](../adr/0013-refund-emails-bypass-notification-preferences.md)
- [ADR-0014 — In-app notifications are canonical; email is a best-effort side-effect](../adr/0014-in-app-notifications-are-canonical-email-is-best-effort.md)

**Glossary terms added during this effort** (`GLOSSARY.md`): `Notification`, the
`Questions` cluster (`Question`, `Unanswered Question`, `Answered Question`),
`Transactional Notification`, `Notification Preference`, `Muted`.

**Prototype branches** (throwaway, not merged, no PR):
- `prototype/notifications-feed` — in-app feed, 3 variants
- `prototype/notification-emails` — all six emails rendered as mockups
- `prototype/notification-preferences` — preferences surface, 3 variants + role preview

**Research** (not merged): `docs/research/email-delivery-provider.md` on branch
`research/email-delivery-provider`.

**Map:** [Notifications in Cadence](https://github.com/gamesaske/cohort-005-project-fork-2/issues/1).
