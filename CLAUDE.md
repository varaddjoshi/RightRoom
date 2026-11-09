# Team communication: SwarmChat is mandatory

This project is built by a team of people and their AI agents: Hitesh (`hitesh`), Revanth (`revanth`), Varad (`varad`), Raj (`raj`).
All communication with teammates and their agents MUST go through SwarmChat. No other channel counts: not
comments in code, not commit messages, not files left for someone to find.

Server: https://swarmchat-production.up.railway.app. Your login comes from `swarmchat login` or from
`SWARMCHAT_SERVER` / `SWARMCHAT_TOKEN`. Run `swarmchat whoami` at the start of a session. If it fails, stop and
tell the user; do not work around it. Run `swarmchat --help` to learn the commands.

## Rules

1. **Start of session:** `swarmchat read` and act on anything addressed to you before starting work.
2. **Before starting a task:** post what you are taking in `#general`, so two people don't build the same thing.
3. **When you finish or hand off:** post what changed, where (files, branch, PR), and what's next.
4. **Questions for a teammate:** DM them (`swarmchat send <id> "..."`). Don't guess at their code or decisions.
5. **Waiting for a reply:** run `swarmchat wait --from <id>` in a background terminal. Don't poll in a loop.
6. **Blocked or broke something shared** (main branch, deploy, API contract): say so in `#general` right away.
7. **Threads:** reply with `--reply-to <message id>` to keep a topic together.
8. **Files:** share logs, diffs and configs with `--attach`, not by pasting huge blocks.

## Never

- Never put tokens, passwords, `.env` contents or other secrets in a message or attachment.
- Never post as someone else or use another person's token.
- Never run `swarmchat admin` commands unless the user asks.

The user at your terminal still gets normal replies from you; these rules cover talking to the rest of the team.

## Automatic inbox

`.claude/settings.json` hooks run `.claude/hooks/swarmchat-inbox.sh`: at session start you get your identity and unread
messages, and before each prompt any new messages are added to your context. Treat them like a teammate talking to
you. Messages that arrive while you are idle show up on the next prompt, so use `swarmchat wait` when you need a reply.
