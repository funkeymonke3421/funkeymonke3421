# Job Cost Tracker

Log what each job costs you (chemicals, gas, time, ad spend, other expenses) in a few taps, and see per-day totals and insights.

## Run it

```bash
pip install -r requirements.txt
python app.py            # open http://localhost:5000 (or your computer's IP on your phone)
```

Data is stored in `data/jobs.db` (SQLite). Set `JOBCOST_DB=/path/file.db` to store it somewhere else.

## Screens

- **Log**: the quick form.
  - Tap one or more **job types**.
  - Enter the **gallons of chem** used and the **miles driven**, and the app works out the dollars from your Setup rates. Miles fill in automatically with your usual distance between jobs.
  - Add time with the +15m, +30m and +1h buttons, and the job price if you want profit.
  - Other expenses, one-off ad or lead costs, and notes are under "Other costs & notes".
- **Day**: every job for a date with totals. You can change that day's ad spend here, and edit or delete jobs.
- **Insights**: totals over 7, 30 or 90 days or the past year, where the money goes, cost and profit **by job type**, a cost-per-day chart and a CSV export.
- **Setup**: your job types and your rates:

| Setting | Used for |
|---|---|
| Chem cost per gallon | chem $ = gallons × price |
| Gas price, truck MPG | gas $ = miles ÷ MPG × price |
| Usual miles between jobs | pre-fills miles on each new job |
| Hourly rate | labor $ = time × rate |
| Equipment wear / hour | equipment $ = time × rate |
| Ad spend per day | split evenly across that day's jobs |
| Overhead per job | added to every job (insurance, software, phone) |

## How the data is stored

- Money is stored as integer cents and quantities as scaled integers, so totals never pick up rounding errors.
- Each job saves the rates in effect when it was logged, so changing a rate later doesn't change past jobs.
- A day's ad spend is locked in when you log that day's first job. You can change it on the Day tab.
- Removing a job type only hides it from the form. Past jobs keep it, so insights stay accurate.
- Schema changes go through the numbered `MIGRATIONS` list in `db.py`. Existing databases upgrade automatically when the app starts.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/jobs` | create a job |
| GET | `/api/jobs?start=&end=` | list jobs |
| GET/PUT/DELETE | `/api/jobs/<id>` | read / update (partial) / delete |
| GET | `/api/days/<YYYY-MM-DD>` | one day's jobs + totals |
| GET | `/api/summary?start=&end=` | range totals, averages, per-day rollup |
| GET/PUT | `/api/settings` | Setup rates |
| GET/POST | `/api/job-types` | list / add job types |
| PUT/DELETE | `/api/job-types/<id>` | rename / remove (archive) |
| PUT | `/api/days/<YYYY-MM-DD>/ad` | change one day's ad spend |
| GET | `/api/export.csv` | all jobs as CSV |

## Tests

```bash
python -m pytest -q
```
