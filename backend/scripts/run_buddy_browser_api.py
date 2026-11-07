"""Run buddy browser QA against one disposable database and synthetic fake-AI settings."""

import argparse
import os
import runpy
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

import psycopg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
DATABASE = "habitquest_buddies_backend_test"
ACCESSORIES = ["party-hat", "crown", "shades", "bow", "wizard", "flower", "headphones", "halo"]


def disposable_url() -> str:
    """Read only the private test DSN and pin its database to this QA run's target."""
    source = os.environ.get("TEST_DATABASE_URL") or dotenv_values(ROOT / ".env").get("TEST_DATABASE_URL")
    if not source:
        raise RuntimeError("A private TEST_DATABASE_URL is required")
    parsed = urlsplit(source)
    return urlunsplit(parsed._replace(path="/" + DATABASE))


def main() -> None:
    """Seed the isolated database, equip synthetic fixtures, or serve the fake-AI API."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--equip-child", type=UUID)
    args = parser.parse_args()
    url = disposable_url()
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT current_database()").fetchone()[0] == DATABASE
        if args.equip_child:
            row = conn.execute("SELECT name FROM hq.children WHERE id=%s", (args.equip_child,)).fetchone()
            if not row or not row[0].startswith("Browser "):
                raise RuntimeError("Only a synthetic Browser child may receive this fixture")
            conn.execute(
                "INSERT INTO hq.child_extras(child_id,accessories,wearing) VALUES(%s,%s,'crown') "
                "ON CONFLICT(child_id) DO UPDATE SET accessories=excluded.accessories,wearing='crown'",
                (args.equip_child, ACCESSORIES),
            )
            print("Equipped the synthetic child in the disposable buddy browser database.")
            return
    os.environ["DATABASE_URL"] = url
    runpy.run_path(str(ROOT / "scripts/setup_db.py"), run_name="__main__")
    # A blank working directory prevents the module-level app from loading a developer dotenv.
    with tempfile.TemporaryDirectory(prefix="habitquest-buddy-browser-") as directory:
        os.chdir(directory)
        for name in list(os.environ):
            if name.startswith(("OPENAI_", "PLANNING_", "PINECONE_", "LANGSMITH_")):
                os.environ.pop(name, None)
        os.environ.update(
            AI_MODE="fake",
            RETRIEVAL_MODE="disabled",
            COACH_ENGINE="agent",
            COACH_PROVIDER="legacy",
            HABIT_GENERATION_ENABLED="false",
            TRACE_COACH="false",
            ADMIN_ENABLED="false",
            DEV_LOGIN="true",
            DEV_LOGIN_PASSWORD="synthetic-buddy-browser-password",
            JWT_SECRET="synthetic-buddy-browser-signing-key-only",
            JWT_ISSUER="http://127.0.0.1:8002",
            CORS_ORIGINS="http://localhost:5182",
            BUDDY_CATALOG_ENABLED="true",
        )
        import uvicorn

        from habitquest_backend.main import app

        print("Serving fake-AI buddy QA on port 8002 against the disposable _test database.")
        uvicorn.run(app, host="127.0.0.1", port=8002, access_log=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit(f"Disposable buddy browser setup failed ({type(exc).__name__}).") from None
