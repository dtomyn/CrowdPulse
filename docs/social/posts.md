# CrowdPulse posts: LinkedIn and Viva Engage

## Images

| File | Size | Use it for |
|---|---|---|
| `crowdpulse-then-now-square.jpg` | 2160×2160 | **LinkedIn**, first image (square fills the most of the feed) |
| `crowdpulse-then-now-wide.jpg` | 3840×2160 (16:9) | **Viva Engage**, first image (shows uncropped in the feed and on a big screen) |
| `crowdpulse-nine-ways-square.jpg` | 2160×2160 | Second image on **both** |

The then-vs-now cards compare the two **rating screens**. On the left is the 2015 web page (smiley, slider, "Use Gyroscope" checkbox). On the right is today's attendee screen on a phone: Tilt selected, reactions and live room mood. Between them is a short "then → now" list. The phone screenshot comes from a live session run by the app's bot audience simulator.

The sources are in `src/`. To re-render them, run CrowdPulse on port 3055 and screenshot `src/then-now.html`, `src/then-now.html#wide` and `src/nine-ways.html` at 2× scale.

---

## LinkedIn

> I lost the source code. I kept the slides. 🙃

In 2015, Joe Hebert, Tom Yarnton and I built a "Social Evaluation™ Rating System" at the PDC Hackathon. The pitch: let an audience rate a talk *while it's happening*, so the presenter gets honest feedback in real time, not three weeks later in a survey nobody fills out.

It had a yellow smiley that went from frown to grin, a slider, a chat box and a checkbox that said "Use Gyroscope". It ran on Azure, Bootstrap 3, SignalR and Firebase, and it was glorious.

11 years later, I dug out the deck and rebuilt the idea with Claude as my pair programmer. Meet **CrowdPulse** ✨

📈 Live crowd mood, chat, Q&A, polls and emoji reaction storms
🧭 A presenter coach that warns you when the room is drifting
🏆 A post-show report with a letter grade, key moments and a word cloud
🤖 A bot audience simulator for rehearsing (they're very supportive)
🎚️ And **nine** ways to rate: slider, smileys, stars, rotary dial, weather, thermometer, thumbs, vibes and… 📱 *tilt*. The 2015 gyroscope checkbox finally grew up.

Same idea. More ideas. More flair. More ways to tell a presenter how you *really* feel.

Thank you, Claude, for turning a nostalgia trip into a weekend I'll remember. And Joe and Tom: the room still has opinions. 😄

How would *you* rate this post? (A slider is fine. A thermometer is better.)

#Hackathon #SideProject #AI #ClaudeCode #DeveloperExperience

**First comment** (LinkedIn shows posts with links in the body to fewer people, so put the links in a comment):
> 🎬 2-minute walkthrough: https://youtu.be/JNMJ8OB89lg
> 💻 Code (open source, runs on your laptop): https://github.com/dtomyn/LocalCrowdRating

---

## LinkedIn article version

**Title:** From One Smiley to Nine Ways to Rate: My 2015 Hackathon App, 11 Years Later

**Cover image:** `crowdpulse-then-now-wide.jpg` (16:9, the shape LinkedIn uses for article covers)

**Body:** the LinkedIn post above, with these changes:
- Put the YouTube and GitHub links in the body. Links in an article don't reduce its reach.
- Put `crowdpulse-nine-ways-square.jpg` after the "nine ways to rate" paragraph.
- Leave out the hashtags. Add them to the share post instead.

### Share post (to go with the article)

> 11 years ago, Joe Hebert, Tom Yarnton and I built an app at a hackathon that let an audience rate a talk while it was happening. It had one smiley, one slider and a "Use Gyroscope" checkbox. 😄
>
> I lost the source code but kept the slides, so I handed them to Claude and rebuilt it. It now has nine ways to rate, including tilting your phone. 📱
>
> The full story (and the then-vs-now screenshots) is in the article. 👇
>
> #Hackathon #SideProject #AI #ClaudeCode

---

## Viva Engage

**Title:** 11 years later, the room still has opinions 🎤📈

Throwback time! 🕰️ At the 2015 PDC Hackathon, Joe Hebert, Tom Yarnton and I built a "Social Evaluation™" app. The idea was simple: the audience rates a session *as it happens*, so presenters get feedback they can actually use, during the talk and after it. Our pitch slide said, word for word, "Everyone has an opinion and want to express it." Grammar optional, enthusiasm mandatory.

The source code is long gone, but the slides survived. So I handed them to Claude, and together we rebuilt it as **CrowdPulse**, with a lot more flair:

- 🎚️ **9 ways to rate**: slider, smileys, stars, dial, weather, thermometer, thumbs, vibes, and **tilt your phone** (yes, the 2015 "Use Gyroscope" checkbox is back, with a "Hold" button so your phone doesn't keep rating from your pocket)
- 💬 Live chat, Q&A with upvotes, polls and emoji storms on every screen
- 🧭 A presenter coach that nudges you when the mood dips or nobody's rating
- 📺 A big-screen stage view with a giant QR code to join
- 🏆 A post-show report with a grade, key moments, NPS and a word cloud
- 🌍 A "Happening now" list, so people can find live sessions without a code

It runs on a laptop and attendees join from their phones on the Wi-Fi, which makes it perfect for lunch-and-learns, demos and town halls.

🎬 Walkthrough video: https://youtu.be/JNMJ8OB89lg
💻 Code: https://github.com/dtomyn/LocalCrowdRating

Huge thanks to Claude for the pair programming, and to Joe and Tom for the original spark. ⚡

👇 **Quick poll:** if you were rating a presentation, which would you pick?
- 🎚️ Slider (classic)
- 🌤️ Weather (how's the forecast in your head?)
- 🌡️ Thermometer (degrees of hype)
- 📱 Tilt (rate it like you're steering a race car)

#Hackathon #Innovation #AI

---

## Before you post
- **Tag people:** @-mention Joe Hebert and Tom Yarnton if they're on LinkedIn or in your Viva Engage network.
- **Event name:** PDC is the name on the slides. If your network knew it by another name, use that instead.
- **Viva Engage poll:** make the four options a real poll (Viva Engage has a Poll post type) and paste the rest as the post text.
- **Screenshots:** the session on the phone is titled "PDC Session – Hackathon Presentation", the same title as the 2015 demo. Its audience is the app's bot simulator, not real people.
