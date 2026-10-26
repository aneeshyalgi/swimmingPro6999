"""The right of withdrawal at checkout (Terms, "Your right of withdrawal").

Before paying, a buyer ticks a box asking for what they buy to start straight away and, if they live in the EU (only
consumers there have a right of withdrawal under the Terms), before their 14-day withdrawal period ends
(components/legal/start-now-consent.tsx). With a training plan they also confirm that their right of
withdrawal ends once the plan is unlocked (§ 356(5) BGB), with tokens once they're added (§ 356(5) BGB), and with a
coach switch once the switch is complete (§ 356(4) BGB); a subscription that starts at once costs, if they withdraw,
what it provided until then (§ 357a(2) BGB).

The checkout keeps that request in Stripe, beside the payment, as evidence: the date of the wording they ticked and when.
A checkout without it (sent by a page from before the box) records nothing, and its buyer keeps the full right of
withdrawal. Purchases made before the box existed are left as they are: nobody is recorded as agreeing to a box they
never saw.
"""
from __future__ import annotations

from datetime import datetime, timezone

# The date of the boxes' wording (components/legal/start-now-consent.tsx): change it whenever the wording changes.
START_NOW_VERSION = "2026-10-26"


def start_now_metadata(start_now: bool) -> dict[str, str]:
    """Stripe metadata for a checkout whose buyer ticked the box (the wording's date, and when), or {} for one who didn't."""
    if not start_now:
        return {}
    return {"start_now": START_NOW_VERSION, "start_now_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
