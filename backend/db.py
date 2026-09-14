"""PostgreSQL connection pool and query helpers (psycopg3)."""

import os
from contextlib import asynccontextmanager
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.numeric import NumericLoader
from psycopg_pool import AsyncConnectionPool

pool: Optional[AsyncConnectionPool] = None

# numeric columns (deposit_amount, avg_ticket_per_guest, ...) come back as float
# instead of Decimal — matches the Pydantic float fields without per-row casts.
psycopg.adapters.register_loader("numeric", NumericLoader(float))


async def init_db():
    """Create the async connection pool. Call once on startup."""
    global pool
    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        raise RuntimeError("DATABASE_URL env var is required")

    # psycopg3 pool: min 2, max 10 connections. dict_row → rows are plain dicts.
    pool = AsyncConnectionPool(
        dsn,
        min_size=2,
        max_size=10,
        kwargs={"row_factory": dict_row, "autocommit": False},
    )
    # Verify connectivity
    async with pool.connection() as conn:
        await conn.execute("SELECT 1")


async def close_db():
    """Close the connection pool. Call on shutdown."""
    global pool
    if pool:
        await pool.close()
        pool = None


@asynccontextmanager
async def get_conn():
    """Yield a transactional connection. Auto-commit on success, rollback on error."""
    if pool is None:
        raise RuntimeError("DB pool not initialized — call init_db() first")
    async with pool.connection() as conn:
        async with conn.transaction():
            yield conn


async def fetch_one(sql: str, params: tuple = ()) -> Optional[dict[str, Any]]:
    """Return a single row as dict, or None."""
    async with get_conn() as conn:
        cur = await conn.execute(sql, params)
        row = await cur.fetchone()
        return row


async def fetch_all(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    """Return all rows as list of dicts."""
    async with get_conn() as conn:
        cur = await conn.execute(sql, params)
        rows = await cur.fetchall()
        return list(rows)


async def execute(sql: str, params: tuple = ()) -> int:
    """Execute a statement, return row count (via cursor.rowcount)."""
    async with get_conn() as conn:
        cur = await conn.execute(sql, params)
        return cur.rowcount


async def execute_returning(sql: str, params: tuple = ()) -> Optional[dict[str, Any]]:
    """Execute a statement with RETURNING clause, return the first row as dict."""
    async with get_conn() as conn:
        cur = await conn.execute(sql, params)
        row = await cur.fetchone()
        return row


async def execute_many(sql: str, data: list[tuple]) -> int:
    """Execute a statement for each tuple in data. Returns total rows affected."""
    async with get_conn() as conn:
        cur = await conn.executemany(sql, data)
        return cur.rowcount
