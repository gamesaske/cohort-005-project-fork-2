# In-app notifications are canonical; email is a best-effort side-effect

When a domain event fires a Notification, the in-app row is written **inside the same transaction** as the event, so it commits atomically with the thing that caused it and can never be lost. Email is sent **after** that commit, best-effort: a send failure is logged and swallowed, never retried, and never rolls back or fails the user's request. In-app is the always-on canonical channel; email is a derived delivery that may or may not happen.

## Considered Options

- **Send email inside the transaction.** Rejected: email can't participate in a database rollback — once Resend accepts the message it's gone — so a post-send rollback would leave an email describing an event that never committed, and a mid-transaction send failure would wrongly fail the user's action.
- **Write the in-app row after commit too (both channels post-commit).** Rejected: the in-app feed is the canonical record and must not be lost if the process dies or email flakes between commit and the follow-up write. Writing it in-transaction is the only way to guarantee it matches the committed event.
- **Queue email for retry.** Rejected for the first release: a durable job queue is infrastructure we don't have and haven't scoped. Failures are logged loudly for diagnosis instead.

## Consequences

An email can silently not arrive (provider outage, suppression) while the in-app notification is present and correct — the in-app feed, not the inbox, is the source of truth for what a user was told. `emailSentAt` on the row records only successful sends, so a null value conflates "suppressed by preference/Mute" with "send failed"; distinguishing the two, and any retry/queue, is future work. Transactional emails (refund approved/declined, per ADR-0013) follow the same best-effort post-commit path — their guarantee is "always attempted", not "always delivered".
