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

> 11 years ago, three of us built an app at a hackathon. This weekend I built it again. 🙃

I've been trying out different "software factory" approaches lately, and the hardest part is picking something worth building. While I was brainstorming, a memory surfaced: the PDC Hackathon, over 11 years ago, where Joe Hebert, Tom Yarnton and I built a "Social Evaluation™" app. The pitch: let an audience rate a talk *while it's happening*, so the presenter gets honest feedback in real time, not three weeks later in a survey nobody fills out.

So I made that my test project and built an initial version with Claude as my pair programmer. Then my good friend Tom dug out the original presentation deck and sent it over. It had a yellow smiley that went from frown to grin, a slider, a chat box and a checkbox that said "Use Gyroscope". It ran on Azure, Bootstrap 3, SignalR and Firebase, and it was glorious. We talked through what v2 should have, and a few of those ideas made it in.

Meet **CrowdPulse**, the "11 years later" v2 ✨

📈 Live crowd mood, chat, Q&A, polls and emoji reaction storms
🧭 A presenter coach that warns you when the room is drifting
🏆 A post-show report with a letter grade, key moments and a word cloud
🤖 A bot audience simulator for rehearsing (they're very supportive)
🎚️ And **nine** ways to rate: slider, smileys, stars, rotary dial, weather, thermometer, thumbs, vibes and… 📱 *tilt*. The 2015 gyroscope checkbox finally grew up.

Same idea. More ideas. More flair. More ways to tell a presenter how you *really* feel.

Thank you, Claude, for turning a nostalgia trip into a weekend I'll remember. Tom, thanks for the deck and the ideas. Joe, the room still has opinions. 😄

How would *you* rate this post? (A slider is fine. A thermometer is better.)

#Hackathon #SideProject #AI #ClaudeCode #DeveloperExperience

**First comment** (LinkedIn shows posts with links in the body to fewer people, so put the links in a comment):
> 🎬 2-minute walkthrough: https://youtu.be/JNMJ8OB89lg
> 💻 Code (open source, runs on your laptop): https://github.com/dtomyn/LocalCrowdRating

---

## LinkedIn article version

**Title:** From One Smiley to Nine Ways to Rate: Our 2015 Hackathon App, 11 Years Later

**Cover image:** `crowdpulse-then-now-wide.jpg` (16:9, the shape LinkedIn uses for article covers)

**Body:** the LinkedIn post above, with these changes:
- Put the YouTube and GitHub links in the body. Links in an article don't reduce its reach.
- Put `crowdpulse-nine-ways-square.jpg` after the "nine ways to rate" paragraph.
- Leave out the hashtags. Add them to the share post instead.

### Share post (to go with the article)

> 11 years ago, Joe Hebert, Tom Yarnton and I built an app at a hackathon that let an audience rate a talk while it was happening. It had one smiley, one slider and a "Use Gyroscope" checkbox. 😄
>
> While trying out "software factory" approaches with Claude, I built it again. Then Tom sent me the original deck, we talked through what v2 should have, and it now has nine ways to rate, including tilting your phone. 📱
>
> The full story (and the then-vs-now screenshots) is in the article. 👇
>
> #Hackathon #SideProject #AI #ClaudeCode

---

## Viva Engage

**Title:** 11 years later, the room still has opinions 🎤📈

Throwback time! 🕰️ I've been trying out different "software factory" approaches lately, and while I was hunting for something worth building, a memory surfaced: the PDC Hackathon, over 11 years ago, where Joe Hebert, Tom Yarnton and I built a "Social Evaluation™" app. The idea was simple: the audience rates a session *as it happens*, so presenters get feedback they can actually use, during the talk and after it.

So I made it my test project and built a first version with Claude. Then my good friend Tom dug out the original presentation deck and sent it over. Our pitch slide said, word for word, "Everyone has an opinion and want to express it." Grammar optional, enthusiasm mandatory. We talked through what v2 should have, and the result is **CrowdPulse**, with a lot more flair:

- 🎚️ **9 ways to rate**: slider, smileys, stars, dial, weather, thermometer, thumbs, vibes, and **tilt your phone** (yes, the 2015 "Use Gyroscope" checkbox is back, with a "Hold" button so your phone doesn't keep rating from your pocket)
- 💬 Live chat, Q&A with upvotes, polls and emoji storms on every screen
- 🧭 A presenter coach that nudges you when the mood dips or nobody's rating
- 📺 A big-screen stage view with a giant QR code to join
- 🏆 A post-show report with a grade, key moments, NPS and a word cloud
- 🌍 A "Happening now" list, so people can find live sessions without a code

It runs on a laptop and attendees join from their phones on the Wi-Fi, which makes it perfect for lunch-and-learns, demos and town halls.

🎬 Walkthrough video: https://youtu.be/JNMJ8OB89lg
💻 Code: https://github.com/dtomyn/LocalCrowdRating

Huge thanks to Claude for the pair programming, to Tom for the deck and the v2 ideas, and to Joe and Tom for the original spark. ⚡

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
