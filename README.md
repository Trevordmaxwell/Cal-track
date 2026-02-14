# Pocket Balance (PWA)

A cozy, privacy-first calorie + exercise tracker that runs as a **mobile web app / PWA** (works on iPhone, iPad, Android).

**Design goals**
- Extremely fast “one tap” logging (like your Baby Activity Logger UI).
- Multiple input modes: quick buttons, manual entry, plain-language notes, photo capture.
- Local-first storage: data stays on the device unless you export it.
- Easy to extend later (e.g., add AI parsing / chat, wearable sync via a backend).

---

## What’s included (v1)

### Logging
- Food / drink: calories, protein, carbs, fat, fiber, fluids (ml), meal tag
- Exercise: activity, intensity, duration, calories burned (or a tiny estimate)
- Body weight (optional)
- Plain-language notes (brain dump)
- Photo logs (stored as resized JPEG + thumbnail)

### “Today at a glance”
- Calories in, exercise minutes, net calories
- Water, protein, fiber
- Last log time / (optional) most recent weight
- A gentle “nudge” message (hydration / fiber / movement)
- Contact pair timer (manual Start new pair; no auto-renew)

### Insights
- 7-day totals + mini trendlines (sparklines)
- “Copy update” button for a friendly daily summary

### Data
- Export backup JSON (includes photo logs — can get large)
- Export CSV (for spreadsheets)
- Import backup JSON (restore)
- ChatGPT bridge (single AI flow): copy prompt template + paste AI JSON entries back into the app
- Wipe all data

---

## Run it locally (good for development)

From the folder containing `index.html`:

### Option A: Python
```bash
python3 -m http.server 8765
```

Then open:
- On your laptop: `http://localhost:8765`
- On your phone (same Wi‑Fi): `http://YOUR_LAPTOP_IP:8765`

**Note:** iOS treats service workers/offline caching as “secure context only”, so on plain `http://` your app will still run, but **offline mode may not work**. For install + offline, use HTTPS (see next section).

---

## Recommended: host it over HTTPS (best iPhone/iPad PWA experience)

The easiest personal setup is a free static host:
- GitHub Pages
- Netlify
- Cloudflare Pages
- Vercel

Upload these files, then visit the HTTPS link from your wife’s phone.

---

## Install on iPhone (Add to Home Screen)

1. Open the app in **Safari**.
2. Tap the **Share** icon.
3. Tap **Add to Home Screen**.
4. Launch from the new icon.

---

## First-round checks (5 minutes)

1. **Log a quick action** (e.g., Water +250ml) → you should see a toast message.
2. Go to **Today** → totals update.
3. Add a **note** (“lunch was weird”) → it shows up in Recent Activity.
4. Add a **photo log** → open details in Recent Activity and confirm the thumbnail appears.
5. Go to **Insights** → trend cards render.
6. Turn on **Airplane Mode** and launch from Home Screen:
   - If hosted over HTTPS, the app should still open and show your stored logs.

---

## Customize (quick + simple)

### Change quick action buttons
Open `app.js` and edit `DEFAULT_QUICK_ACTIONS`.

Example:
```js
{ id:"fib", emoji:"🌾", label:"Fiber\n+5g", type:"food", payload:{ name:"Fiber boost", calories:0, fiber_g:5 }, theme:3 },
```

### Change the app name
Edit `<title>` in `index.html` and the top header text.

---

## Data + privacy notes
- Data lives in **IndexedDB** on the device (including photo logs).
- If you wipe Safari data or remove the Home Screen app, you may lose the logs.
- Use **Export backup JSON** occasionally as a backup.

---

## Next upgrades (easy wins)
- Favorites editor for quick actions (UI-based, not code-based)
- Barcode scanning (needs a food database + camera flow)
- Optional cloud sync (so both of you can share logs)

Have fun — and keep it gentle.

---

## Mobile ChatGPT workflow (no backend)

This is the fastest setup if you want AI help without running a server:

1. In the app, open **Settings**.
2. In **ChatGPT bridge (easy)**, tap **Process note inbox**.
3. The app copies a prompt that already includes your saved plain-language notes as JSON.
4. Paste that prompt into ChatGPT on your phone and send it.
5. Ask ChatGPT to return JSON only, then copy the response.
6. Back in the app, paste it into **Paste ChatGPT JSON response**.
7. Tap **Preview AI JSON** to sanity-check what will import.
8. Tap **Import + clear copied notes** to finish in one step.

Accepted entry types:
- `food`
- `exercise`
- `note`
- `weight`

Tip: If ChatGPT wraps the response in ```json code fences, the importer will clean that automatically.
