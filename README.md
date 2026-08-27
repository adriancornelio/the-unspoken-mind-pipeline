# The Unspoken Mind — Content Pipeline

Automated faceless-reel pipeline: generates a psychology-niche script, picks a music
track from your Drive rotation, renders a branded 15-30s vertical video, and (once
wired up) uploads to YouTube.

## Pipeline stages

1. **`scripts/generate_script.mjs`** — calls Gemini 3.6 Flash to write a hook + 3 points
   + CTA in the locked "The Unspoken Mind" voice, rotating across 5 topic lanes
   (`lib/topics.mjs`): dark psychology, persuasion, body language, cognitive biases,
   attachment psychology. **Confirmed working against a live key.**
2. **`scripts/fetch_music_drive.mjs`** — round-robins through the mp3s in your Google
   Drive music folder (currently 6 Mixkit tracks) and downloads the next one in
   sequence. **Rotation logic confirmed correct; Drive auth not yet tested against a
   real service account (see caveats below).**
3. **`src/Reel.tsx`** (rendered via Remotion) — the actual video: dark charcoal
   background, cold-blue highlighted keywords, serif hook/point text, watermark, signal
   ping, tag pill, progress bar, 1080×1920 vertical. **Confirmed working**, including
   with a real downloaded track muxed in.
4. **`scripts/upload_youtube.mjs`** — **not built yet**. The OAuth *setup* is ready
   (see below), but the actual upload call still needs to be written once you have
   your `YOUTUBE_REFRESH_TOKEN`.
5. **`scripts/run_pipeline.mjs`** — orchestrates 1→3 in order. This is what the
   scheduled GitHub Action calls.

## Getting your YOUTUBE_REFRESH_TOKEN (one-time, local, by hand)

`scripts/get_youtube_refresh_token.mjs` is a **local-only helper — never runs in CI,
never commits anything**. Run it once on your own machine:

```bash
npm install
YOUTUBE_CLIENT_ID=your-client-id YOUTUBE_CLIENT_SECRET=your-client-secret node scripts/get_youtube_refresh_token.mjs
```

(Windows Command Prompt: use `set YOUTUBE_CLIENT_ID=...` and `set YOUTUBE_CLIENT_SECRET=...`
on their own lines first, instead of the inline `VAR=value` syntax above.)

It opens your browser to Google's consent screen — sign in as the account that owns
The Unspoken Mind channel — and prints only the refresh token to your terminal. Copy
that into GitHub Secrets as `YOUTUBE_REFRESH_TOKEN`. Nothing is written to disk.

## Required secrets (set as GitHub repo secrets)

| Secret | Where to get it | Free? |
|---|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com | Yes, no card required |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Cloud Console — see setup below | Yes |
| `MUSIC_FOLDER_ID` | Your Drive music folder's ID (optional — defaults to the folder already in use) | — |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` | Google Cloud Console (YouTube Data API v3) | Yes |

### Setting up Drive access (one-time)

The scheduled GitHub Action runs unattended, so it needs its own login to your Drive
folder — a **service account** (a "robot" credential), not your personal Google login.

1. Google Cloud Console → create/reuse a project → enable the **Google Drive API**.
2. IAM & Admin → Service Accounts → Create Service Account → create a **JSON key**
   for it. This file's contents are what go in the `GOOGLE_SERVICE_ACCOUNT_KEY` secret.
3. Open your Drive music folder → Share → paste the service account's email (looks
   like `xxx@xxx.iam.gserviceaccount.com`, found in the JSON key as `client_email`) →
   give it **Viewer** access.
4. In your GitHub repo: Settings → Secrets → Actions → add `GOOGLE_SERVICE_ACCOUNT_KEY`
   with the entire JSON file's contents as the value.

## Running locally

```bash
npm install
GEMINI_API_KEY=xxx GOOGLE_SERVICE_ACCOUNT_KEY='{...}' node scripts/run_pipeline.mjs
```

Output video lands in `out/script-XXX.mp4`.

To preview/tweak the visual design interactively:

```bash
npm run start   # opens Remotion Studio
```

## Honest caveats — things that need verification before this runs unattended

- **`fetch_music_drive.mjs`'s round-robin logic is confirmed correct** (tested against
  the real file list — cycles through all 6 tracks in order, then wraps around), but
  the actual Drive API authentication path (service account → `googleapis` client) is
  written correctly per Google's docs but **not yet run against a real service account
  key** — worth a manual first run once you've set one up, before trusting it
  unattended.
- **`generate_script.mjs` is confirmed working** against your real Gemini key —
  including catching and fixing a model deprecation (`gemini-2.5-flash` →
  `gemini-3.6-flash`) along the way.
- **The render pipeline is confirmed working end-to-end**, including with a real
  downloaded Mixkit track muxed into the final video.
- **Two of the six tracks currently in the Drive folder** (`mixkit-acid-party-420.mp3`,
  `mixkit-sad-jazz-649.mp3`) may not match the locked cinematic/moody tone — worth a
  listen before the rotation reaches them.
- **The GitHub Actions cron (`0 14 */2 * *`) is an approximation of "every other day,"**
  not exact — cron's day-of-month field can produce a 1-day or 3-day gap at month
  boundaries. Fine for this use case, just flagging it's not perfectly metronomic.
- **YouTube upload isn't built** — current pipeline stops after rendering. Send API
  credentials when ready and this is a quick add (YouTube Data API v3's
  `videos.insert` endpoint).

## Manual review vs. autonomous posting

Right now, nothing auto-posts (upload step isn't built). Once it is, recommend running
with manual review for the first 1-2 weeks (check the artifact before it posts) before
switching to fully autonomous.
