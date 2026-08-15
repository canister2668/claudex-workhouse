#!/bin/sh
set -eu
state=${FAKE_ANTIGRAVITY_STATE:?}
if [ "${1:-}" = "--version" ]; then printf '%s\n' '1.1.9'; exit 0; fi
if [ "${1:-}" = "models" ]; then
  if [ -f "$state" ]; then printf '%s\n' 'gemini-test-model'; exit 0; fi
  printf '%s\n' 'Error: Please sign in to view available models. Launch the CLI without arguments to sign in.' >&2
  exit 1
fi
if [ "${1:-}" = "--print" ]; then
  if [ "${2:-}" = "/logout" ]; then rm -f "$state"; printf '%s\n' '{"status":"SUCCESS"}'; exit 0; fi
  if [ ! -f "$state" ]; then
    case "$HOME" in
      *antigravity-vertex-home)
        printf '%s\n' 'Select login method:'
        IFS= read -r _login_method
        printf '%s\n' 'Google Cloud sign-in method:'
        IFS= read -r _cloud_method
        ;;
    esac
    printf '%s\n' 'Authentication required. Please visit the URL to log in:'
    printf '%s\n' 'https://accounts.google.com/o/oauth2/auth?code=fake-secret'
    printf '%s\n' 'Or, paste the authorization code here and press Enter:'
    IFS= read -r code
    [ "$code" = 'GOOGLE-ONE-TIME-CODE' ] || exit 2
    case "$HOME" in
      *antigravity-vertex-home)
        printf '%s\n' 'Enter Google Cloud project ID:'
        IFS= read -r project
        [ "$project" = 'sample-project-123' ] || exit 3
        printf '%s\n' 'Enter Google Cloud location:'
        IFS= read -r location
        [ "$location" = 'global' ] || exit 4
        ;;
    esac
    : > "$state"
  fi
  printf '%s\n' '{"status":"SUCCESS","result":"AUTHENTICATION_OK"}'
  exit 0
fi
exit 2
