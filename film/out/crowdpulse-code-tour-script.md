# CrowdPulse code tour: narration script

4:43 in all. Voice: Kokoro `af_heart` at speed 0.97 (the explainer's voice). Written by `film/render_tour.py` from `film/tour/tour.js`. To replace a line with a real recording, save it as `film/vo/recorded/<id>.wav`.

## 0:00 Cold open

**Code (left):** home.js: the loop that animates the home page demo

**App (right):** The home page on a phone, its demo gauge moving

**Sound:** Music swells in; whoosh on the title

`0:00` `code-open-1` This is CrowdPulse, from the inside. On the right, the app, running. On the left, the code that’s running it.

`0:09` `code-open-2` This isn’t a line by line walkthrough. It’s a map: how the code is laid out, and what runs when the app does its main jobs.

## 0:18 How the code is laid out

**Code (left):** The Explorer, event.html’s script tags, then the SQL migration

**App (right):** A map of the code builds up: six pages, two helpers, and Supabase

**Sound:** Whoosh on the chapter card

`0:18` `code-map-1` Start with the layout. Everything the browser loads is in the public folder: six plain HTML pages, with one script for each. No framework, and the build just copies files.

`0:30` `code-map-2` Every page loads the same two helpers before its own script. common.js draws the shared pieces, like the gauge and the chart. supa.js is the connection to the back end.

`0:44` `code-map-3` The back end is Supabase, and almost all of it is one SQL file: the tables, the security rules, and a function for every action. There’s no server of our own to run.

## 0:56 One connection, two directions

**Code (left):** supa.js: CP.connect, emit and the Realtime listener

**App (right):** The map: calls go up through database functions, broadcasts come back down

**Sound:** Soft ticks as lines light up

`0:56` `code-conn-1` One idea holds it all together, and it lives in supa.js. Every page asks for a connection, and gets back a small socket with two methods.

`1:07` `code-conn-2` Emit sends something up. Each name maps to a database function: join, an admin action, or anything else an attendee does.

`1:16` `code-conn-3` And on listens for what comes back down: a Realtime broadcast, on a private channel that belongs to this one session.

`1:24` `code-conn-4` Up through a function, down through a broadcast. Every feature in the app is a variation on that loop.

## 1:31 Joining a session

**Code (left):** home.js, then event.js beside the cp_join function

**App (right):** An attendee types the join code, picks a profile and lands in the lobby

**Sound:** Key taps, clicks

`1:32` `code-join-1` Watch it happen. An attendee types a join code on the home page. home.js asks the database whether that session exists, then opens the attendee page.

`1:43` `code-join-2` There, event.js connects and emits join. In the database, cp_join records the participant, and hands back a snapshot: everything the page needs to draw itself.

`1:56` `code-join-3` From then on, the page keeps that snapshot as its state, and render functions turn state into screen. The session hasn’t started, so it draws the lobby.

## 2:06 Going live

**Code (left):** control.js, the cp_admin function, then event.js’s event listener

**App (right):** The host presses Go live in the control room; the phone flips to rating

**Sound:** Click, pop

`2:06` `code-live-1` Now the host. In the control room, the Go live button emits admin start.

`2:13` `code-live-2` In the database, cp_admin checks that the caller really is an admin of this session, flips the status to live, and broadcasts the new event to everyone.

`2:24` `code-live-3` On the phone, the event listener sees the status change and renders again. The lobby becomes the rating screen. Nobody refreshed anything.

## 2:33 The live pulse

**Code (left):** event.js’s sendRating, cp_act and cp_do_rate, then cp_tick and the pulse listeners

**App (right):** A slider drag on the phone; the big screen’s gauge follows every two seconds

**Sound:** Soft ticks on every call and broadcast

`2:33` `code-pulse-1` Here’s the heart of it. Dragging the slider calls send rating, which waits a quarter of a second, then emits rate.

`2:42` `code-pulse-2` cp_act routes it to cp_do_rate, which stores the number against that participant. Notice what it doesn’t do: it doesn’t tell anyone.

`2:52` `code-pulse-3` That’s the job of cp_tick. Every two seconds, the control room and the big screen call it. It averages the latest ratings, measures the energy, and broadcasts one small message: the pulse.

`3:06` `code-pulse-4` Every screen is listening for it. On pulse updates the gauge, the bars and the chart, all drawn by the shared helpers in common.js.

`3:17` `code-pulse-5` So a hundred people dragging sliders still means just one broadcast every two seconds.

## 3:23 Everything else, same route

**Code (left):** event.js emits and listeners beside cp_act’s branches, then the grants at the end of the SQL file

**App (right):** Reactions and a chat message from the phone show up on the big screen

**Sound:** Taps, key taps

`3:24` `code-rest-1` Chat, questions, polls and reactions all take the same route. One line to emit, one branch in cp_act, and one listener to draw the result.

`3:36` `code-rest-2` And the rules live in the database, not the browser. The tables are closed. A browser can only call the functions granted at the bottom of the file, and each one checks who is calling.

## 3:49 The report

**Code (left):** report.js and supa.js, then the report Edge Function and analytics.js

**App (right):** The report page loads and scrolls: grade, timeline, key moments

**Sound:** Chime as the report appears

`3:49` `code-report-1` When the session ends, there’s one more path. report.js asks an Edge Function for the report.

`3:57` `code-report-2` The function checks that you’re allowed to see it, reads the raw data with a key the browser never gets, and runs it through analytics.js, which turns ratings and chat into a grade, key moments and insights.

`4:13` `code-report-3` Only crowd-level results come back, and Chart.js draws them.

## 4:18 Outro

**Code (left):** The Explorer, with each part of the map lit in turn

**App (right):** The finished map, then the end card

**Sound:** Music resolves

`4:19` `code-outro-1` So that’s the map. Six pages, with a script each. One connection file. One SQL file that holds the rules. And one function for the report.

`4:30` `code-outro-2` To explore it yourself, run npm run dev, open a session’s control room, and start the built-in audience simulator. Then follow one emit, and see where it lands.
