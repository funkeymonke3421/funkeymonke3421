# Put Job Cost online (PythonAnywhere, free)

When you're done, the app lives at `https://YOURNAME.pythonanywhere.com`. It works on your phone from anywhere, and your computer doesn't need to be on.

- **Cost:** free. On the free plan you click one button every 3 months to keep the site running. PythonAnywhere emails you a reminder.
- **Security:** online, the app always asks for a password, and the login only works over HTTPS.

Replace `YOURNAME` below with your PythonAnywhere username.

---

## 1. Create an account
Sign up at **pythonanywhere.com**. The free **Beginner** plan is enough.

## 2. Get the code
Open the **Consoles** tab and start a **Bash** console. Then run these lines one at a time:

```bash
git clone -b claude/job-cost-tracker https://github.com/funkeymonke3421/funkeymonke3421.git
cd funkeymonke3421/job-cost-tracker
python3.12 -m pip install --user -r requirements.txt
```

If `python3.12` isn't found, use the newest one listed by `ls /usr/bin/python3.*`. Then use that same version everywhere below.

## 3. Set your password (do this before step 4)
```bash
python3.12 app.py set-password
```
Use at least 8 characters. Nothing shows on screen while you type; that's normal.

## 4. Create the web app
1. Open the **Web** tab and click **Add a new web app** → **Next**.
2. Choose **Manual configuration** (not "Flask"), then **Python 3.12**, then **Next**.
3. On the page that opens, under **Code**, click the **WSGI configuration file** link. Delete everything in it and paste:

   ```python
   import sys
   path = "/home/YOURNAME/funkeymonke3421/job-cost-tracker"
   if path not in sys.path:
       sys.path.insert(0, path)
   from wsgi import application
   ```
   Then click **Save**.
4. Back on the **Web** tab, scroll to **Security** and turn on **Force HTTPS**.
5. Click the green **Reload** button at the top.

Open `https://YOURNAME.pythonanywhere.com` and log in.

## 5. Bring your existing jobs (optional)
1. On your computer, **stop the app first** by closing its window. This makes sure every job has been written to the data file.
2. On PythonAnywhere, open the **Files** tab and go to `funkeymonke3421/job-cost-tracker/data/`.
3. Click **Upload a file** and pick `job-cost-tracker\data\jobs.db` from your computer. Replace the file that's there.
4. Your old database doesn't have the online password in it. Set it again in the Bash console (`cd ~/funkeymonke3421/job-cost-tracker`, then `python3.12 app.py set-password`).
5. **Web** tab → **Reload**.

## 6. Add it to your phone's home screen
Open the site on your phone:
- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ menu → **Add to Home screen**

It opens full-screen like an app.

---

## Updating later
When there's a new version, run this in a Bash console:
```bash
cd ~/funkeymonke3421/job-cost-tracker
git pull
python3.12 -m pip install --user -r requirements.txt
```
Then **Web** tab → **Reload**. Your data upgrades automatically.

## Forgot your password?
Run `python3.12 app.py set-password` in a Bash console (in the `job-cost-tracker` folder), then **Reload**.

## Backups
The app saves a dated copy of your data every day in `data/backups/`. You can also download a backup from **Setup → Backups**. Download one now and then, so you have a copy that isn't on PythonAnywhere.

## Things to know
- **Online vs. on your computer:** once you move to PythonAnywhere, log jobs there only. The copy on your computer becomes a separate, old copy.
- **Free plan limits:** fine for one person logging jobs. If it ever feels slow, the paid plan (about $5/month) is faster and doesn't need the 3-month click.
