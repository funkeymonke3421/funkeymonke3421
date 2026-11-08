# Shine Quote — linear-foot pricing app for Shine Permanent Lighting

A clean, phone-first app for showing clients their price instead of the calculator.

- Set your **price per foot** once.
- Add **sections** (Full House, Half House, Front, Back, Sides, Garage, or custom). Each section can use its own rate, or leave the rate blank to use the default.
- The total updates live, with a smooth count-up.
- Tap **Show Client** for a clean presentation screen with your company name, the client's name, the date, a line-by-line breakdown and the total.
- Everything saves on the device automatically. Tap **New quote** to clear it.
- Logo lives in `public/logo.png`; brand colors are the variables at the top of `app/globals.css`.

## Deploy on Vercel
1. Go to vercel.com, click **Add New → Project**, and import this GitHub repo.
2. Set **Root Directory** to `quote-app`. Vercel picks up Next.js on its own.
3. Click **Deploy**.
4. On your iPhone, open the URL in Safari, tap **Share → Add to Home Screen**. It opens full-screen like a native app.

## Run locally
```bash
cd quote-app
npm install
npm run dev
```
