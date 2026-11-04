# CrowdPulse ✨

Real-time audience rating for talks, workshops and meetings. Attendees scan a QR code (or type a 6-character code), rate the session as it happens, chat, ask questions and vote in polls. The presenter gets a live control room, a big-screen stage view and a detailed report afterwards.

See: https://youtu.be/JNMJ8OB89lg

## Run it

```bash
npm install
npm start
```

- Host dashboard: http://localhost:3000/admin
- Attendees: the QR code / join link uses your LAN IP (e.g. `http://192.168.x.x:3000/e/CODE`), so phones on the same Wi-Fi can join.

Optional environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default `3000`) |
| `PUBLIC_URL` | Base URL to put in QR codes, e.g. when behind a tunnel or reverse proxy (`https://pulse.example.com`) |
| `ADMIN_PIN` | Require a PIN to list or create sessions in the host dashboard |

Data is stored in `data/db.json`.

## Features

**Hosting**
- Create sessions with a title, description, presenter, date/time, duration and accent colour
- Location: **In person** (venue + address), **Virtual** (meeting link) or **Hybrid** (both)
- Each session gets a 6-character join code (no confusable 0/O/1/I) and a QR code
- Feature toggles: chat, Q&A, reactions, show the crowd mood to attendees, share the report with attendees
- Duplicate or delete sessions

**Attendees** (mobile-first)
- 8 rating styles, all mapped to 0–100: 🎚️ Slider (default), 😊 Smileys, ⭐ Stars, 🎛️ Rotary dial, 🌤️ Weather, 🌡️ Thermometer, 👍 Thumbs (tap to nudge), 🔮 Vibes orbit
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

`--storyboard` writes `film/out/storyboard.html`, `script.md` and captions in a few minutes. The default run writes the 2560×1440 master `film/out/crowdpulse-explainer.mp4`, a 1080p copy, the storyboard built from master frames, captions (`.srt`) and a thumbnail. `--preview` makes a quick 960×540 version. The report scene shows the real report of the session given by `--code` (default `E33JW2`), and reads a copy of `data/db.json`. To replace a synthetic line with a real recording, save `film/vo/recorded/<id>.wav` (ids are in `script.md`), and the picture retimes to fit.

## Stack

Node.js, Express and Socket.IO, with `qrcode` for QR codes and Chart.js for report charts. The live gauge, streaming chart, backdrop and rating widgets are hand-built in canvas/SVG. There is no build step.
