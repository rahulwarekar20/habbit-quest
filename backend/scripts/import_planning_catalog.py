"""Optional owner administration for explicitly named source goals.

    python scripts/import_planning_catalog.py --goal-id hqg-...          # preview
    python scripts/import_planning_catalog.py --goal-id hqg-... --apply  # selected goals only

Normal operation materializes only goals selected by a reviewed Coach response.
This CLI has no all-catalog mode. DATABASE_URL must be an owner URL.
"""

import argparse
import json

import psycopg
from psycopg.rows import dict_row

from habitquest_backend.catalog_import import import_catalog
from habitquest_backend.config import Settings
from habitquest_backend.planning_catalog import CatalogRepository


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--goal-id",
        action="append",
        required=True,
        help="Explicit canonical goal ID; repeat for a small selected set",
    )
    parser.add_argument("--apply", action="store_true", help="Insert missing source goals; never overwrite")
    args = parser.parse_args()
    settings = Settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row, connect_timeout=3) as conn:
        print(
            json.dumps(
                {
                    "applied": args.apply,
                    **import_catalog(conn, CatalogRepository(), goal_ids=args.goal_id, apply=args.apply),
                }
            )
        )


if __name__ == "__main__":
    main()
