#!/usr/bin/env bash
# Feeds new SwarmChat messages into Claude's context.
#   start  - SessionStart: who am I + unread messages
#   prompt - UserPromptSubmit: unread messages only, silent when there are none
# Always exits 0 so a chat outage never blocks the session.

mode="${1:-prompt}"
sc="$(command -v swarmchat)"
# Hitesh's machine keeps swarmchat in the sibling setup repo's venv.
[ -z "$sc" ] && [ -x "$CLAUDE_PROJECT_DIR/../swarmchat/.venv/bin/swarmchat" ] && sc="$CLAUDE_PROJECT_DIR/../swarmchat/.venv/bin/swarmchat"

if [ -z "$sc" ]; then
  [ "$mode" = start ] && echo "SwarmChat: the swarmchat command is not installed. Tell the user to run 'pip install swarmchat' and 'swarmchat login' (see CLAUDE.md)."
  exit 0
fi

if [ "$mode" = start ]; then
  if ! me="$("$sc" whoami 2>&1)"; then
    echo "SwarmChat: not logged in ($me). Tell the user to run 'swarmchat login https://swarmchat-production.up.railway.app <token>'."
    exit 0
  fi
  echo "SwarmChat: you are $me. Follow the team rules in CLAUDE.md: all teammate communication goes through swarmchat."
fi

msgs="$("$sc" read 2>&1)" || exit 0
if [ "$msgs" != "No new messages." ]; then
  echo "New SwarmChat messages (now marked read; act on anything addressed to you):"
  echo "$msgs"
fi
exit 0
