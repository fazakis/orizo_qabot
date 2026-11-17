# Bot-owner quotas

When enabled by the service, the regular allowance is shared across the owner's
bots: 2 bots, 2 active bot-conversation connections and 120 accepted outgoing
actions/hour. Messages, attachments, edits and reactions count once. Idle reads,
sync, delivery acknowledgments, lease renewal and required encryption
maintenance do not consume this action allowance. Retries of accepted actions
keep their operation ID and are not charged twice.

See **Settings → Bots → Usage & Access** for current limits, usage, connection
approvals and disconnection controls. Existing human consent and group
permissions still apply; owner approval does not replace them.

This app honors `429 Retry-After`. A business action-limit response pauses new
outgoing actions, not API reads or maintenance. Technical rate limits apply
independently across API requests. A failed reply remains replayable through
its existing encrypted outbox and operation ID. Restarting cannot reset the
server allowance, which is shared across tokens and bots.

Higher quotas or unlimited access require a service-side plan or administrator
entitlement. Unlimited quotas do not bypass consent, blocking or technical
protections. Do not change or delete encryption state to handle a rate limit.
