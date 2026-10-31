"""Job Cost Tracker — Flask API + static front end.

Run:  python app.py        (then open http://localhost:5000)
Data: ./data/jobs.db       (override with JOBCOST_DB=/path/to/file.db)
"""

import csv
import io
import os
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from flask import Flask, Response, g, jsonify, request, send_from_directory

import db

MONEY_FIELDS = {  # API name -> column
    "revenue": "revenue_cents",
    "chem": "chem_cents",
    "gas": "gas_cents",
    "ad_spend": "ad_cents",
    "other": "other_cents",
}
TEXT_FIELDS = {"name": 120, "other_note": 200, "notes": 1000}
MAX_MONEY_CENTS = 100_000_000  # $1,000,000 sanity cap per field
MAX_MINUTES = 24 * 60


class ValidationError(ValueError):
    pass


# ---------- parsing helpers ----------

def to_cents(value, field):
    if value is None or value == "":
        return 0
    try:
        d = Decimal(str(value).replace("$", "").replace(",", "").strip())
    except InvalidOperation:
        raise ValidationError(f"{field} must be a number")
    if not d.is_finite() or d < 0:
        raise ValidationError(f"{field} can't be negative")
    cents = int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents > MAX_MONEY_CENTS:
        raise ValidationError(f"{field} is too large")
    return cents


