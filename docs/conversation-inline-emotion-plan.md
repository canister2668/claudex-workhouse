# Conversation inline emotion scenes plan

Status: implemented and deployed on 2026-07-17. Automated browser-console verification remains environment-blocked as recorded in the completion report.

## Goal

Casual conversation mode lets Claude and Codex place compact emotion markers directly between their own lines. The collaboration output card turns those markers into persistent emotion scenes while the existing floating emotion panel shows only the current live scene.

The feature must not change permissions, workspace selection, AccessContract, collaboration run identity, provider ownership, or relay trust boundaries.

## Product decisions

- Provider output uses the compact standalone marker `[[e:<emotion>]]`.
- Marker position is the scene position; opening/middle/closing words are not encoded in the marker.
- Claude and Codex use the same marker grammar.
- Conversation creation exposes a session-scoped length toggle:
  - `compact`: 1–2 Korean sentences with exactly one requested emotion scene.
  - `rich`: 2–4 Korean sentences with one scene normally and two or three when the speaker's emotion genuinely changes.
- New conversation forms default to `rich`. Existing sessions without this metadata retain their legacy behavior until a new session is created; they are not silently rewritten.
- More markers than the selected mode allows are ignored as presentation instructions and removed from relay text.
- The marker is model-authored presentation data, not an MCP call, Markdown image, URL, command, or collaboration control signal.
- In conversation mode, inline scenes are independent of the global `mcp`/`catch` avatar input mode, emotion intensity, panel pinning, and panel auto-collapse options.
- The selected Claude outfit and Codex `Gpt-Codex`/`Gpt-Sol` appearance are still used to resolve the matching local asset. Appearance selection does not change the model-authored emotion.
- A valid marker is authoritative. If a new output contains no valid marker, it remains text-only rather than inventing an emotion. Existing historical outputs without markers keep their current deterministic presentation for compatibility.

The implementation must include this comment at the prompt/parser boundary:

```ts
// Conversation inline emotion scenes are part of the provider's main output.
// They are model-authored and must not depend on MCP/catch mode or avatar panel options.
```

## Prompt contract

Replace the casual-conversation `set_emotion` requirement with a provider-neutral inline-scene instruction selected from immutable session metadata. Other task modes and the normal session avatar may continue to use the existing MCP/catch behavior.

The session field should have a conversation-specific name such as:

```ts
type ConversationTurnLength = "compact" | "rich";
```

It must not reuse global `emotionIntensity`, avatar mode, or display preferences. Store the selected value in collaboration-session metadata so automatic rounds, guided follow-ups, add-rounds, retry, resume, and server recovery all use the same contract.

Compact prompt variant:

```text
[Claudex Workhouse inline emotion scene mode: compact]

- Respond naturally in Korean using 1–2 sentences.
- Place exactly one [[e:<emotion>]] marker on its own line immediately before your dialogue.
- Choose the emotion expressed by your own following words.
- Use only the allowed emotion names supplied below.
- Do not output another marker, image Markdown, asset URLs, MCP instructions, or an explanation of the marker.

[End Claudex Workhouse inline emotion scene mode]
```

Rich prompt variant:

Proposed prompt block:

```text
[Claudex Workhouse inline emotion scene mode: rich]

- Respond naturally in Korean using 2–4 sentences.
- You may place [[e:<emotion>]] on its own line immediately before the dialogue it describes.
- Use one marker for a short response and two or three only when your own expressed emotion genuinely changes.
- Choose the emotion expressed by your own following words, not the user's mood or a quoted participant's mood.
- Use only the allowed emotion names supplied below.
- Do not output image Markdown, asset URLs, MCP instructions, or an explanation of the marker.
- Do not repeat an emotion marker without a meaningful transition.

[End Claudex Workhouse inline emotion scene mode]
```

The allowed list is the normalized common emotion vocabulary supported by the UI. Missing outfit variants fall back visually to that provider's neutral asset; the textual emotion value is not rewritten.

The marker count is a prompt contract rather than an execution control. If a provider omits or malforms the required compact marker, the UI fails soft to text-only output and records no invented emotion. It must not retry the provider, add an MCP call, or synthesize a random marker merely to satisfy the visual count.

Example model output:

```text
[[e:smug]]
아, 회사 놀리기? 좋지~ OpenAI는 이름부터 사기 아니야?

[[e:laughing]]
근데 우리 Anthropic도 인간적이라는 이름으로 AI를 만드는 건 꽤 웃기긴 해. 그건 인정.
```

## Content representations

Provider output needs two derived representations so presentation markup never leaks into the next model's conversational context.

- `presentationContent`: removes the existing conversation control suffix but retains valid inline emotion markers for streaming and completed cards.
- `conversationContent`: derives from `presentationContent` and removes every valid, partial, duplicate, or excess reserved emotion marker before relay, history compaction, prompt construction, checksums, and provider-to-provider quotation.

