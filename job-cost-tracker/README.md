# Job Cost Tracker

Log what each job costs you (chemicals, gas, time, ad spend, other expenses) in a few taps, and see per-day totals and insights.

## Run it

```bash
pip install -r requirements.txt
python app.py            # open http://localhost:5000 (or your computer's IP on your phone)
```

Data is stored in `data/jobs.db` (SQLite). Set `JOBCOST_DB=/path/file.db` to store it somewhere else.

## Screens

- **Log**: the quick form. The date defaults to today and the job cost updates live as you type. After a save the form clears and keeps the date, so you can log the next job right away.
- **Day**: every job for a date with totals. Edit or delete jobs here.
- **Insights**: totals and averages for the last 7, 30 or 90 days or the past year, a cost breakdown by category, a cost-per-day chart and a CSV export.
- **Settings (⚙)**: your hourly labor rate, used to cost the time you spend on each job.

## How the data is stored

- Money is stored as integer cents and time as integer minutes, so totals never pick up rounding errors.
- Each job saves the hourly rate in effect when it was logged, so changing your rate later doesn't change past jobs.
- Schema changes go through the numbered `MIGRATIONS` list in `db.py`, so new fields can be added without losing data.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/jobs` | create a job |
| GET | `/api/jobs?start=&end=` | list jobs |
| GET/PUT/DELETE | `/api/jobs/<id>` | read / update (partial) / delete |
| GET | `/api/days/<YYYY-MM-DD>` | one day's jobs + totals |
| GET | `/api/summary?start=&end=` | range totals, averages, per-day rollup |
| GET/PUT | `/api/settings` | hourly rate |
| GET | `/api/export.csv` | all jobs as CSV |

## Tests

```bash
python -m pytest -q
```
