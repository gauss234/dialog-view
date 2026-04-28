#!/usr/bin/env python3
"""Agent Dialog Viewer — FastAPI backend."""

import argparse
import datetime
import decimal
import os
from pathlib import Path

try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib  # type: ignore
    except ImportError:
        tomllib = None  # type: ignore

import psycopg2
import psycopg2.extras
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Agent Dialog Viewer")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ── Config ────────────────────────────────────────────────────

def _load_secrets() -> dict:
    if tomllib is None:
        return {}
    for p in (BASE_DIR / ".streamlit" / "secrets.toml", BASE_DIR / "secrets.toml"):
        if p.exists():
            try:
                with open(p, "rb") as f:
                    return tomllib.load(f).get("db", {})
            except Exception:
                pass
    return {}


def load_defaults() -> dict:
    defaults = {"host": "localhost", "port": 5432, "dbname": "", "user": "", "password": ""}
    for k, v in _load_secrets().items():
        if k in defaults:
            defaults[k] = v
    env_map = {
        "DB_HOST": "host", "DB_PORT": "port",
        "DB_NAME": "dbname", "DB_USER": "user", "DB_PASSWORD": "password",
    }
    for env_key, cfg_key in env_map.items():
        val = os.environ.get(env_key)
        if val:
            defaults[cfg_key] = int(val) if cfg_key == "port" else val
    return defaults


# ── Models & DB ───────────────────────────────────────────────

class DBConfig(BaseModel):
    host: str = "localhost"
    port: int = 5432
    dbname: str
    user: str
    password: str = ""


def _dsn(cfg: DBConfig) -> dict:
    return dict(
        host=cfg.host, port=cfg.port, dbname=cfg.dbname,
        user=cfg.user, password=cfg.password, connect_timeout=10,
        client_encoding="UTF8",
    )


def _row(d: dict) -> dict:
    """Make a psycopg2 row JSON-serializable."""
    out = {}
    for k, v in d.items():
        if isinstance(v, (datetime.datetime, datetime.date)):
            out[k] = v.isoformat()
        elif isinstance(v, decimal.Decimal):
            out[k] = float(v)
        else:
            out[k] = v
    return out


# ── Routes ────────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/api/defaults")
async def api_defaults():
    return load_defaults()


@app.post("/api/db/test")
async def api_db_test(cfg: DBConfig):
    try:
        psycopg2.connect(**_dsn(cfg)).close()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/session/{session_id}")
async def api_session(session_id: str, cfg: DBConfig):
    try:
        conn = psycopg2.connect(**_dsn(cfg))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Connection failed: {exc}")

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM qa_session WHERE session_id = %s LIMIT 1",
                (session_id,),
            )
            session_row = cur.fetchone()
            if session_row is None:
                raise HTTPException(status_code=404, detail=f"No session found for ID: {session_id}")

            cur.execute(
                "SELECT * FROM qa_record WHERE session_id = %s ORDER BY create_time ASC",
                (session_id,),
            )
            records = cur.fetchall()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Query failed: {exc}")
    finally:
        conn.close()

    return {
        "session": _row(dict(session_row)),
        "records": [_row(dict(r)) for r in records],
    }


# ── Entry point ───────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Agent Dialog Viewer")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="Auto-reload in dev mode")
    args = parser.parse_args()

    print(f"\n  Agent Dialog Viewer  →  http://localhost:{args.port}\n")
    uvicorn.run("main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
