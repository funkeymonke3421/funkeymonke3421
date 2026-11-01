import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db  # noqa: E402
from app import create_app  # noqa: E402

DAY = "2026-10-30"


@pytest.fixture
def client(tmp_path):
    app = create_app(str(tmp_path / "test.db"))
    app.testing = True
    return app.test_client()


def post(client, **kw):
    return client.post("/api/jobs", json={"date": DAY, **kw})


def setup(client, **kw):
    r = client.put("/api/settings", json=kw)
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def test_rate_based_costs(client):
    setup(client, hourly_rate=30, chem_price="12.50", gas_price="3.60", mpg=18,
          equip_rate=4, overhead_per_job="2.25")
    j = post(client, chem_gallons="1.5", miles=9, minutes=90, other="1,000",
             ad_extra=5, revenue=1200).get_json()
    assert j["chem"] == 18.75          # 1.5 gal * $12.50
    assert j["gas"] == 1.80            # 9 mi / 18 mpg * $3.60
    assert j["labor"] == 45.0          # 1.5 h * $30
    assert j["equipment"] == 6.0       # 1.5 h * $4
    assert j["overhead"] == 2.25
    assert j["ad_spend"] == 5.0
    assert j["total_cost"] == round(18.75 + 1.8 + 45 + 6 + 2.25 + 5 + 1000, 2)
    assert j["profit"] == round(1200 - j["total_cost"], 2)


def test_rates_are_snapshotted(client):
    setup(client, hourly_rate=20, chem_price=10)
    jid = post(client, minutes=60, chem_gallons=1).get_json()["id"]
    setup(client, hourly_rate=50, chem_price=99)
    old = client.get(f"/api/jobs/{jid}").get_json()
    assert old["labor"] == 20.0 and old["chem"] == 10.0
    new = post(client, minutes=60, chem_gallons=1).get_json()
    assert new["labor"] == 50.0 and new["chem"] == 99.0


def test_zero_mpg_means_no_gas_cost(client):
    setup(client, gas_price=4)
    assert post(client, miles=50).get_json()["gas"] == 0


def test_daily_ad_split_across_jobs(client):
    setup(client, ad_per_day=10)
    ids = [post(client).get_json()["id"] for _ in range(3)]
    d = client.get(f"/api/days/{DAY}").get_json()
    shares = [j["ad_share"] for j in d["jobs"]]
    assert shares == [3.34, 3.33, 3.33] and d["totals"]["ad_spend"] == 10.0
    assert d["ad_per_day"] == 10.0
    # changing the setting doesn't touch a day that's already been charged
    setup(client, ad_per_day=50)
    assert client.get(f"/api/days/{DAY}").get_json()["totals"]["ad_spend"] == 10.0
    # but the day's amount can be edited directly
    d = client.put(f"/api/days/{DAY}/ad", json={"ad_per_day": 30}).get_json()
    assert [j["ad_share"] for j in d["jobs"]] == [10.0, 10.0, 10.0]
    client.delete(f"/api/jobs/{ids[0]}")
    assert client.get(f"/api/days/{DAY}").get_json()["totals"]["ad_spend"] == 30.0


def test_job_types_multi_select(client):
    wash = client.post("/api/job-types", json={"name": "House wash"}).get_json()["id"]
    roof = client.post("/api/job-types", json={"name": "Roof"}).get_json()["id"]
    assert client.post("/api/job-types", json={"name": "roof"}).status_code == 400
    j = post(client, type_ids=[roof, wash, wash]).get_json()
    assert [t["name"] for t in j["types"]] == ["House wash", "Roof"]
    j = client.put(f"/api/jobs/{j['id']}", json={"type_ids": [roof]}).get_json()
    assert [t["name"] for t in j["types"]] == ["Roof"]
    assert post(client, type_ids=[999]).status_code == 400
    assert post(client, type_ids="nope").status_code == 400


def test_archived_type_stays_on_history(client):
    tid = client.post("/api/job-types", json={"name": "Gutter"}).get_json()["id"]
    jid = post(client, type_ids=[tid]).get_json()["id"]
    assert client.delete(f"/api/job-types/{tid}").status_code == 204
    assert client.get("/api/job-types").get_json() == []
    assert client.get(f"/api/jobs/{jid}").get_json()["types"][0]["name"] == "Gutter"
    # re-adding the same name revives it rather than making a duplicate
    assert client.post("/api/job-types", json={"name": "Gutter"}).get_json()["id"] == tid


