"""Serve the DIO portal and collect aggregate usage in a local SQLite database."""

import argparse
import json
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CHINA = timezone(timedelta(hours=8))
VISITOR_ID = re.compile(r"[0-9a-f]{32}")


def connect(path):
    db = sqlite3.connect(path, timeout=2)
    db.execute("PRAGMA cache_size = -512")
    return db


def initialize(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(path)) as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS totals (
                day TEXT NOT NULL,
                app_id TEXT NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (day, app_id)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS browsers (
                day TEXT NOT NULL,
                visitor TEXT NOT NULL,
                PRIMARY KEY (day, visitor)
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS player_usage (
                player TEXT NOT NULL,
                day TEXT NOT NULL,
                app_id TEXT NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (player, day, app_id)
            ) WITHOUT ROWID;
        """)


def record(path, day, app_id, visitor, *, current_player=None):
    with closing(connect(path)) as db, db:
        db.execute("""
            INSERT INTO totals VALUES (?, ?, 1)
            ON CONFLICT (day, app_id) DO UPDATE SET count = count + 1
        """, (day, app_id))
        if visitor:
            db.execute("INSERT OR IGNORE INTO browsers VALUES (?, ?)", (day, visitor))
        player = current_player(db) if current_player else None
        if player:
            db.execute("""
                INSERT INTO player_usage VALUES (?, ?, ?, 1)
                ON CONFLICT (player, day, app_id) DO UPDATE SET count = count + 1
            """, (player, day, app_id))


def summarize(path, today, days):
    dates = [(today - timedelta(days=offset)).isoformat() for offset in range(days - 1, -1, -1)]
    window = (dates[0], dates[-1])
    with closing(connect(path)) as db, db:
        db.execute("BEGIN")
        visits = dict(db.execute("""
            SELECT day, count FROM totals WHERE day BETWEEN ? AND ? AND app_id = ''
        """, window))
        clicks = db.execute("""
            SELECT app_id, SUM(count) FROM totals
            WHERE day BETWEEN ? AND ? AND app_id != ''
            GROUP BY app_id ORDER BY SUM(count) DESC, app_id
        """, window).fetchall()
        browser_count = db.execute("""
            SELECT COUNT(DISTINCT visitor) FROM browsers WHERE day BETWEEN ? AND ?
        """, window).fetchone()[0]

    return {
        "visits": sum(visits.values()),
        "browsers": browser_count,
        "clicks": sum(count for _, count in clicks),
        "trend": [{"date": day, "count": visits.get(day, 0)} for day in dates],
        "ranking": [{"id": app_id, "count": count} for app_id, count in clicks[:5]],
    }


def summarize_home(path, today):
    """Lifetime headline metrics and a seven-day window, from one snapshot."""
    dates = [(today - timedelta(days=offset)).isoformat() for offset in range(6, -1, -1)]
    with closing(connect(path)) as db, db:
        db.execute('BEGIN')
        visits, clicks = db.execute("""
            SELECT COALESCE(SUM(CASE WHEN app_id = '' THEN count ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN app_id != '' THEN count ELSE 0 END), 0)
            FROM totals WHERE day <= ?
        """, (dates[-1],)).fetchone()
        browsers = db.execute('SELECT COUNT(DISTINCT visitor) FROM browsers WHERE day <= ?',
                              (dates[-1],)).fetchone()[0]
        daily = dict(db.execute("SELECT day,count FROM totals WHERE day BETWEEN ? AND ? AND app_id = ''",
                                (dates[0], dates[-1])))
    trend = [{'date': day, 'count': daily.get(day, 0)} for day in dates]
    return {'days': 7, 'visits': visits, 'weekVisits': sum(row['count'] for row in trend),
            'browsers': browsers, 'clicks': clicks, 'trend': trend}
