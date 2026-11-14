# CrowdPulse ✨

Real-time audience rating for talks, workshops and meetings. Attendees scan a QR code (or type a 6-character code), rate the session as it happens, chat, ask questions and vote in polls. The presenter gets a live control room, a big-screen stage view and a detailed report afterwards.

See: https://youtu.be/wk60oe0w6Aw

## Run it

```bash
npm install
npm start
```

- Host dashboard: http://localhost:3000/admin
- Attendees: the QR code / join link uses your LAN IP (e.g. `http://192.168.x.x:3000/e/CODE`), so phones on the same Wi-Fi can join.

### Dev container

Open the folder in VS Code and choose **Dev Containers: Reopen in Container**. It installs Node 24 and the dependencies, and forwards port 3000. Run `npm run dev` in the container's terminal and open http://localhost:3000/admin.

Inside a container, CrowdPulse sees the container's own address, not your laptop's, so QR codes point somewhere phones can't reach. To test with phones, set `PUBLIC_URL` to your laptop's address (e.g. `PUBLIC_URL=http://192.168.x.x:3000 npm run dev`) and set VS Code's `remote.localPortHost` to `allInterfaces` so the forwarded port is reachable from your Wi-Fi.

### HTTPS (needed for phone cameras)

Phones only let a page use the camera over `https`. To turn it on, start CrowdPulse with:

```bash
npm run secure
```

That's the whole setup. You don't need to buy or install a certificate. On first run, CrowdPulse makes its own (a *self-signed* certificate) for `localhost`, this computer's name and its current Wi-Fi address, and saves it in `data/certs/`. It's reused for a year, and a new one is made automatically if your laptop gets a different address. QR codes and join links switch to `https://`.

The first time each device opens the page, the browser warns that the connection is "not private". That's expected with a certificate you made yourself:

- **Android / Chrome / Edge:** tap **Advanced** → **Proceed to …**
- **iPhone / Safari:** tap **Show Details** → **visit this website** → **Visit Website**

Once someone accepts it, cameras work and everything else carries on as normal. The startup message prints the certificate's SHA-256 fingerprint if you want to check that phones are talking to your laptop.

The control room and dashboard show the `npm run secure` command, with a Copy button, whenever you turn on attendee cameras while the join link is plain `http`.

No warnings at all? Use a certificate that devices already trust:

- **A tunnel** (free, gives a trusted `https://…` address, needs internet). Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), run `cloudflared tunnel --url http://localhost:3000`, then start CrowdPulse with `PUBLIC_URL` set to the address it prints. Keep using the host dashboard at `http://localhost:3000/admin` on your laptop: requests through the tunnel can't open it unless you set `ADMIN_PIN`.
- **Your own certificate** (for example from [mkcert](https://github.com/FiloSottile/mkcert), with its root installed on each phone). Set `HTTPS_CERT` and `HTTPS_KEY` to the PEM files.

Optional environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default `3000`) |
| `PUBLIC_URL` | Base URL to put in QR codes, e.g. when behind a tunnel or reverse proxy (`https://pulse.example.com`) |
| `HTTPS` | `1` to serve over https (same as `npm run secure`) |
| `HTTPS_CERT`, `HTTPS_KEY` | Paths to your own certificate and key (PEM). Turns on https with them instead of the self-made one |
| `ADMIN_PIN` | Require a PIN to list or create sessions in the host dashboard. Without it, the dashboard only works on the computer running CrowdPulse (requests through a tunnel or proxy don't count as local). It must be at least 6 characters (CrowdPulse won't start with a shorter one). 10 wrong tries locks that address out for 5 minutes, and 30 wrong tries from any mix of devices within 15 minutes pauses PIN sign-in from other devices for 15 minutes. The dashboard on the computer running CrowdPulse always keeps working |

Data is stored in `data/db.json`.

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

**Control room** (`/admin/CODE`)
- Go live / end / reopen, with an elapsed timer that warns when you run over time
- Spring-animated gauge, distribution bars, streaming mood chart (5m / 15m / all)
- **Presenter coach**: alerts when mood drops or spikes, when energy is high, or when few people are rating
- Chapter markers ("Live demo", "Q&A" and so on) that show up on every chart and in the report
- Quick polls with templates, broadcast banners, confetti
- Chat moderation (pin/delete), Q&A moderation (answer, hide, spotlight on every screen)
- 🤖 **Demo audience simulator**: 5–120 bots that rate along a story arc, react, chat, ask, upvote, vote and leave feedback. Useful for rehearsals and demos
- CSV export, reset

**Stage view** (`/stage/CODE`): projector-friendly, with a giant QR code lobby, live gauge, chat ticker, poll overlay, spotlighted questions and reactions.

**Report** (`/report/CODE`)
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

- **No raw data:** no images, video or audio are sent or stored, only the numbers above (`lib/passive.js` drops anything else).
- **No outside code:** the face-analysis code (MediaPipe) is an npm dependency served by CrowdPulse itself, pinned by hash in `package-lock.json`. The face model isn't on npm, so the first time a camera is used, the server downloads it from Google, checks it against a fixed SHA-256 (`lib/models.js`) and keeps it in `data/models/`. After that, cameras work without internet.
- **Crowd figures only:** they appear only once at least **5 people** contribute, so no one can be singled out, and they're exported as crowd figures only.
- **Kept apart from ratings:** passive data is never blended into the rating score. It's shown as its own **Attention** line, so you can see where what people said and what the room showed disagree. The coach flags "polite but distracted" moments.
- **Camera use is visible:** the camera only starts after a click, shows a "camera on" indicator with a Stop button, and previews exactly what is sent.
- **Know the rules where you present:** cameras need HTTPS or localhost (phones on plain `http://` over Wi-Fi can't use them, so start with `npm run secure`; see [HTTPS](#https-needed-for-phone-cameras)). Emotion recognition is restricted in workplaces and education under the EU AI Act, and face data is biometric data under GDPR and laws like Illinois's BIPA. Use these sources only where that's appropriate, and tell the room.

Expression and attention estimates are approximate. Treat them as a hint alongside the ratings, not a verdict. The demo audience simulator produces passive data too, so you can preview everything without real people.

## Explainer video

A narrated walkthrough of the app, filmed from the real pages one exact frame at a time, lives in `film/`:

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

Node.js, Express and Socket.IO, with `qrcode` for QR codes and Chart.js for report charts. The live gauge, streaming chart, backdrop and rating widgets are hand-built in canvas/SVG. There is no build step.

Pages only run script files served by CrowdPulse: every response sends a strict Content Security Policy (no inline scripts, no `eval`), so keep page scripts in `public/js/` rather than in `<script>` blocks or `onclick=` attributes.
