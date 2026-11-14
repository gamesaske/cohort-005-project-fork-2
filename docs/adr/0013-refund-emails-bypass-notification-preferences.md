# Refund-decision emails bypass notification preferences and Mute

Refund approved and Refund declined emails are **Transactional Notifications**: they always send to the buyer regardless of per-type toggles or the account-wide "Mute all email" switch, because they confirm money moving and a recipient who missed one would not learn their money had (or had not) come back. Every other notification email is user-tunable, and in-app delivery is always on for all types, so Mute only ever silences the email channel.

## Considered Options

- **Let Mute silence everything, including refund emails.** The literal reading of "Mute all email", and what the user first asked for. Rejected: it lets a buyer opt out of the one email that records a financial outcome they are waiting on, turning a muted inbox into a silent failure.
- **Give refund emails their own toggle, default-on.** Rejected: a default-on toggle a user can switch off has the same failure mode as Mute, for a class of message where opting out has no legitimate use.

## Consequences

"Mute all email" does not literally mean all email — a muted buyer still receives refund-decision emails. The settings UI must make this exemption visible so the gap is deliberate, not a surprise. If a future notification type is financial/legal in the same way, it joins the Transactional tier rather than getting a toggle.
