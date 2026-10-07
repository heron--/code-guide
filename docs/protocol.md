# Event protocol

One typed stream carries everything between the Code Guide server and the browser. The types live in [`src/shared/protocol.ts`](../src/shared/protocol.ts), imported by both sides. This page gives one example of each message; a test parses every example below against those types.

- **Events** (server → browser) are everything that happens in a session. The server appends each one to the session's `events.jsonl` and sends it to every connected tab. State is rebuilt by replaying them in order.
- **Requests** (browser → server) ask for something to happen. The browser doesn't change its own state: it renders the events that come back.
- **Notices** (server → browser) answer a connection, or refuse a request. They aren't logged.

Harness-specific shapes never appear here. Adapters translate them into these events.

## Versioning

Every event carries `v`, the protocol version. The browser sends its version in `hello`; if the server speaks another, it replies with a fatal `error` notice and closes the connection. Bump `PROTOCOL_VERSION` whenever a change would break an older browser or log reader.

## Events

Every event has the same envelope. `seq` counts up from 1 within a session. A tab that reconnects sends the last `seq` it saw, and the server replays everything after it, then streams live. See [the channel](#channel).

```json
{
  "v": 1,
  "seq": 1,
  "at": "2026-10-07T09:12:03.120Z",
  "session": "2026-10-07-091203-k3f9",
  "type": "session.started",
  "payload": { "repo": "/Users/devin/src/payments" }
}
```

The examples below show only `type` and `payload`.

### Session

```json
{ "type": "session.subject", "payload": { "subject": { "type": "change", "base": "main", "head": "feat/retry-policy" }, "label": "feat/retry-policy vs main" } }
```

A subject is a `change` (`base`, optional `head`, optional `pr`), a `path`, or a `question`.

```json
{ "type": "harness.status", "payload": { "harness": "claude-code", "model": "opus-5.5", "state": "ready" } }
```

### Jobs

A job is queued, starts when the concurrency limit allows, reports progress, and ends in exactly one of `job.finished`, `job.failed` or `job.cancelled`.

```json
{ "type": "job.queued", "payload": { "job": "quiz-1", "kind": "quiz", "label": "Writing the quiz", "module": "quiz", "inputs": ["guide-1"] } }
```

`inputs` names the finished results the job reads, never their transcripts. `label` is what the job does, as the reader sees it.

```json
{ "type": "job.started", "payload": { "job": "guide-1" } }
```

```json
{ "type": "job.progress", "payload": { "job": "guide-1", "activity": "Reading src/retry/policy.ts" } }
```

Progress says what the agent is doing, not what it has written so far. A result arrives whole, once it passes validation.

```json
{ "type": "job.submitted", "payload": { "job": "guide-1", "attempt": 1, "accepted": false, "problems": [{ "level": "error", "where": "chapters[1] \"Retry only safe requests\"", "message": "range \"40-90\" is past the end of the file (72 lines)" }] } }
```

Each submission is recorded, accepted or not. Errors go back to the agent and the job continues.

```json
{ "type": "job.finished", "payload": { "job": "guide-1", "result": "results/guide-1.json", "warnings": [] } }
```

`result` is a file in the session directory.

```json
{ "type": "job.failed", "payload": { "job": "guide-1", "error": "Still had errors after 5 submissions", "problems": [{ "level": "error", "where": "chapters[0]", "message": "file not found at the working tree" }] } }
```

```json
{ "type": "job.cancelled", "payload": { "job": "quiz-1" } }
```

### Chat

```json
{ "type": "chat.sent", "payload": { "message": "m-1", "text": "Why not retry POST?", "context": [{ "kind": "chapter", "job": "guide-1", "chapter": 1 }] } }
```

```json
{ "type": "chat.started", "payload": { "message": "m-2", "replyTo": "m-1" } }
```

```json
{ "type": "chat.delta", "payload": { "message": "m-2", "text": "A repeated POST can" } }
```

Replies stream as text deltas, appended in order.

```json
{ "type": "chat.finished", "payload": { "message": "m-2" } }
```

```json
{ "type": "chat.failed", "payload": { "message": "m-2", "error": "The harness stopped responding" } }
```

## Requests

```json
{ "type": "hello", "v": 1, "session": "2026-10-07-091203-k3f9", "after": 41 }
```

The first message on every connection. A tab that reconnects sends its session and the last `seq` it saw, and gets only what came after. A fresh tab omits both, and so does a tab whose session isn't the server's any more: either gets the whole session.

```json
{ "type": "subject.choose", "subject": { "type": "question", "question": "How are retries scheduled?" } }
```

```json
{ "type": "job.start", "module": "guide" }
```

```json
{ "type": "job.start", "module": "guide", "retry": "guide-1" }
```

```json
{ "type": "job.cancel", "job": "quiz-1" }
```

```json
{ "type": "chat.send", "text": "What calls this?", "context": [{ "kind": "code", "path": "src/retry/policy.ts", "start": 31, "end": 33 }] }
```

A chat message's context can be a `chapter`, a selected range of chapter `prose`, or a selected range of `code`.

## Notices

```json
{ "type": "welcome", "v": 1, "session": "2026-10-07-091203-k3f9", "modules": [{ "name": "diff", "label": "Diff", "icon": ["M3 2.5h10v11H3z", "M8 5v4M6 7h4M6 11h4"], "needsJob": false, "subjects": ["change"] }] }
```

`welcome` lists the modules this server offers, so the browser can show them without knowing any by name.

```json
{ "type": "error", "message": "This tab speaks protocol v2; the server speaks v1. Reload the page.", "fatal": true }
```

## Channel

Each browser tab opens one WebSocket to `/api/session` on the local server, which binds to 127.0.0.1 and accepts connections only from pages served on this machine. The tab sends `hello`; the server answers `welcome`, replays the events the tab missed, and then sends every new event as it happens. Every tab gets every event, so tabs on the same session stay in sync. When the connection drops, the tab reconnects and says hello again with the last `seq` it saw, so nothing is lost or shown twice.
