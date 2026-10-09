# Rug City

Drive a small red car along the roads of a city play rug (React + three.js via react-three-fiber).
The rug is tiled 5×5 and mirrored at every edge, so the roads connect into one big map.

## Night mode

The moon/sun button (on the start card and in the HUD) switches the city to night: everything goes dark, the car gets headlights, and music plays.

Put your track at `public/assets/night-city.mp3`. If the file is missing, night mode still works, just silently.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173).

## Deploy to GitHub Pages

1. Push this repo to GitHub on the `main` branch.
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` and publishes the site.

The Vite `base` is relative (`./`), so it works under `https://<user>.github.io/<repo>/` with no config.
