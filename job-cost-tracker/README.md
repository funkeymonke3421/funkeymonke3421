# Job Cost Tracker

Log what each job costs you (chemicals, gas, time, ad spend, other expenses) in a few taps, and see per-day totals and insights.

## Start it

**Windows:** double-click **`start-windows.bat`**. It installs what's needed, starts the app and opens your browser. Run **`make-desktop-shortcut.bat`** once to get a **Job Cost** icon on your desktop. Close the black window to stop the app.

**Mac / Linux:** run `./start.sh`.

**By hand:**
```bash
pip install -r requirements.txt
python app.py            # or: py app.py on Windows
```
The window shows the address to open on your phone (same Wi-Fi).

**Online, from anywhere:** see [DEPLOY.md](DEPLOY.md) (free on PythonAnywhere).

Data is stored in `data/jobs.db` (SQLite), with a daily copy in `data/backups/`.

## Screens

- **Log**: the quick form.
  - Tap one or more **job types**. Each type's usual chem, time and price fill in (added together if you pick several). Anything you type yourself is never overwritten.
  - Enter the **gallons of chem** used and the **miles driven**, and the app works out the dollars from your Setup rates. Miles fill in automatically with your usual distance between jobs.
  - Tap **Start timer** when you arrive and **stop** when you're done, or use the +15m, +30m and +1h buttons. The timer keeps running if you close the page.
  - Other expenses, one-off ad or lead costs, and notes are under "Other costs & notes".
- **Day**: every job for a date with totals. You can change that day's ad spend here, and edit or delete jobs.
- **Insights**: **this week vs the same days last week**, with the best-earning job type, then totals over 7, 30 or 90 days or the past year, where the money goes, cost and profit **by job type**, a cost-per-day chart and a CSV export.
- **Setup**: job types and their usual amounts, your rates, backups and your login password. Rates:

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

## Login

On your own computer the app is open until you set a password (Setup → Login password). Once a password is set, each device stays logged in for 90 days. Changing the password logs out all other devices.

Online (via `wsgi.py`), a password is always required. Set or reset it with `python app.py set-password`. Wrong guesses are limited to 5 per 15 minutes.

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
| GET | `/api/backups`, `/api/backup.db` | backup info / download a backup |
| GET/POST | `/api/auth`, `/api/login`, `/api/logout` | login |
| PUT | `/api/password` | set / change / remove password |

## Tests

```bash
python -m pytest -q
```
