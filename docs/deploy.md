# Deploying RightRoom

RightRoom runs on our Cloud Native Hackathon cluster, set up from [skyhook-io/cnh-starter](https://github.com/skyhook-io/cnh-starter).

| What | Where |
|---|---|
| Cluster (Radar Cloud, org Cloud Native Hackathon) | `pantheon` |
| Namespace | `team-pantheon` |
| Public URL | https://pantheon.cnh.radarhq.io (version check: `/health`) |
| Argo CD Application | `app` in `team-pantheon`, tracking branch `deployed`, path `deploy/` |
| Image | `ghcr.io/varaddjoshi/rightroom:<7-char commit>` |
| Credentials | Secret `app-credentials` in `team-pantheon`, created by hand, never in git |

## How a change ships

1. Open a PR. Gitar reviews it. Nobody pushes to `main`.
2. Merge it. The `build-and-deploy` Action builds the image and tags it with the merged commit. It then force-pushes `main` plus one bot commit, `deploy: <sha> [skip ci]`, which sets that tag in `deploy/kustomization.yaml`, to branch **`deployed`**. Merges that change only Markdown don't build.
3. Argo CD syncs `deploy/` from `deployed` into `team-pantheon`. An agent with Radar can sync immediately (the `ship` skill).
4. It's live when `curl -s https://pantheon.cnh.radarhq.io/health` shows the merged commit as `version`.

`main` only ever changes through PRs; the bot writes only to `deployed`. Never push to `deployed` by hand: the next build replaces it.

**Rollback:** in GitHub > **Actions**, open the last good `build-and-deploy` run and click **Re-run all jobs**. It rebuilds that commit and moves `deployed` back to it. The next merge rolls forward again, so if the fix isn't ready by then, also merge a PR that reverts the bad commit. Say so in SwarmChat `#general` first.

## Everyone, once

1. Accept the Radar Cloud invite email and sign in at https://app.radarhq.io with the email the team listed.
2. Connect your agent to Radar. Claude Code offers the `radar-cloud` server from this repo's `.mcp.json`. Approve it, then run `/mcp`, pick **radar-cloud**, choose **Authenticate**, and pick **Cloud Native Hackathon** under "Organization access". From outside this repo instead: `claude mcp add --scope user radar-cloud --transport http https://api.radarhq.io/mcp`.
3. Ask your agent: "Get me set up for the hackathon. Our team is pantheon." It follows `.agents/skills/get-started` and checks it can read `team-pantheon`.

## First deploy, once, after the PR that added this file is merged

1. **Build.** Wait for the `build-and-deploy` run on `main` to go green (repo **Actions** tab). It creates branch `deployed`.
2. **Make the image public.** The repo owner (Varad) opens the repo's **Packages** > `rightroom` > **Package settings** > **Change visibility** > **Public**. The cluster can't pull a private image. It may already say Public.
3. **Create the credentials Secret.** The person who holds the Elasticsearch and Dash0 keys does this. Don't paste keys into an agent chat or SwarmChat. Pick one:
   - In Radar Cloud: the cluster > **Resources** > **Secrets** > **+**. Set `name: app-credentials` and `namespace: team-pantheon`, put one line per key from your `.env` under `stringData` (for example `ELASTICSEARCH_URL: ...`), and click **Apply**.
   - With kubectl (see below): `kubectl -n team-pantheon create secret generic app-credentials --from-env-file=.env`

   Keys the app reads: `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`, `DASH0_OTLP_ENDPOINT` (gRPC, port 4317), `DASH0_TOKEN`, and optionally `ES_INDEX_PREFIX` (default `rr_`). Also add **`DEMO_PASSWORD`**: without it the demo accounts (organiser `dana`, staff `leo`) use the password printed in this public repo, so anyone could sign in to the live URL as organiser and reset the demo. With Elasticsearch set, the app's state (queues, offers, check-ins, accounts, sign-ins) is saved to index `rr_engine_state` and survives restarts and deploys (README, "Run the backend"). `src/telemetry-env.js` maps the `DASH0_*` values to the OpenTelemetry names. Revanth holds the values and passes them to whoever creates the Secret directly, never through SwarmChat or the repo. The keys become environment variables with the same names. `PORT` in the Secret is ignored, because the Deployment sets 8080. The pod starts without the Secret, but Elasticsearch and Dash0 calls fail until it exists. After you change the Secret, restart the app: in Radar, the Deployment `app` > Restart, or `kubectl -n team-pantheon rollout restart deployment/app`.
4. **Start GitOps.** Ask an agent connected to Radar to "ship it". It applies `argocd/application.yaml` once through Radar, syncs, waits for the new pod, and checks `/health`. Argo CD then replaces the template's starter app that is running there now.
5. **Record the "before".** Screenshot Radar Cloud > `pantheon` > **Checks**, scoped to namespace `team-pantheon`. The `get-started` skill also writes it to `STORY.md`.

## Limits that matter for us

- **One replica.** The live stream (`/api/stream`) keeps its connections in memory. Don't scale the Deployment or add the HPA from `examples/hpa`.
- **Budget for everything in the cluster:** 2 CPU / 4 GiB of requests, 4 CPU / 8 GiB of limits, 4 PVCs / 20 GiB. The app asks for 100m / 192Mi and is capped at 500m / 512Mi.
- **Only `https://pantheon.cnh.radarhq.io`**, which is routed to Service `app` on port 80. There's no LoadBalancer or NodePort. Keep the Service.
- **Live stream through the platform's gateway:** once `/api/stream` exists, check on the public URL that events arrive immediately and aren't buffered.
- **The host refuses** privileged pods and pods that use hostPath, hostNetwork or hostPID. A refused pod stays `Pending` with a `SyncError` event.

## kubectl, if you need it

Radar is the main way in. The kubeconfig is Secret `kubeconfig` in namespace `default`, key `config` (in Radar Cloud: **Resources** > **Secrets** > Reveal > Copy). Save it outside the repo, for example `~/cnh-kubeconfig`, then `export KUBECONFIG=~/cnh-kubeconfig`. Anyone with that file is cluster-admin. `.gitignore` blocks `*kubeconfig*`, but keep it out of the repo anyway. The token lasts 24 hours: if kubectl says `Unauthorized`, copy it again.

## If the shared cluster has a problem

`scripts/local-cluster.sh pantheon` builds the same setup on a laptop with k3d. It has no public URL, so use a port-forward. See the "Bringing a cluster of your own" section of the template's README first: it needs a separate Radar Cloud organization.

## Radar for the judges

Radar for the judges means one real decision Radar helped us make: the Checks before and after, at least one AI investigation (an all-clear on a healthy release counts), and the 5:30 story (the `demo-story` skill). `AGENTS.md` and `.agents/skills/` cover how agents do each of these.