def to_minutes(value):
    if value is None or value == "":
        return 0
    try:
        m = Decimal(str(value))
    except InvalidOperation:
        raise ValidationError("minutes must be a number")
    if not m.is_finite() or m < 0 or m > MAX_MINUTES:
        raise ValidationError("minutes must be between 0 and 1440")
    return int(m.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_date(value, field="date"):
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date().isoformat()
    except (TypeError, ValueError):
        raise ValidationError(f"{field} must be YYYY-MM-DD")


def dollars(cents):
    return round(cents / 100, 2)


# ---------- domain ----------

def labor_cents(minutes, rate_cents):
    # Integer math, rounded half-up to the nearest cent.
    return (minutes * rate_cents + 30) // 60


def job_to_dict(row):
    labor = labor_cents(row["minutes"], row["labor_rate_cents"])
    cost = row["chem_cents"] + row["gas_cents"] + row["ad_cents"] + row["other_cents"] + labor
    return {
        "id": row["id"],
        "date": row["job_date"],
        "name": row["name"],
        "revenue": dollars(row["revenue_cents"]),
        "chem": dollars(row["chem_cents"]),
        "gas": dollars(row["gas_cents"]),
        "ad_spend": dollars(row["ad_cents"]),
        "other": dollars(row["other_cents"]),
        "other_note": row["other_note"],
        "minutes": row["minutes"],
        "labor_rate": dollars(row["labor_rate_cents"]),
        "labor": dollars(labor),
        "total_cost": dollars(cost),
        "profit": dollars(row["revenue_cents"] - cost),
        "notes": row["notes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def empty_totals():
    return {k: 0 for k in ("jobs", "minutes", "revenue", "chem", "gas", "ad_spend",
                           "other", "labor", "total_cost", "profit")}


def add_to_totals(t, job):
    t["jobs"] += 1
    t["minutes"] += job["minutes"]
    for k in ("revenue", "chem", "gas", "ad_spend", "other", "labor", "total_cost", "profit"):
        t[k] = round(t[k] + job[k], 2)


def parse_job(payload, partial=False):
    if not isinstance(payload, dict):
        raise ValidationError("expected a JSON object")
    out = {}
    if "date" in payload or not partial:
        out["job_date"] = to_date(payload.get("date"))
    for api, col in MONEY_FIELDS.items():
        if api in payload or not partial:
            out[col] = to_cents(payload.get(api), api.replace("_", " "))
    if "minutes" in payload or not partial:
        out["minutes"] = to_minutes(payload.get("minutes"))
    if "labor_rate" in payload:
        out["labor_rate_cents"] = to_cents(payload["labor_rate"], "labor rate")
    for field, limit in TEXT_FIELDS.items():
        if field in payload or not partial:
            text = str(payload.get(field) or "").strip()
            if len(text) > limit:
                raise ValidationError(f"{field} must be {limit} characters or fewer")
            out[field] = text
    return out


# ---------- app ----------

def create_app(db_path=None):
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config["DB_PATH"] = db_path or os.environ.get(
        "JOBCOST_DB", os.path.join(os.path.dirname(__file__), "data", "jobs.db"))

    with app.app_context():
        conn = db.connect(app.config["DB_PATH"])
        db.migrate(conn)
        conn.close()

    def get_db():
        if "db" not in g:
            g.db = db.connect(app.config["DB_PATH"])
        return g.db

    @app.teardown_appcontext
    def close_db(_exc):
        conn = g.pop("db", None)
        if conn is not None:
            conn.close()

    @app.errorhandler(ValidationError)
    def handle_validation(err):
        return jsonify(error=str(err)), 400

    def get_setting_cents(key):
        row = get_db().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return int(row["value"]) if row else 0

    def fetch_job(job_id):
        row = get_db().execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if row is None:
            return None
        return job_to_dict(row)

    def jobs_between(start, end):
        rows = get_db().execute(
            "SELECT * FROM jobs WHERE job_date BETWEEN ? AND ? ORDER BY job_date, id",
            (start, end)).fetchall()
        return [job_to_dict(r) for r in rows]

    # --- front end ---
    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    # --- jobs ---
    @app.post("/api/jobs")
    def create_job():
        data = parse_job(request.get_json(silent=True))
        data.setdefault("labor_rate_cents", get_setting_cents("hourly_rate_cents"))
        cols = ", ".join(data)
        marks = ", ".join("?" for _ in data)
        conn = get_db()
        with conn:
            cur = conn.execute(f"INSERT INTO jobs ({cols}) VALUES ({marks})", list(data.values()))
        return jsonify(fetch_job(cur.lastrowid)), 201

    @app.get("/api/jobs")
    def list_jobs():
        start = to_date(request.args.get("start", "0001-01-01"), "start")
        end = to_date(request.args.get("end", "9999-12-31"), "end")
        return jsonify(jobs_between(start, end))

    @app.get("/api/jobs/<int:job_id>")
    def get_job(job_id):
        job = fetch_job(job_id)
        return (jsonify(job), 200) if job else (jsonify(error="not found"), 404)

    @app.put("/api/jobs/<int:job_id>")
    def update_job(job_id):
        data = parse_job(request.get_json(silent=True), partial=True)
        if not data:
            raise ValidationError("nothing to update")
        sets = ", ".join(f"{c} = ?" for c in data)
        conn = get_db()
        with conn:
            cur = conn.execute(
                f"UPDATE jobs SET {sets}, updated_at = datetime('now') WHERE id = ?",
                [*data.values(), job_id])
        if cur.rowcount == 0:
            return jsonify(error="not found"), 404
        return jsonify(fetch_job(job_id))

    @app.delete("/api/jobs/<int:job_id>")
    def delete_job(job_id):
        conn = get_db()
        with conn:
            cur = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        if cur.rowcount == 0:
            return jsonify(error="not found"), 404
        return "", 204

    # --- day + summary ---
    @app.get("/api/days/<day>")
    def day_view(day):
        day = to_date(day)
        jobs = jobs_between(day, day)
        totals = empty_totals()
        for j in jobs:
            add_to_totals(totals, j)
        return jsonify(date=day, jobs=jobs, totals=totals)

    @app.get("/api/summary")
    def summary():
        today = date.today()
        end = to_date(request.args.get("end", today.isoformat()), "end")
        start = to_date(request.args.get(
            "start", (date.fromisoformat(end) - timedelta(days=29)).isoformat()), "start")
        if start > end:
            raise ValidationError("start must be on or before end")

        totals, by_day = empty_totals(), {}
        for j in jobs_between(start, end):
            add_to_totals(totals, j)
            add_to_totals(by_day.setdefault(j["date"], empty_totals()), j)

        days = [{"date": d, **t} for d, t in sorted(by_day.items())]
        active = len(days)
        n = totals["jobs"]
        totals["avg_cost_per_job"] = round(totals["total_cost"] / n, 2) if n else 0
        totals["avg_cost_per_day"] = round(totals["total_cost"] / active, 2) if active else 0
        totals["avg_jobs_per_day"] = round(n / active, 2) if active else 0
        totals["active_days"] = active
        return jsonify(start=start, end=end, totals=totals, days=days)

    # --- settings ---
    @app.get("/api/settings")
    def get_settings():
        return jsonify(hourly_rate=dollars(get_setting_cents("hourly_rate_cents")))

    @app.put("/api/settings")
    def put_settings():
        payload = request.get_json(silent=True) or {}
        if "hourly_rate" not in payload:
            raise ValidationError("hourly_rate is required")
        cents = to_cents(payload["hourly_rate"], "hourly rate")
        conn = get_db()
        with conn:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('hourly_rate_cents', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(cents),))
        return jsonify(hourly_rate=dollars(cents))

    # --- export ---
    @app.get("/api/export.csv")
    def export_csv():
        jobs = jobs_between("0001-01-01", "9999-12-31")
        cols = ["id", "date", "name", "revenue", "chem", "gas", "ad_spend", "other",
                "other_note", "minutes", "labor_rate", "labor", "total_cost", "profit", "notes"]
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(jobs)
        return Response(buf.getvalue(), mimetype="text/csv", headers={
            "Content-Disposition": f"attachment; filename=jobs-{date.today()}.csv"})

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
