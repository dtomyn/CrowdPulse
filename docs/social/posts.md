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

I rebuilt an app three of us made at a hackathon 11 years ago. It lets a room rate your talk while you're still giving it. This time it has nine ways to vote, including tilting your phone.

See it in action: https://youtu.be/wk60oe0w6Aw?si=5E_EMmn0PxNaR065

How it came about:

I've been trying out different "software factory" approaches lately, mostly on evenings and weekends, and the hardest part is picking something worth building. Then a memory surfaced: back in 2015, my company at the time, Solvera (since bought by Accenture), ran a Professional Development Conference (PDC) Hackathon, where Joseph Herbert, Tom Yarnton and I built a "Social Evaluation™" app.

The pitch: let the audience rate a talk while it's happening, so the presenter gets honest feedback in real time instead of a survey three weeks later that nobody fills out.

So I rebuilt it with Claude. The source on Bitbucket is long gone, but Tom dug out the original deck. The 2015 version was a yellow smiley you dragged from frown to grin, a live chat, and a gyroscope mode: tilt your phone and the smiley follows. Azure, Bootstrap 3, SignalR, Firebase. Glorious. Tom and I swapped ideas for v2, and some of them made it in.

Meet CrowdPulse, the "11 years later" edition:

- Live crowd mood, chat, Q&A, polls and emoji reaction storms
- A presenter coach that warns you when the room is drifting
- A post-show report with a letter grade, key moments and a word cloud
- A bot audience for rehearsing (very supportive, suspiciously so)
- Nine ways to rate: slider, smileys, stars, dial, weather, thermometer, thumbs, vibes and tilt. The gyroscope checkbox finally grew up.

Same idea, more flair, more ways to tell a presenter how you really feel.

Thanks, Claude, for turning a nostalgia trip into a weekend I'll remember. Tom, thanks for the deck and the ideas. Joe, the room still has opinions. 😄

#Hackathon #SideProject #AI #ClaudeCode #DeveloperExperience

**Links:** the video link is in the body because you asked for it there. LinkedIn tends to show posts with links to fewer people, so if reach matters more, move it to a first comment along with the code link:
> Code (open source, runs on your laptop): https://github.com/dtomyn/CrowdPulse

---

## LinkedIn, alternative: "what would you bring back?"

Same story, different ending. This version asks readers about their own decade-old projects, so it tends to get comments rather than just likes. Use one or the other, not both.

> Everyone has a project from a decade ago they still think about. Mine had a smiley face. 🙃

I've been trying out different "software factory" approaches lately, and the hardest part is picking something worth building. While I was brainstorming, a memory surfaced: the PDC Hackathon, over 11 years ago, where Joe Herbert, Tom Yarnton and I built a "Social Evaluation™" app. The pitch: let an audience rate a talk *while it's happening*, so the presenter gets honest feedback in real time, not three weeks later in a survey nobody fills out.

So I made that my test project and built an initial version with Claude as my pair programmer. Then my good friend Tom dug out the original presentation deck and sent it over. It had a yellow smiley that went from frown to grin, a slider, a chat box and a checkbox that said "Use Gyroscope". It ran on Azure, Bootstrap 3, SignalR and Firebase, and it was glorious. We talked through what v2 should have, and a few of those ideas made it in.

Meet **CrowdPulse**, the "11 years later" v2 ✨