The raw provider output remains untrusted. An emotion marker cannot alter run state, continuation, permissions, tools, or relay handling.

## Parser and identity

Add a pure parser such as `parseInlineEmotionScenes(runId, messageItemId, content)` that returns:

```ts
type InlineEmotionScene = {
  id: string;
  emotion: string;
  text: string;
  sourceOffset: number;
};
```

Rules:

1. Recognize only `[[e:<allowed-emotion>]]` on a standalone line.
2. Treat an unfinished streaming prefix such as `[[e:sm` as pending presentation syntax so it does not flash as dialogue.
3. Bind each valid marker to the following text until the next marker.
4. Apply the session cap: one scene for `compact`, at most three for `rich`.
5. Reject empty scenes and normalize aliases such as `chu~` to the existing canonical group.
6. Use stable identity derived from `runId + messageItemId + sourceOffset`. Do not use array index, randomness, or timestamps as render keys.
7. Add a development invariant for duplicate scene IDs.

Streaming deltas and the completed message continue to converge through the existing collaboration event merge. The completed snapshot replaces the temporary message content; it must not append a second set of scenes.

## Output-card rendering

Replace the single leading/trailing frame layout for marker-enabled conversation output with ordered scene blocks:

```text
emotion asset + the dialogue segment it introduces
emotion asset + the next dialogue segment
```

- Use the participant provider and current outfit to resolve assets.
- Render exactly the accepted model-authored scene for a normal `compact` response and a maximum of three decoded images for `rich`.
- Keep `loading="lazy"`, fixed dimensions, and existing asset fallbacks.
- Do not render arbitrary Markdown or remote URLs from provider output.
- On small screens use the current compact asset size and alternate layout only when two or more scenes exist.
- Historical outputs without inline markers remain on the existing `selectOutputAssets` path.

## Existing emotion-panel behavior

The panel and card have separate roles:

- Output card: persistent history of every accepted scene in the turn.
- Floating/header panel: only the currently streaming scene.

Lifecycle:

1. Before the first marker, the panel may show ordinary task activity.
2. When a complete marker arrives, apply a run-scoped transient override to the panel and show a short prefix of its following dialogue.
3. Each later marker replaces only the transient panel state; earlier scenes remain in the card.
4. On completion, retain the last scene briefly and then follow the existing auto-collapse behavior.
5. Opening historical conversations does not replay scenes automatically.
6. Tapping a completed card scene may temporarily preview it in the existing panel, after which normal collapse behavior resumes.

Conversation-scene state is derived from the selected run output. It is not written to the global emotion state file.

## MCP/catch separation and cleanup

- Stop injecting `emotionMcpPrompt()` into casual conversation prompts once inline scenes are enabled.
- Do not require `set_emotion` or `express_emotion` for a casual conversation run.
- Do not add a third global emotion mode.
- Retain MCP/catch for normal Claude/Codex sessions and any existing non-conversation avatar features.
- Do not add an EventSource, interval, filesystem watcher, object URL, or per-run persistent store for inline scenes.
- Reuse the existing asset catalog and singleton emotion stream only where the global panel already needs them. A completed card needs only the catalog, not a live subscription.
- Unsubscribe the existing panel listener on component teardown and clear any existing collapse timer through the current lifecycle.
- Cap scenes according to the session mode (`compact=1`, `rich=3`) and use lazy image decoding to bound memory use in long conversations.

This separation removes the conversation run's MCP tool call and global emotion-state write. It does not remove the shared MCP/catch infrastructure used by other screens.

## Expected code changes

### Server

- `app/src/server/collaboration/orchestrator.ts`
  - Add the selected compact/rich inline-scene prompt block to casual conversation only.
  - Apply 1–2 sentences/one marker for `compact` and 2–4 sentences/one-to-three markers for `rich`.
  - Do not inject the MCP avatar prompt for casual conversation.
  - Introduce separate presentation/plain content helpers and strip markers from all participant relay paths.

- Conversation creation API and metadata
  - Accept only `compact` or `rich` for new casual-conversation sessions.
  - Persist the choice in collaboration-session metadata and return it in detail responses.
  - Preserve it across add-rounds, follow-up, retry, resume, and recovery without consulting current global UI preferences.

- Conversation creation UI
  - Add a two-choice control near the conversation tone/flow controls:
    - `간결하게` — `1–2문장 · 감정 장면 1개`
    - `풍부하게` — `2–4문장 · 감정 전환 시 2–3개`
  - Default new forms to `풍부하게` and include the explicit selection in the create request.
  - Do not add the control to global avatar settings.

- Claude/Codex launch configuration
  - Confirm no conversation-only emotion tool is added after the prompt stops requiring it.
  - Do not change tool availability for normal sessions.

