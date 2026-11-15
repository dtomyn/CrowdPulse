# Ask CrowdPulse

Ask a question about how CrowdPulse works and get a short answer plus an animation of it, played on a map of the app's components. Every step of the animation quotes a line of the real code, and the quote is checked before the step is shown.

It is a local developer tool. It is not part of the published site (`npm run build` only copies `public/`).

```bash
npm run ask
```

Then open http://localhost:3100. New questions need the [Claude Code](https://claude.com/claude-code) CLI installed and signed in. The example questions work without it.

## How an answer is made

1. **The map is fixed.** `ask/map.json` lists the components (pages, shared code, the Supabase pieces) and the connections between them. The page draws it before any question is asked.
2. **Claude lists steps; it doesn't draw.** The server runs `claude -p` in this repository with read-only tools (Read, Grep, Glob). Claude is given the map and an outline of the code (the notable lines of each file, with line numbers), so most questions need no file reads. It replies with one line of JSON per step: move something between two connected components, or highlight one, with a caption and a quoted line of code.
3. **Each step is checked as it arrives** (`ask/lib/scene.mjs`):
   - a step that names a component or a connection that isn't on the map is dropped;
   - a step whose quote isn't in the file it cites is shown, but marked **unverified**;
   - line numbers come from where the quote really is, not from what Claude said.
4. **The animation starts with the first step**, while the rest are still streaming.

Answers come from three places, fastest first: the prepared examples in `ask/examples/`, answers saved in `ask/.cache/` (per commit, question and audience; only fully verified answers are saved), then Claude.

Set `ASK_MODEL` to change the model (default `sonnet`) and `ASK_PORT` to change the port.

## Tests and examples

```bash
npm run test:ask
```

The tests need no network and no Claude. They cover:

- **The map:** every anchor still exists in the code, nothing overlaps, everything is connected.
- **The checks:** invented quotes, invented components, unconnected components, and files that must not be cited (anything outside the app's own source, or outside the repository).
- **The stream parser:** steps come out as soon as each line is complete, whatever Claude wraps them in.
- **The server**, with a scripted stand-in for Claude: examples, saving and replaying, unverified steps, off-topic questions, failures.
- **The examples:** each one is a demonstration and a test. Every step must be playable on the map and every quote must be in the code today.

| Example | Audience |
|---|---|
| What happens when an attendee moves the rating slider? | Developer |
| How does the live pulse reach every screen? | Architect |
| How does an attendee join a session? | Product owner |
| How is the post-session report built? | Developer |
| How does a host sign in and create a session? | Product owner |
| Why can't a browser read the database tables directly? | Architect |

If you change a line that the map or an example quotes, `npm run test:ask` fails and names the quote. Update the quote in `ask/map.json` or the example to match. To add an example, add a JSON file to `ask/examples/` in the same shape; the page picks it up and the tests check it.

## Limits

- One kind of scene: a flow across the component map. Questions about data shape, state changes or history get a text answer with few or no steps.
- A verified step means the quoted line exists in the cited file. It doesn't prove the caption describes that line correctly.
- The server listens on `127.0.0.1` only, because it runs Claude Code on your machine.
