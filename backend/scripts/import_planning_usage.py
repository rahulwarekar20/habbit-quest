"""Initialize the main app's development budget from the prototype's persisted ledger.

Run once with an owner DATABASE_URL and --ledger /path/to/reports/live-usage.json.
An initialized main ledger is never reset or overwritten. No provider calls occur.
"""

import argparse
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path

import psycopg

from habitquest_backend.config import Settings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, required=True)
    args = parser.parse_args()
    entries = json.loads(args.ledger.read_text())["entries"]
    if not isinstance(entries, list):
        raise SystemExit("The source ledger must contain an entries list")
    spent = Decimal(0)
    for entry in entries:
        raw = entry.get("accounted_usd")
        try:
            if type(raw) not in (int, float):
                raise ValueError()
            amount = Decimal(str(raw))
            if not amount.is_finite() or amount < 0:
                raise ValueError()
        except (ValueError, InvalidOperation):
            raise SystemExit("Invalid accounted usage in the source ledger") from None
        spent += amount
    settings = Settings()
    with psycopg.connect(settings.database_url, connect_timeout=3) as conn:
        state = conn.execute(
            "SELECT initialized,accounted_usd FROM hq.planning_budget WHERE singleton FOR UPDATE"
        ).fetchone()
        if state is None:
            raise SystemExit("Apply the planning migrations first")
        if state[0]:
            print(json.dumps({"already_initialized": True, "accounted_usd": str(state[1]), "changed": False}))
            return
        # Preserve any conservatively reserved amount even in an unexpected uninitialized state.
        carried = max(spent, state[1])
        conn.execute(
            "UPDATE hq.planning_budget SET initialized=true,accounted_usd=%s WHERE singleton", (carried,)
        )
    print(json.dumps({"initialized": True, "source_entries": len(entries), "accounted_usd": str(carried)}))


if __name__ == "__main__":
    main()