### Web selectors

- `app/src/web/collaboration-assets.ts`
  - Add strict marker parsing, allowed-emotion validation, scene identity, and marker stripping helpers.

- `app/src/web/collaboration-presentation.ts`
  - Build marker-authored scenes for current outputs.
  - Retain deterministic frames only for historical marker-free output.

- `app/src/web/CollaborationTimeline.svelte`
  - Derive the current run-scoped scene for the existing panel override.

- `app/src/web/CollaborationRunCard.svelte`
  - Render ordered scene blocks and expose an optional scene-preview action.

- Styles
  - Reuse current frame dimensions and mobile breakpoints; do not introduce an unbounded gallery.

## Tests

### Prompt and relay

- Claude and Codex receive the same compact marker grammar.
- `compact` requests 1–2 sentences and exactly one marker; `rich` requests 2–4 sentences and one normally or up to three when emotion changes.
- Casual conversation no longer requires `set_emotion` in either length mode.
- Normal sessions retain their existing MCP/catch behavior.
- Valid, invalid, partial, duplicate, and excess markers are removed before the next participant prompt.
- Conversation control suffix removal and emotion-marker removal do not corrupt Korean dialogue.
- The selected mode survives automatic rounds, user follow-up, add-rounds, retry, resume, and recovery.
- Existing sessions with no length metadata retain their legacy prompt contract.

### Parser and streaming

- One marker produces one scene.
- Two or three separated markers produce the same number of ordered scenes.
- Compact mode accepts the first valid scene and safely strips every excess marker from display and relay.
- Rich mode accepts at most three valid scenes.
- A partial marker is hidden during streaming and becomes one scene when completed.
- Delta followed by completed snapshot remains the same scene IDs and does not duplicate cards.
- The same emotion may appear in separate runs without identity collision.
- Duplicate scene IDs trigger the development invariant before Svelte rendering.

### Options and assets

- `mcp` versus `catch` does not change parsed scenes or card output.
- Emotion intensity, panel pinning, and auto-collapse do not change card scenes.
- Claude and both Codex outfits resolve their own asset files.
- A missing emotion asset falls back to the provider outfit's neutral image.
- Historical marker-free outputs preserve their existing display.

### Resource lifecycle

- Mounting a conversation card creates no additional EventSource or interval.
- Repeated navigation does not increase emotion-stream listener count.
- Panel preview timers/listeners are cleared on unmount.
- A long production-shaped conversation never decodes more than three inline scene images per run at once.

### Browser regression

- Production-shaped Claude and Codex streams show the marker transition during streaming and the same scenes after completion.
- Reserved markers never appear as raw text.
- Browser console has no Svelte duplicate-key or image URL errors.
- Mobile layouts at the supported breakpoints do not overflow.

## Implementation order

1. Add parser/stripper unit tests and the option-independence invariant.
2. Add the session-scoped compact/rich creation field, API validation, and persistence tests.
3. Add the pure marker parser, per-mode caps, and stable scene IDs.
4. Split server presentation content from relay conversation content.
5. Update both casual prompt variants and remove their MCP emotion instruction.
6. Render marker-authored scenes while retaining historical fallback.
7. Drive the existing panel from a run-scoped transient scene without new subscriptions.
8. Add Claude/Codex streaming, completion, relay, option, resume, and resource-lifecycle regressions.
9. Run Svelte/TypeScript checks, related tests, the full suite, and the production build.
10. Deploy and create one real conversation in each length mode; verify prompt length, marker cap, streaming transitions, completed cards, clean relay text, browser console, and health.

## Acceptance criteria

- Conversation creation requires a visible `간결하게` or `풍부하게` selection and defaults new forms to `풍부하게`.
- Claude and Codex use `[[e:<emotion>]]` with 1–2 sentences/one requested scene in compact mode and 2–4 sentences/up-to-three scenes in rich mode.
- A completed card contains the same per-mode scene set observed during streaming.
- The selected length mode survives follow-up, add-rounds, retry, resume, and recovery.
- Inline scenes are unchanged by MCP/catch mode and avatar panel options.
- The required independence comment exists at the implementation boundary.
- Outfit selection changes only the displayed asset appearance.
- No inline marker reaches the other provider's quoted conversational context.
- Casual conversation creates no emotion MCP call or global emotion-state write.
- No new long-lived stream, watcher, timer, or per-run store is introduced.
- Existing normal-session avatar behavior remains unchanged.
- No index/random/timestamp render key is used.
- Relevant tests, full tests, production build, real browser verification, and health check pass.

## Non-goals

- General Markdown rendering in provider output.
- Model-controlled image URLs or filenames.
- More than three inline scenes per turn.
- Replaying historical scenes automatically in the floating panel.
- Changing global avatar options, permissions, workspaces, AccessContract, or collaboration orchestration semantics.
