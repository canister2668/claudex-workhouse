export type SubmitKey = Pick<KeyboardEvent,"key"|"shiftKey"|"altKey"|"ctrlKey"|"metaKey"|"isComposing">;

// Plain Enter submits only when the user opted in. Shift+Enter and modified
// Enter stay available for newlines/IME editing.
export function shouldSubmitOnEnter(event:SubmitKey,enabled:boolean){
  return enabled&&event.key==="Enter"&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.isComposing;
}
