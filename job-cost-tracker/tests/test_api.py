import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app  # noqa: E402


@pytest.fixture
def client(tmp_path):
    app = create_app(str(tmp_path / "test.db"))
    app.testing = True
    return app.test_client()


def post(client, **kw):
    body = {"date": "2026-10-30", **kw}
    return client.post("/api/jobs", json=body)


def test_create_and_cost_math(client):
    client.put("/api/settings", json={"hourly_rate": "30"})
    r = post(client, name="Smith", chem="12.50", gas="$8.10", ad_spend="5", other="1,000.00",
             other_note="pump", minutes=90, revenue="1200")
    assert r.status_code == 201
    j = r.get_json()
    assert j["labor"] == 45.0  # 1.5h * $30
    assert j["total_cost"] == 12.5 + 8.1 + 5 + 1000 + 45
    assert j["profit"] == round(1200 - j["total_cost"], 2)
    assert j["labor_rate"] == 30.0


def test_labor_rate_snapshot_survives_setting_change(client):
    client.put("/api/settings", json={"hourly_rate": 20})
    jid = post(client, minutes=60).get_json()["id"]
    client.put("/api/settings", json={"hourly_rate": 50})
    assert client.get(f"/api/jobs/{jid}").get_json()["labor"] == 20.0
    assert post(client, minutes=60).get_json()["labor"] == 50.0


def test_no_float_drift(client):
    for _ in range(10):
        post(client, chem="0.10", gas="0.20")
    t = client.get("/api/days/2026-10-30").get_json()["totals"]
    assert t["chem"] == 1.0 and t["gas"] == 2.0 and t["total_cost"] == 3.0


@pytest.mark.parametrize("bad", [
    {"chem": "-1"}, {"gas": "abc"}, {"minutes": 2000}, {"date": "10/30/2026"},
    {"name": "x" * 121}, {"revenue": "NaN"}, {"chem": "Infinity"},
])
def test_validation(client, bad):
    r = post(client, **bad)
    assert r.status_code == 400
    assert "error" in r.get_json()


def test_missing_body(client):
    assert client.post("/api/jobs", data="nope").status_code == 400


def test_update_partial_and_delete(client):
    jid = post(client, name="A", chem=10, gas=5).get_json()["id"]
    r = client.put(f"/api/jobs/{jid}", json={"gas": 7})
    assert r.get_json()["gas"] == 7.0 and r.get_json()["chem"] == 10.0
    assert client.put("/api/jobs/9999", json={"gas": 1}).status_code == 404
    assert client.delete(f"/api/jobs/{jid}").status_code == 204
    assert client.get(f"/api/jobs/{jid}").status_code == 404


def test_summary_groups_by_day(client):
    post(client, date="2026-10-01", chem=10)
    post(client, date="2026-10-01", chem=20)
    post(client, date="2026-10-03", gas=30)
    post(client, date="2026-11-05", gas=999)  # outside range
    s = client.get("/api/summary?start=2026-10-01&end=2026-10-31").get_json()
    assert s["totals"]["jobs"] == 3
    assert s["totals"]["total_cost"] == 60.0
    assert s["totals"]["active_days"] == 2
    assert s["totals"]["avg_cost_per_day"] == 30.0
    assert s["totals"]["avg_cost_per_job"] == 20.0
    assert [d["date"] for d in s["days"]] == ["2026-10-01", "2026-10-03"]
    assert client.get("/api/summary?start=2026-10-31&end=2026-10-01").status_code == 400


def test_csv_export(client):
    post(client, name='Has, comma "quote"', chem=1)
    r = client.get("/api/export.csv")
    assert r.status_code == 200 and r.mimetype == "text/csv"
    lines = r.get_data(as_text=True).splitlines()
    assert lines[0].startswith("id,date,name")
    assert '"Has, comma ""quote"""' in lines[1]


def test_index_served(client):
    assert b"Job Cost" in client.get("/").data
