import { INLINE_EMOTION_NAMES, stripInlineEmotionMarkers } from "./inline-emotion-contract.js";

export type ConversationTurnLength="compact"|"rich";

export { INLINE_EMOTION_NAMES, stripInlineEmotionMarkers };

export function normalizeConversationTurnLength(value:unknown):ConversationTurnLength{
  return value==="compact"?"compact":"rich";
}

// Conversation inline emotion scenes are part of the provider's main output.
// They are model-authored and must not depend on MCP/catch mode or avatar panel options.
export function inlineEmotionPrompt(value:unknown){
  const mode=normalizeConversationTurnLength(value),allowed=INLINE_EMOTION_NAMES.join(", ");
  if(mode==="compact")return[
    "[Claudex Workhouse inline emotion scene mode: compact]",
    "Respond naturally in the active conversation language using 1–2 sentences.",
    "Place exactly one [[e:<emotion>]] marker on its own line immediately before your dialogue.",
    "Every marker must use the complete [[e:<emotion>]] syntax including the e: prefix. Never use shorthand such as [[pout]].",
    "Choose the emotion expressed by your own following words.",
    `Allowed emotion names: ${allowed}.`,
    "Do not output another marker, image Markdown, asset URLs, MCP instructions, or an explanation of the marker.",
    "[End Claudex Workhouse inline emotion scene mode]",
  ].join("\n");
  return[
    "[Claudex Workhouse inline emotion scene mode: rich]",
    "Respond naturally in the active conversation language using 2–4 sentences.",
    "Structure the response as exactly two or three short emotional beats.",
    "Place one [[e:<emotion>]] marker on its own line immediately before each beat.",
    "Use exactly two or three markers in total. Never use only one marker in rich mode.",
    "Every marker, including the second and third marker, must repeat the complete [[e:<emotion>]] syntax including the e: prefix. Never use shorthand such as [[pout]] or [[smug]].",
    "Give each beat a genuine change in reaction, emphasis, or attitude so the markers are not decorative duplicates.",
    "Choose the emotion expressed by your own following words, not the user's mood or a quoted participant's mood.",
    `Allowed emotion names: ${allowed}.`,
    "Do not output more than three markers, image Markdown, asset URLs, MCP instructions, or an explanation of the marker.",
    "Do not repeat an emotion marker without a meaningful transition.",
    "[End Claudex Workhouse inline emotion scene mode]",
  ].join("\n");
}
