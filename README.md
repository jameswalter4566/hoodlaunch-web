# hoodlaunch-web

Frontend for HoodLaunch — launch and trade Robinhood Chain memecoins straight from a Solana wallet.

- **`/`** — Discover board: New / Graduating / Graduated columns, live from the backend every 5s
- **`/launch`** — token launchpad: Phantom connect → one SOL signature → Relay executes the launch on Robinhood Chain

Plain static site (no build step). Backend: [hoodlaunchbackend](https://github.com/jameswalter4566/hoodlaunchbackend) on Railway (`https://hoodlaunchbackend-production.up.railway.app`, override with `window.HOODLAUNCH_API`).

Deploys to Netlify — `netlify deploy --prod` or connect the repo for auto-deploys.
