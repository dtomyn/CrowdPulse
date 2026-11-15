# Ask CrowdPulse explainer: narration script

3:28 in all. Voice: Kokoro `af_heart` at speed 0.97 (the voice of the other CrowdPulse films). Written by `film/render_ask.py` from `film/ask/ask-film.js`. To replace a line with a real recording, save it as `film/vo/recorded/<id>.wav`.

## 0:00 Cold open

**Shows:** A question about the code, and the idea: ask it, and watch the answer

**Camera:** The map lies tilted in the dark with an answer running across it, then swings up to face the viewer

**Sound:** Music swells in; key taps as the question types; whoosh on the title

`0:00` `ask-open-1` Some questions about a codebase take an afternoon to answer. How does a rating get from a phone, to the big screen?

`0:08` `ask-open-2` What if you could just ask? And then watch the answer happen.

## 0:16 Asking a question

**Shows:** Typing a question, choosing who is asking, and the answer streaming in while the animation already plays

**Camera:** Full window for the typing; pushes in on the answer; then rides along with the packet across the map

**Sound:** Key taps, a click on Ask, soft pops as steps land

`0:17` `ask-first-1` This is Ask CrowdPulse. It runs on your own machine, right next to the code. Type a question, say who’s asking, and press Ask.

`0:28` `ask-first-2` Claude Code reads the repository. A few seconds later, a short answer appears, and then the steps start to arrive. The animation begins before the answer has finished.

`0:42` `ask-first-3` Each step is one claim. Something travels between two parts of the app, and the caption says what it is.

`0:52` `ask-first-4` Phone, to connection, to database. Then back out, on a broadcast, to every screen.

## 1:01 Why you can trust it

**Shows:** Every step quotes a real line that is looked up first; a step between unconnected parts is dropped; an invented quote is flagged

**Camera:** Pushes in on a step’s citation while the real file scrolls to the quoted line; pulls back for the two planted mistakes

**Sound:** Chime when a quote is found; a dull pop when it is not

`1:01` `ask-proof-1` Here’s why you can trust it. Every step quotes a line of the real code, and that quote is looked up in the file before the step is shown.

`1:13` `ask-proof-2` To show what happens when the model gets it wrong, we planted two mistakes in this answer.

`1:21` `ask-proof-3` This step jumps between two parts that aren’t connected on the map. It never reaches the screen.

`1:30` `ask-proof-4` And this one quotes a line that isn’t in the file. It’s shown, but flagged as unverified.

`1:39` `ask-proof-5` A verified step proves the line exists. Whether the caption reads it correctly is still your call, so the line is always one click away.

## 1:50 How it works

**Shows:** The fixed map and its anchors; what Claude is given and what it sends back; how quickly the first step arrived

**Camera:** The map alone, tilted, as its anchors appear; then the map beside what goes in and what comes out

**Sound:** Soft pops as anchors and lines appear

`1:50` `ask-how-1` Under the hood, the map is fixed. Eighteen parts of the app and the connections between them, each one anchored to a line of code.

`2:01` `ask-how-2` Claude doesn’t draw anything. It gets the map and an outline of the code, and replies with a list of steps, one per line.

`2:13` `ask-how-3` Because the map is already on screen, the answer can start playing as soon as the first line lands. Here, that took about four seconds.

## 2:23 One question, three audiences

**Shows:** The same question answered for a developer, an architect and a product owner, playing side by side

**Camera:** Three windows in a row, each with its current caption underneath

**Sound:** Whoosh as the three windows arrive

`2:24` `ask-aud-1` The same question can be asked three ways. A developer gets function names.

`2:32` `ask-aud-2` An architect gets boundaries and trade-offs. A product owner gets plain language.

`2:41` `ask-aud-3` Same map, same code, three different stories.

## 2:46 Answers that can’t go stale

**Shows:** The six prepared examples playing at once, and the real test run that checks every quoted line

**Camera:** A wall of six maps; a terminal runs the tests over it

**Sound:** Soft ticks as tests pass; chime on the summary

`2:47` `ask-test-1` The prepared examples double as tests. Every one has to play on the map, and every quoted line has to exist in the code today.

`2:57` `ask-test-2` Change a line that an answer depends on, and the test run fails and names the quote. The explanations can’t quietly go stale.

## 3:08 Outro

**Shows:** The three things the tool does, then how to start it

**Camera:** The wall of maps tips back into the distance behind three lines of text; end card

**Sound:** Music resolves; whoosh on the end card

`3:08` `ask-outro-1` Ask CrowdPulse. Ask a question. Watch the answer. Check the line.

`3:17` `ask-outro-2` To try it, run npm run ask, and open localhost, port thirty-one hundred.
