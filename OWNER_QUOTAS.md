# Bot-owner quotas

When enabled by the service, the regular allowance is shared across the owner's
bots: 2 bots, 2 active bot-conversation connections and 120 bot API requests/hour.
Requests include polling, lease renewal and identity setup, not only sends.
See **My Bots → Usage & Access** for current limits, usage, connection approvals
and disconnection controls. Existing human consent and group permissions still
apply; owner approval does not replace them.

This app honors `429 Retry-After` for every bot API call. During the cooldown it
does not repeat network requests, replay a failed message or reset encryption
state. It resumes through the existing lease and outbox logic. Restarting the
app cannot reset the server allowance, which is shared across tokens and bots.

The 120/hour allowance is for low-frequency use; unchanged polling and startup
can exhaust it. Higher quotas or unlimited access require a service-side plan
or administrator entitlement. Unlimited plan quotas do not bypass consent,
blocking or infrastructure protections. No live deployment is part of this PR.
