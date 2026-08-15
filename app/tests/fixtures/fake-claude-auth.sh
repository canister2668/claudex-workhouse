#!/bin/sh
state="${FAKE_CLAUDE_STATE:?}"
mode_file="${FAKE_CLAUDE_MODE:?}"
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  if [ -f "$state" ]; then
    printf '%s\n' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"masked@example.com","subscriptionType":"max"}'
  else
    printf '%s\n' '{"loggedIn":false}'
  fi
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "logout" ]; then
  rm -f "$state"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then
  mode=subscription
  [ "$3" = "--console" ] && mode=console
  [ "$3" = "--sso" ] && mode=sso
  printf '%s' "$mode" > "$mode_file"
  if [ "$mode" = "console" ]; then host=platform.claude.com; else host=claude.com; fi
  printf 'If the browser did not open, visit: https://%s/oauth/authorize?attempt=fake\n' "$host"
  printf 'Paste code here if prompted > '
  IFS= read -r auth_code
  [ -n "$auth_code" ] || exit 2
  : > "$state"
  exit 0
fi
exit 3