📈 Live crowd mood, chat, Q&A, polls and emoji reaction storms
🧭 A presenter coach that warns you when the room is drifting
🏆 A post-show report with a letter grade, key moments and a word cloud
🤖 A bot audience simulator for rehearsing (they're very supportive)
🎚️ And **nine** ways to rate: slider, smileys, stars, rotary dial, weather, thermometer, thumbs, vibes and… 📱 *tilt*. The 2015 gyroscope checkbox finally grew up.

The idea aged better than the stack. That seems to be the pattern: the thing you were excited about ten years ago was usually a good idea that was just expensive to build at the time.

Thank you, Claude, for turning a nostalgia trip into a weekend I'll remember. Tom, thanks for the deck and the ideas. Joe, the room still has opinions. 😄

**Now your turn.** 👇 What did you build, pitch or sketch a decade ago that deserves a second life? A hackathon app, a side project, a "someday" idea on a whiteboard, a tool your team used and lost. Have you brought one back recently? Tell me what it was, and what changed when you rebuilt it. I'd love to see the then-vs-now.

#Hackathon #SideProject #AI #ClaudeCode #DeveloperExperience

**Links:** same as the main post above.

---

## LinkedIn article version

**Title:** From One Smiley to Nine Ways to Rate: Our 2015 Hackathon App, 11 Years Later

**Cover image:** `crowdpulse-then-now-wide.jpg` (16:9, the shape LinkedIn uses for article covers)

**Body:** the LinkedIn post above, with these changes:
- Put the YouTube and GitHub links in the body. Links in an article don't reduce its reach.
- Put `crowdpulse-nine-ways-square.jpg` after the "nine ways to rate" paragraph.
- Leave out the hashtags. Add them to the share post instead.

### Share post (to go with the article)

> 11 years ago, Joe Herbert, Tom Yarnton and I built an app at a hackathon that let an audience rate a talk while it was happening. It had one smiley, one slider and a "Use Gyroscope" checkbox. 😄
>
> While trying out "software factory" approaches with Claude, I built it again. Then Tom sent me the original deck, we talked through what v2 should have, and it now has nine ways to rate, including tilting your phone. 📱
>
> The full story (and the then-vs-now screenshots) is in the article. 👇
>
> #Hackathon #SideProject #AI #ClaudeCode

---

## Viva Engage

**Title:** 11 years later, the room still has opinions 🎤📈

Throwback time! 🕰️ I've been trying out different "software factory" approaches lately, and while I was hunting for something worth building, a memory surfaced: the PDC Hackathon, over 11 years ago, where Joe Herbert, Tom Yarnton and I built a "Social Evaluation™" app. The idea was simple: the audience rates a session *as it happens*, so presenters get feedback they can actually use, during the talk and after it.

So I made it my test project and built a first version with Claude. Then my good friend Tom dug out the original presentation deck and sent it over. Our pitch slide said, word for word, "Everyone has an opinion and want to express it." Grammar optional, enthusiasm mandatory. We talked through what v2 should have, and the result is **CrowdPulse**, with a lot more flair:

- 🎚️ **9 ways to rate**: slider, smileys, stars, dial, weather, thermometer, thumbs, vibes, and **tilt your phone** (yes, the 2015 "Use Gyroscope" checkbox is back, with a "Hold" button so your phone doesn't keep rating from your pocket)
- 💬 Live chat, Q&A with upvotes, polls and emoji storms on every screen
- 🧭 A presenter coach that nudges you when the mood dips or nobody's rating
- 📺 A big-screen stage view with a giant QR code to join
- 🏆 A post-show report with a grade, key moments, NPS and a word cloud
- 🌍 A "Happening now" list, so people can find live sessions without a code

It runs on a laptop and attendees join from their phones on the Wi-Fi, which makes it perfect for lunch-and-learns, demos and town halls.

🎬 Walkthrough video: https://youtu.be/JNMJ8OB89lg
💻 Code: https://github.com/dtomyn/CrowdPulse

Huge thanks to Claude for the pair programming, to Tom for the deck and the v2 ideas, and to Joe and Tom for the original spark. ⚡

👇 **Quick poll:** if you were rating a presentation, which would you pick?
- 🎚️ Slider (classic)
- 🌤️ Weather (how's the forecast in your head?)
- 🌡️ Thermometer (degrees of hype)
- 📱 Tilt (rate it like you're steering a race car)

#Hackathon #Innovation #AI

---

## Before you post
- **Tag people:** @-mention Joe Herbert and Tom Yarnton if they're on LinkedIn or in your Viva Engage network.
- **Event name:** PDC is Solvera's Professional Development Conference. The main LinkedIn post spells it out; the other posts just say PDC.
- **Viva Engage poll:** make the four options a real poll (Viva Engage has a Poll post type) and paste the rest as the post text.
- **Screenshots:** the session on the phone is titled "PDC Session – Hackathon Presentation", the same title as the 2015 demo. Its audience is the app's bot simulator, not real people.
