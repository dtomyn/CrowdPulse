# CrowdPulse ✨

Real-time audience rating for talks, workshops and meetings. Attendees scan a QR code (or type a 6-character code), rate the session as it happens, chat, ask questions and vote in polls. The presenter gets a live control room, a big-screen stage view and a detailed report afterwards.

See: https://youtu.be/wk60oe0w6Aw

## How it runs

CrowdPulse is a static website plus a [Supabase](https://supabase.com) project. There's no server of your own to keep running:

- **The pages** (`public/`) are plain HTML, CSS and JavaScript. GitHub Pages hosts them (any static host works).
- **Supabase** holds the data (Postgres), signs people in, delivers live updates (Realtime) and builds reports (one Edge Function). All of it fits Supabase's free plan.

Everything Supabase needs is in `supabase/`: the database, its security rules and logic in `supabase/migrations/`, and the report function in `supabase/functions/report/`.

## Set up Supabase (once)

1. **Create a project** at [supabase.com](https://supabase.com) and put its Project URL and publishable key in `public/js/config.js`. Both are meant to be public. Never put the secret (`service_role`) key or the database password in the site.
2. **Sign-in settings** (dashboard → Authentication):
   - *Sign In / Providers*: turn on **Allow anonymous sign-ins** (attendees join without an account) and keep **Email** on (hosts sign in with a link).
   - *URL Configuration*: set the **Site URL** to the published site (for example `https://<you>.github.io/CrowdPulse/`) and add these **Redirect URLs**: `https://<you>.github.io/CrowdPulse/**` and `http://localhost:3000/**`.
   - *Rate Limits*: raise **anonymous sign-ins per hour** (default 30 per IP address) to more than your biggest audience, for example 1000. Everyone on a venue's Wi-Fi usually shares one IP address, so the default would turn people away after the 30th phone.
   - *Emails → SMTP Settings*: set up your own email provider (Resend, Postmark, SendGrid, Amazon SES and so on). Supabase's built-in email service sends only **2 emails per hour for the whole project**, and every host sign-in link counts. Once the limit is reached, hosts see "Too many sign-in emails were sent recently". With custom SMTP set up, raise **Rate limit for sending emails** under *Rate Limits* (for example to 30 per hour). Separately, each address must wait 60 seconds between links.
3. **Create the database and the report function.** You'll need the database password from when you created the project:

   ```bash
   npx supabase login
   ```

   ```bash
   npx supabase link --project-ref <project-ref>
   ```

   ```bash
   npx supabase db push --remote
   ```

   ```bash
   npx supabase functions deploy report
   ```

   The project ref is the part of the Project URL before `.supabase.co`. Without `--remote`, `db push` goes to the local Docker database (the CLI's default). Run `db push --remote` again whenever `supabase/migrations/` changes, and `functions deploy report` whenever the report function changes.
4. **Say who can host.** Only email addresses on the host list can create sessions. Add yours in the dashboard's SQL Editor:

   ```sql
   insert into public.hosts (email) values ('you@example.com');
   ```

## Publish on GitHub Pages

In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. Every push to `main` then builds the site (`npm run build`) and publishes it with `.github/workflows/pages.yml`, at `https://<you>.github.io/CrowdPulse/`. You can also run the workflow by hand from the **Actions** tab. On the free GitHub plan, Pages needs a public repository.

Then:

- **Hosts** open `admin.html` (the 🎤 Host dashboard link on the home page) and sign in with their email.
- **Attendees** scan the QR code or type the code on the home page. Pages always uses https, so phone cameras work without any certificate setup.

## Deploying changes

The site and Supabase are deployed separately. Pushing to `main` updates only the pages.

| What changed | How to deploy it |
|---|---|
| `public/`, `scripts/` or dependencies | Merge or push to `main`. The Pages workflow builds and publishes the site in a minute or two. |
| `supabase/migrations/` | `npx supabase db push --remote` (needs the database password) |
| `supabase/functions/report/` or `supabase/functions/_shared/` | `npx supabase functions deploy report` |
| Sign-in, email and rate-limit settings | The Supabase dashboard (Authentication). `supabase/config.toml` configures only the local stack. |

If a change touches both the database and the pages, push the migration first, so the published pages never call a function the database doesn't have yet.

To build the site for a different Supabase project, set `SUPABASE_URL` and `SUPABASE_KEY` (its publishable key) when running `npm run build` or `npm run dev`. Without them, the pages use `public/js/config.js`.

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

This serves the pages at http://localhost:3000, connected to the Supabase project in `public/js/config.js`. Edit a file and reload to see the change.

To work without touching that project, run Supabase on your computer (needs [Docker](https://www.docker.com/)):

```bash
npm run db:start
```

```bash
npx supabase functions serve
```

```bash
npm run dev:local
```

`db:start` creates the database from `supabase/migrations/`, and `dev:local` points the pages at it. Add a host with the SQL above in the local Studio (http://127.0.0.1:54323). Sign-in emails don't leave your computer: open them in Mailpit at http://127.0.0.1:54324. `npm run db:reset` starts the local database over.

### Dev container

Open the folder in VS Code and choose **Dev Containers: Reopen in Container**. It installs Node 24 and the dependencies, and forwards port 3000. Run `npm run dev` in the container's terminal and open http://localhost:3000.

The container talks to the Supabase project in `public/js/config.js`. The local Supabase stack (`npm run db:start`) needs Docker, which isn't available inside the container, so run that one on your computer instead. Join links and QR codes point at the address in your browser (`localhost`), which phones can't reach. To test with phones, use the published site.

## How it's secured

- **Everyone has a session.** Attendees are signed in anonymously in the background, so each phone has its own identity without an account. Hosts sign in by email, and only addresses in `public.hosts` can create sessions.
- **The database is closed to the browser.** Row Level Security is on for every table with no policies, so browsers can't read or write tables directly. They can only call the functions granted at the end of the migration, and each one checks who's calling and validates its input: lengths, ranges, a profanity filter, and per-person rate limits on chat, reactions, questions and votes.
- **Admins are tracked per session.** Whoever creates a session runs it. The 🔑 **Co-host link** in the dashboard lets someone else (or another laptop) run it too. Its key travels in the link's `#fragment`, so it's never sent to any server.
- **Live updates use private channels.** Everyone in a session can listen on its channel, and only its admins can listen on the admin channel. Only the database sends on them.
- **People are identified by a public id.** Chat, Q&A and reports show a random public id, never anyone's account id.
- **Per-person passive data stays in the database.** The report function reads it with the service role and returns only crowd figures. Only hosts can download the raw CSV.
- **Pages only run their own scripts.** Each page sets a strict Content Security Policy (no inline scripts, no `eval`), so keep page scripts in `public/js/`, not in `<script>` blocks or `onclick=` attributes.

### Free-plan limits worth knowing

- A free Supabase project **pauses after a week with no activity**. Open the dashboard and restore it before an event, or keep it busy.
- Live updates count against the free plan's monthly **Realtime messages**. The live pulse goes out every 2 seconds, and reactions ride along with it to save messages. Very large or very long sessions use the most.

## Features

**Hosting**
- Create sessions with a title, description, presenter, date/time, duration and accent colour
- Location: **In person** (venue + address), **Virtual** (meeting link) or **Hybrid** (both)
- Each session gets a 6-character join code (no confusable 0/O/1/I) and a QR code
- Feature toggles: chat, Q&A, reactions, show the crowd mood to attendees, share the report with attendees, list on the home page
- **Happening now**: sessions the host chooses to list (off by default) appear on the home page, live ones first, then those starting in the next 7 days, so people can join without a code. The list shows the title, presenter, venue, how many are in the room and, if the host shares it with attendees, the crowd mood
- Duplicate or delete sessions

**Attendees** (mobile-first)
- 9 rating styles, all mapped to 0–100: 🎚️ Slider (default), 😊 Smileys, ⭐ Stars, 🎛️ Rotary dial, 🌤️ Weather, 🌡️ Thermometer, 👍 Thumbs (tap to nudge), 🔮 Vibes orbit, 📱 Tilt (tap Start, tilt the phone left or right, tap Hold to keep the rating; iPhones ask for motion access, which needs https; devices without a motion sensor drag the bubble instead)
- Emoji reaction storms that float across every screen
- Live chat with typing indicators, pinned messages and host badges
- Q&A with upvotes, polls with animated results
- Live crowd gauge, mood distribution, energy and trend, plus how your rating compares with the room
- Lobby countdown before the start; at the end, a feedback form (stars, NPS, detail ratings, one word, comment)
- Custom name, avatar and colour

**Control room** (`control.html?code=CODE`)
- Go live / end / reopen, with an elapsed timer that warns when you run over time
- Spring-animated gauge, distribution bars, streaming mood chart (5m / 15m / all)
- **Presenter coach**: alerts when mood drops or spikes, when energy is high, or when few people are rating
- Chapter markers ("Live demo", "Q&A" and so on) that show up on every chart and in the report
- Quick polls with templates, broadcast banners, confetti
- Chat moderation (pin/delete), Q&A moderation (answer, hide, spotlight on every screen)
- 🤖 **Demo audience simulator**: 5–120 bots that rate along a story arc, react, chat, ask, upvote, vote and leave feedback. Useful for rehearsals and demos. The bots run in the control room, so they stop when you close it
- CSV export, reset
- 🔑 Co-host link: lets someone else run the session from their own device

**Stage view** (`stage.html?code=CODE`): projector-friendly, with a giant QR code lobby, live gauge, chat ticker, poll overlay, spotlighted questions and reactions. Before and after the session, press **Esc** or **✕** to hide the lobby or "That's a wrap" screen and see the dashboard behind it. Press Esc again to bring it back.

**Report** (`report.html?code=CODE`)
- Animated letter grade and overall score
- KPIs: attendees, peak online, average/median/σ, final mood, ratings, reactions, messages, questions, engagement
- Auto-written insights
- Mood timeline with chapter markers and audience size
- Time spent in each mood zone, volatility, highs and lows
- **Key moments**: biggest peaks and dips, with the chat and reactions around them
- Per-chapter breakdown, rating histogram, most popular rating styles
- Engagement funnel, reactions breakdown, chat activity and sentiment over time
- Word cloud, star distribution, NPS, detail-rating radar, comments
- Top contributors leaderboard, questions, poll results
- Export to PDF (print), CSV and JSON

## Passive signals

Besides what people rate, CrowdPulse can show what the room shows without anyone pressing a button. The host turns each source on per session (in the new-session form or the control room's Live settings):

| Source | Default | Where it runs | What leaves the device |
|---|---|---|---|
| 👀 Tab focus | On | Each attendee's page | How much of the last few seconds the session tab was in view, and an interaction count |
| 📷 Attendee cameras | Off, and each attendee opts in | Each attendee's own device (MediaPipe face analysis in the browser) | Three numbers: attention, positive expression, fatigue |
| 🎙️ Room sensor | Off | The presenter's laptop camera and microphone | Faces counted and how many look forward, plus laughter, applause and loudness estimates |

How it's kept safe:

- **No raw data:** no images, video or audio are sent or stored, only the numbers above (the database functions drop anything else).
- **No outside code:** the face-analysis code (MediaPipe) is an npm dependency published with the site, pinned by hash in `package-lock.json`. The face model isn't on npm, so the build downloads it from Google, checks it against a fixed SHA-256 (`scripts/vendor.mjs`) and publishes it with the site.
- **Crowd figures only:** they appear only once at least **5 people** contribute, so no one can be singled out, and they're exported as crowd figures only.
- **Kept apart from ratings:** passive data is never blended into the rating score. It's shown as its own **Attention** line, so you can see where what people said and what the room showed disagree. The coach flags "polite but distracted" moments.
- **Camera use is visible:** the camera only starts after a click, shows a "camera on" indicator with a Stop button, and previews exactly what is sent.
- **Know the rules where you present:** cameras need HTTPS or localhost, which the published site always has. Emotion recognition is restricted in workplaces and education under the EU AI Act, and face data is biometric data under GDPR and laws like Illinois's BIPA. Use these sources only where that's appropriate, and tell the room.

Expression and attention estimates are approximate. Treat them as a hint alongside the ratings, not a verdict. The demo audience simulator produces passive data too, so you can preview everything without real people.

## Explainer video

A narrated walkthrough of the app, filmed from the real pages one exact frame at a time, lives in `film/`.

> **Needs updating:** the film pipeline still drives the old Node server (`server.js` and `lib/`), which the Supabase version replaced. To re-render the film, use the last commit before the move to Supabase until the pipeline is ported.


- `film/studio/director.js`: the scenes, narration, camera moves (zoom-ins), cursor and overlays
- `film/studio/shim.js`: runs every page on a virtual clock (timers, animation frames and CSS animations) so frames are deterministic
- `film/studio/fakeserver.js`: an in-page stand-in for the socket server with a scripted audience
- `film/render.py`: makes the voice, renders the frames, adds a music bed and sound effects, and mixes everything

The voice is Kokoro `af_heart` at speed 0.97, the same as the IRISIdeas explainer. The script uses that project's virtualenv and model files:

```bash
C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render.py --storyboard
```

```bash
C:/DevSource/IRISIdeas/.venv/Scripts/python.exe film/render.py
```

The report scene shows a reproducible 30-minute session built by `node film/fixture.js` (saved as `film/fixture/db.json`). It runs every second through the app's own passive-signal code, so the report includes passive signals, "engaged but critical" and "polite but distracted" stretches, and laughter peaks. Use `--data` and `--code` to film another session instead.

`--storyboard` writes `film/out/storyboard.html`, `script.md` and captions in a few minutes. The default run writes the 2560×1440 video `film/out/crowdpulse-explainer.mp4` (add `--share` for a 1080p copy), the storyboard built from master frames, captions (`.srt`) and a thumbnail. `--preview` makes a quick 960×540 version. The film's server reads a copy of the data, so your own sessions in `data/` are never touched. To replace a synthetic line with a real recording, save `film/vo/recorded/<id>.wav` (ids are in `script.md`), and the picture retimes to fit.

## Stack

Static HTML, CSS and JavaScript (no framework), with Supabase for the database, sign-in, Realtime and the report function (`@supabase/supabase-js`), `qrcode-generator` for QR codes made in the browser and Chart.js for report charts. The live gauge, streaming chart, backdrop and rating widgets are hand-built in canvas/SVG. The build (`npm run build`) only copies files into `dist/`: `public/`, the libraries from `node_modules` and the face model.

In the browser, `public/js/supa.js` gives the pages a small socket.io-style connection: `socket.emit(...)` calls a database function and `socket.on(...)` receives a Realtime broadcast. The database works out the live pulse (`cp_tick`) every 2 seconds. The control room and stage screen keep it going, and attendee pages step in if both are closed.
