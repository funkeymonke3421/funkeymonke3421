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

# ---------- field specs ----------

# Money a job form can enter directly. API name -> column.
MONEY_FIELDS = {
    "revenue": "revenue_cents",
    "other": "other_cents",
    "ad_extra": "ad_cents",      # one-off ad / lead cost for this job
    "chem_extra": "chem_cents",  # manual chem $ (older jobs, or bought for one job)
    "gas_extra": "gas_cents",    # manual gas $ (older jobs)
}
# Quantities stored as scaled integers. API name -> (column, scale, max).
QTY_FIELDS = {
    "chem_gallons": ("chem_gal_x100", 100, 10_000),
    "miles": ("miles_x10", 10, 5_000),
}
TEXT_FIELDS = {"name": 120, "other_note": 200, "notes": 1000}

# Setup values. API name -> (settings key, scale, max). Scale 100 = money in cents.
SETTINGS = {
    "hourly_rate": ("hourly_rate_cents", 100, 10_000),
    "chem_price": ("chem_price_cents", 100, 10_000),
    "gas_price": ("gas_price_cents", 100, 100),
    "mpg": ("mpg_x10", 10, 200),
    "default_miles": ("default_miles_x10", 10, 5_000),
    "ad_per_day": ("ad_per_day_cents", 100, 100_000),
    "equip_rate": ("equip_rate_cents", 100, 10_000),
    "overhead_per_job": ("overhead_cents", 100, 100_000),
}
# Rates copied onto each new job: job column <- settings key.
SNAPSHOT = {
    "labor_rate_cents": "hourly_rate_cents",
    "chem_price_cents": "chem_price_cents",
    "gas_price_cents": "gas_price_cents",
    "mpg_x10": "mpg_x10",
    "equip_rate_cents": "equip_rate_cents",
    "overhead_cents": "overhead_cents",
}

MAX_MONEY = 1_000_000
MAX_MINUTES = 24 * 60
COST_KEYS = ("chem", "gas", "labor", "equipment", "ad_spend", "overhead", "other")
SUM_KEYS = ("revenue", *COST_KEYS, "total_cost", "profit")


class ValidationError(ValueError):
    pass


# ---------- parsing helpers ----------