def test_summary_by_type(client):
    a = client.post("/api/job-types", json={"name": "A"}).get_json()["id"]
    b = client.post("/api/job-types", json={"name": "B"}).get_json()["id"]
    post(client, type_ids=[a], other=10)
    post(client, type_ids=[a, b], other=20)
    post(client, other=5)
    s = client.get(f"/api/summary?start={DAY}&end={DAY}").get_json()
    by = {t["name"]: t for t in s["by_type"]}
    assert by["A"]["jobs"] == 2 and by["A"]["total_cost"] == 30.0
    assert by["B"]["jobs"] == 1 and by["No type"]["total_cost"] == 5.0
    assert s["totals"]["total_cost"] == 35.0


def test_no_float_drift(client):
    for _ in range(10):
        post(client, chem_extra="0.10", other="0.20")
    t = client.get(f"/api/days/{DAY}").get_json()["totals"]
    assert t["chem"] == 1.0 and t["other"] == 2.0 and t["total_cost"] == 3.0


@pytest.mark.parametrize("bad", [
    {"other": "-1"}, {"revenue": "abc"}, {"minutes": 2000}, {"date": "10/30/2026"},
    {"name": "x" * 121}, {"revenue": "NaN"}, {"other": "Infinity"}, {"miles": 99999},
    {"chem_gallons": "-2"},
])
def test_validation(client, bad):
    r = post(client, **bad)
    assert r.status_code == 400 and "error" in r.get_json()


def test_settings_validation(client):
    assert client.put("/api/settings", json={"bogus": 1}).status_code == 400
    assert client.put("/api/settings", json={"mpg": -3}).status_code == 400
    s = setup(client, mpg="22.5", default_miles=8)
    assert s["mpg"] == 22.5 and s["default_miles"] == 8.0 and s["hourly_rate"] == 0


def test_update_partial_and_delete(client):
    jid = post(client, name="A", other=10, revenue=5).get_json()["id"]
    r = client.put(f"/api/jobs/{jid}", json={"revenue": 7}).get_json()
    assert r["revenue"] == 7.0 and r["other"] == 10.0
    assert client.put("/api/jobs/9999", json={"other": 1}).status_code == 404
    assert client.delete(f"/api/jobs/{jid}").status_code == 204
    assert client.get(f"/api/jobs/{jid}").status_code == 404


def test_summary_groups_by_day(client):
    post(client, date="2026-10-01", other=10)
    post(client, date="2026-10-01", other=20)
    post(client, date="2026-10-03", other=30)
    post(client, date="2026-11-05", other=999)
    s = client.get("/api/summary?start=2026-10-01&end=2026-10-31").get_json()
    assert s["totals"]["jobs"] == 3 and s["totals"]["total_cost"] == 60.0
    assert s["totals"]["avg_cost_per_day"] == 30.0
    assert [d["date"] for d in s["days"]] == ["2026-10-01", "2026-10-03"]
    assert client.get("/api/summary?start=2026-10-31&end=2026-10-01").status_code == 400


def test_v1_database_upgrades_and_keeps_old_jobs(tmp_path):
    path = str(tmp_path / "old.db")
    conn = db.connect(path)
    conn.executescript(f"BEGIN; {db.MIGRATIONS[0]}; PRAGMA user_version = 1; COMMIT;")
    conn.execute("INSERT INTO jobs (job_date, name, chem_cents, gas_cents, ad_cents, minutes, "
                 "labor_rate_cents) VALUES (?, 'old', 1000, 500, 200, 60, 2000)", (DAY,))
    conn.commit()
    conn.close()
    c = create_app(path).test_client()
    j = c.get("/api/jobs").get_json()[0]
    assert (j["chem"], j["gas"], j["ad_spend"], j["labor"], j["total_cost"]) == (10, 5, 2, 20, 37)
    assert sqlite3.connect(path).execute("PRAGMA user_version").fetchone()[0] == 2


def test_csv_export(client):
    tid = client.post("/api/job-types", json={"name": "Deck"}).get_json()["id"]
    post(client, name='Has, comma "quote"', other=1, type_ids=[tid])
    r = client.get("/api/export.csv")
    lines = r.get_data(as_text=True).splitlines()
    assert lines[0].startswith("id,date,name,types")
    assert '"Has, comma ""quote""",Deck' in lines[1]


def test_index_served(client):
    assert b"Job Cost" in client.get("/").data