def to_scaled(value, field, scale, maximum):
    """Parse a non-negative decimal ("$1,234.5") into an integer of value*scale."""
    if value is None or value == "":
        return 0
    try:
        d = Decimal(str(value).replace("$", "").replace(",", "").strip())
    except InvalidOperation:
        raise ValidationError(f"{field} must be a number")
    if not d.is_finite() or d < 0:
        raise ValidationError(f"{field} can't be negative")
    if d > maximum:
        raise ValidationError(f"{field} is too large")
    return int((d * scale).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_cents(value, field):
    return to_scaled(value, field, 100, MAX_MONEY)


def to_minutes(value):
    m = to_scaled(value, "minutes", 1, MAX_MINUTES)
    return m


def to_date(value, field="date"):
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date().isoformat()
    except (TypeError, ValueError):
        raise ValidationError(f"{field} must be YYYY-MM-DD")


def unscale(n, scale=100):
    return round(n / scale, 2)


def label(field):
    return field.replace("_", " ")


# ---------- cost math (all integer cents) ----------

def div_round(a, b):
    return (a + b // 2) // b if b else 0


def job_costs(row, ad_share):
    chem = row["chem_cents"] + div_round(row["chem_gal_x100"] * row["chem_price_cents"], 100)
    gas = row["gas_cents"] + div_round(row["miles_x10"] * row["gas_price_cents"], row["mpg_x10"])
    labor = div_round(row["minutes"] * row["labor_rate_cents"], 60)
    equipment = div_round(row["minutes"] * row["equip_rate_cents"], 60)
    ad = row["ad_cents"] + ad_share
    costs = {"chem": chem, "gas": gas, "labor": labor, "equipment": equipment,
             "ad_spend": ad, "overhead": row["overhead_cents"], "other": row["other_cents"]}
    costs["total_cost"] = sum(costs.values())
    costs["revenue"] = row["revenue_cents"]
    costs["profit"] = row["revenue_cents"] - costs["total_cost"]
    return costs


def empty_totals():
    return {"jobs": 0, "minutes": 0, "miles": 0, "chem_gallons": 0, **{k: 0 for k in SUM_KEYS}}


def add_to_totals(t, job):
    t["jobs"] += 1
    t["minutes"] += job["minutes"]
    t["miles"] = round(t["miles"] + job["miles"], 1)
    t["chem_gallons"] = round(t["chem_gallons"] + job["chem_gallons"], 2)
    for k in SUM_KEYS:
        t[k] = round(t[k] + job[k], 2)


# ---------- app ----------

def create_app(db_path=None):
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config["DB_PATH"] = db_path or os.environ.get(
        "JOBCOST_DB", os.path.join(os.path.dirname(__file__), "data", "jobs.db"))

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

    # --- settings helpers ---
    def settings_raw():
        rows = get_db().execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: int(r["value"]) for r in rows}

    def settings_api(raw=None):
        raw = raw or settings_raw()
        return {api: unscale(raw.get(key, 0), scale) for api, (key, scale, _) in SETTINGS.items()}

    # --- job hydration (adds computed costs, ad share, and types) ---
    def hydrate(rows):
        if not rows:
            return []
        conn = get_db()
        dates = [r["job_date"] for r in rows]
        lo, hi = min(dates), max(dates)

        # Every job id on each affected date, oldest first, to split that day's ads.
        day_ids = {}
        for r in conn.execute("SELECT id, job_date FROM jobs WHERE job_date BETWEEN ? AND ? "
                              "ORDER BY id", (lo, hi)):
            day_ids.setdefault(r["job_date"], []).append(r["id"])
        ad_days = {r["job_date"]: r["ad_cents"] for r in conn.execute(
            "SELECT job_date, ad_cents FROM ad_days WHERE job_date BETWEEN ? AND ?", (lo, hi))}

        def ad_share(job_id, day):
            ids = day_ids.get(day, [])
            total = ad_days.get(day, 0)
            if not ids or not total:
                return 0
            base, rem = divmod(total, len(ids))
            return base + (1 if ids.index(job_id) < rem else 0)

        ids = [r["id"] for r in rows]
        types = {}
        marks = ",".join("?" * len(ids))
        for r in conn.execute(
                f"SELECT l.job_id, t.id, t.name FROM job_type_links l "
                f"JOIN job_types t ON t.id = l.type_id WHERE l.job_id IN ({marks}) "
                f"ORDER BY t.id", ids):
            types.setdefault(r["job_id"], []).append({"id": r["id"], "name": r["name"]})

        out = []
        for row in rows:
            share = ad_share(row["id"], row["job_date"])
            c = job_costs(row, share)
            out.append({
                "id": row["id"],
                "date": row["job_date"],
                "name": row["name"],
                "types": types.get(row["id"], []),
                "chem_gallons": unscale(row["chem_gal_x100"], 100),
                "miles": unscale(row["miles_x10"], 10),
                "minutes": row["minutes"],
                **{k: unscale(v) for k, v in c.items()},
                "ad_share": unscale(share),
                "ad_extra": unscale(row["ad_cents"]),
                "chem_extra": unscale(row["chem_cents"]),
                "gas_extra": unscale(row["gas_cents"]),
                "other_note": row["other_note"],
                "notes": row["notes"],
                "rates": {
                    "hourly_rate": unscale(row["labor_rate_cents"]),
                    "chem_price": unscale(row["chem_price_cents"]),
                    "gas_price": unscale(row["gas_price_cents"]),
                    "mpg": unscale(row["mpg_x10"], 10),
                    "equip_rate": unscale(row["equip_rate_cents"]),
                    "overhead_per_job": unscale(row["overhead_cents"]),
                },
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            })
        return out

    def fetch_job(job_id):
        row = get_db().execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return hydrate([row])[0] if row else None

    def jobs_between(start, end):
        rows = get_db().execute(
            "SELECT * FROM jobs WHERE job_date BETWEEN ? AND ? ORDER BY job_date, id",
            (start, end)).fetchall()
        return hydrate(rows)

    # --- job parsing ---
    def parse_job(payload, partial=False):
        if not isinstance(payload, dict):
            raise ValidationError("expected a JSON object")
        has = lambda k: k in payload or not partial  # noqa: E731
        out = {}
        if has("date"):
            out["job_date"] = to_date(payload.get("date"))
        for api, col in MONEY_FIELDS.items():
            if has(api):
                out[col] = to_cents(payload.get(api), label(api))
        for api, (col, scale, mx) in QTY_FIELDS.items():
            if has(api):
                out[col] = to_scaled(payload.get(api), label(api), scale, mx)
        if has("minutes"):
            out["minutes"] = to_minutes(payload.get("minutes"))
        for field, limit in TEXT_FIELDS.items():
            if has(field):
                text = str(payload.get(field) or "").strip()
                if len(text) > limit:
                    raise ValidationError(f"{field} must be {limit} characters or fewer")
                out[field] = text

        type_ids = None
        if "type_ids" in payload:
            raw = payload["type_ids"] or []
            if not isinstance(raw, list) or not all(isinstance(i, int) for i in raw):
                raise ValidationError("type_ids must be a list of ids")
            type_ids = sorted(set(raw))
            if type_ids:
                marks = ",".join("?" * len(type_ids))
                found = get_db().execute(
                    f"SELECT COUNT(*) FROM job_types WHERE id IN ({marks})", type_ids).fetchone()[0]
                if found != len(type_ids):
                    raise ValidationError("unknown job type")
        return out, type_ids

    def ensure_ad_day(conn, day, raw):
        conn.execute("INSERT OR IGNORE INTO ad_days (job_date, ad_cents) VALUES (?, ?)",
                     (day, raw.get("ad_per_day_cents", 0)))

    def set_types(conn, job_id, type_ids):
        conn.execute("DELETE FROM job_type_links WHERE job_id = ?", (job_id,))
        conn.executemany("INSERT INTO job_type_links (job_id, type_id) VALUES (?, ?)",
                         [(job_id, t) for t in type_ids])

    # --- front end ---
    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    # --- jobs ---
    @app.post("/api/jobs")
    def create_job():
        data, type_ids = parse_job(request.get_json(silent=True))
        raw = settings_raw()
        for col, key in SNAPSHOT.items():
            data[col] = raw.get(key, 0)
        cols = ", ".join(data)
        marks = ", ".join("?" for _ in data)
        conn = get_db()
        with conn:
            cur = conn.execute(f"INSERT INTO jobs ({cols}) VALUES ({marks})", list(data.values()))
            set_types(conn, cur.lastrowid, type_ids or [])
            ensure_ad_day(conn, data["job_date"], raw)
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
        data, type_ids = parse_job(request.get_json(silent=True), partial=True)
        if not data and type_ids is None:
            raise ValidationError("nothing to update")
        conn = get_db()
        if not conn.execute("SELECT 1 FROM jobs WHERE id = ?", (job_id,)).fetchone():
            return jsonify(error="not found"), 404
        with conn:
            if data:
                sets = ", ".join(f"{c} = ?" for c in data)
                conn.execute(f"UPDATE jobs SET {sets}, updated_at = datetime('now') WHERE id = ?",
                             [*data.values(), job_id])
            if type_ids is not None:
                set_types(conn, job_id, type_ids)
            if "job_date" in data:
                ensure_ad_day(conn, data["job_date"], settings_raw())
        return jsonify(fetch_job(job_id))

    @app.delete("/api/jobs/<int:job_id>")
    def delete_job(job_id):
        conn = get_db()
        with conn:
            cur = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        if cur.rowcount == 0:
            return jsonify(error="not found"), 404
        return "", 204

    # --- job types ---
    TYPE_COLS = "id, name, default_gal_x100, default_minutes, default_revenue_cents"

    def type_to_dict(r):
        return {"id": r["id"], "name": r["name"],
                "default_gallons": unscale(r["default_gal_x100"]),
                "default_minutes": r["default_minutes"],
                "default_price": unscale(r["default_revenue_cents"])}

    def active_types():
        rows = get_db().execute(f"SELECT {TYPE_COLS} FROM job_types WHERE archived = 0 "
                                "ORDER BY name COLLATE NOCASE")
        return [type_to_dict(r) for r in rows]

    def get_type(type_id):
        r = get_db().execute(f"SELECT {TYPE_COLS} FROM job_types WHERE id = ?", (type_id,)).fetchone()
        return type_to_dict(r) if r else None

    def parse_type(payload, partial=False):
        if not isinstance(payload, dict):
            raise ValidationError("expected a JSON object")
        out = {}
        if "name" in payload or not partial:
            name = str(payload.get("name") or "").strip()
            if not name:
                raise ValidationError("name is required")
            if len(name) > 40:
                raise ValidationError("name must be 40 characters or fewer")
            out["name"] = name
        if "default_gallons" in payload:
            out["default_gal_x100"] = to_scaled(payload["default_gallons"], "usual chem", 100, 10_000)
        if "default_minutes" in payload:
            out["default_minutes"] = to_minutes(payload["default_minutes"])
        if "default_price" in payload:
            out["default_revenue_cents"] = to_cents(payload["default_price"], "usual price")
        return out

    def name_taken(name, exclude_id=None):
        return get_db().execute(
            "SELECT 1 FROM job_types WHERE name = ? COLLATE NOCASE AND archived = 0 AND id != ?",
            (name, exclude_id or -1)).fetchone() is not None

    @app.get("/api/job-types")
    def list_types():
        return jsonify(active_types())

    @app.post("/api/job-types")
    def create_type():
        data = parse_type(request.get_json(silent=True))
        name = data["name"]
        if name_taken(name):
            raise ValidationError(f'"{name}" already exists')
        conn = get_db()
        archived = conn.execute(
            "SELECT id FROM job_types WHERE name = ? COLLATE NOCASE AND archived = 1 LIMIT 1",
            (name,)).fetchone()
        with conn:
            if archived:  # bring back an archived type so its history stays together
                type_id = archived["id"]
                sets = ", ".join(f"{c} = ?" for c in data)
                conn.execute(f"UPDATE job_types SET archived = 0, {sets} WHERE id = ?",
                             [*data.values(), type_id])
            else:
                cols = ", ".join(data)
                marks = ", ".join("?" for _ in data)
                type_id = conn.execute(f"INSERT INTO job_types ({cols}) VALUES ({marks})",
                                       list(data.values())).lastrowid
        return jsonify(get_type(type_id)), 201

    @app.put("/api/job-types/<int:type_id>")
    def update_type(type_id):
        data = parse_type(request.get_json(silent=True), partial=True)
        if not data:
            raise ValidationError("nothing to update")
        if "name" in data and name_taken(data["name"], type_id):
            raise ValidationError(f'"{data["name"]}" already exists')
        conn = get_db()
        with conn:
            sets = ", ".join(f"{c} = ?" for c in data)
            cur = conn.execute(f"UPDATE job_types SET {sets} WHERE id = ?", [*data.values(), type_id])
        if cur.rowcount == 0:
            return jsonify(error="not found"), 404
        return jsonify(get_type(type_id))

    @app.delete("/api/job-types/<int:type_id>")
    def archive_type(type_id):
        # Archived, not deleted: past jobs keep their type for history and insights.
        conn = get_db()
        with conn:
            cur = conn.execute("UPDATE job_types SET archived = 1 WHERE id = ?", (type_id,))
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
        row = get_db().execute("SELECT ad_cents FROM ad_days WHERE job_date = ?", (day,)).fetchone()
        return jsonify(date=day, jobs=jobs, totals=totals,
                       ad_per_day=unscale(row["ad_cents"]) if row else None)

    @app.put("/api/days/<day>/ad")
    def set_day_ad(day):
        day = to_date(day)
        cents = to_cents((request.get_json(silent=True) or {}).get("ad_per_day"), "ad spend")
        conn = get_db()
        with conn:
            conn.execute("INSERT INTO ad_days (job_date, ad_cents) VALUES (?, ?) "
                         "ON CONFLICT(job_date) DO UPDATE SET ad_cents = excluded.ad_cents",
                         (day, cents))
        return day_view(day)

    @app.get("/api/summary")
    def summary():
        end = to_date(request.args.get("end", date.today().isoformat()), "end")
        start = to_date(request.args.get(
            "start", (date.fromisoformat(end) - timedelta(days=29)).isoformat()), "start")
        if start > end:
            raise ValidationError("start must be on or before end")

        totals, by_day, by_type = empty_totals(), {}, {}
        for j in jobs_between(start, end):
            add_to_totals(totals, j)
            add_to_totals(by_day.setdefault(j["date"], empty_totals()), j)
            for t in j["types"] or [{"id": None, "name": "No type"}]:
                bucket = by_type.setdefault(t["id"], {"id": t["id"], "name": t["name"],
                                                      **empty_totals()})
                add_to_totals(bucket, j)

        days = [{"date": d, **t} for d, t in sorted(by_day.items())]
        types = sorted(by_type.values(), key=lambda t: -t["jobs"])
        for t in types:
            t["avg_cost_per_job"] = round(t["total_cost"] / t["jobs"], 2)
            t["avg_revenue_per_job"] = round(t["revenue"] / t["jobs"], 2)
        active = len(days)
        n = totals["jobs"]
        totals["avg_cost_per_job"] = round(totals["total_cost"] / n, 2) if n else 0
        totals["avg_cost_per_day"] = round(totals["total_cost"] / active, 2) if active else 0
        totals["avg_jobs_per_day"] = round(n / active, 2) if active else 0
        totals["active_days"] = active
        return jsonify(start=start, end=end, totals=totals, days=days, by_type=types)

    # --- settings ---
    @app.get("/api/settings")
    def get_settings():
        return jsonify(settings_api())

    @app.put("/api/settings")
    def put_settings():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise ValidationError("expected a JSON object")
        updates = {}
        for api, value in payload.items():
            if api not in SETTINGS:
                raise ValidationError(f"unknown setting: {api}")
            key, scale, mx = SETTINGS[api]
            updates[key] = to_scaled(value, label(api), scale, mx)
        conn = get_db()
        with conn:
            conn.executemany(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [(k, str(v)) for k, v in updates.items()])
        return jsonify(settings_api())

    # --- export ---
    @app.get("/api/export.csv")
    def export_csv():
        jobs = jobs_between("0001-01-01", "9999-12-31")
        cols = ["id", "date", "name", "types", "revenue", "chem_gallons", "chem", "miles", "gas",
                "minutes", "labor", "equipment", "ad_spend", "overhead", "other", "other_note",
                "total_cost", "profit", "notes"]
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for j in jobs:
            w.writerow({**j, "types": "; ".join(t["name"] for t in j["types"])})
        return Response(buf.getvalue(), mimetype="text/csv", headers={
            "Content-Disposition": f"attachment; filename=jobs-{date.today()}.csv"})

    return app


if __name__ == "__main__":
    create_app().run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
