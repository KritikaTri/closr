# Closr staging deployment

## State of this work

The staging backend is live; see [the launch status](STATUS.md) for completed checks and remaining release work. This document describes the repeatable setup rather than proving that every check has passed. Successful deployments write an ignored `.closer-cloud/last-deployment.json` receipt. Device/account verification and mobile signing remain separate steps.

## Project and limits

`gcp.json` targets project `closr-512507`, project number `262689231739`, in Mumbai (`asia-south1`). It contains public configuration only.

| Resource | Initial configuration |
| --- | --- |
| Cloud Run | `closer-staging`, 1 vCPU, 512 MiB, 0 minimum / 2 maximum instances, concurrency 10 |
| PostgreSQL | `closer-pg`, PostgreSQL 17, Enterprise, `db-f1-micro`, 10 GiB SSD, storage growth capped at 20 GiB |
| Database | `closer_staging`, application connection pool 5 per app instance |
| Database protection | Automatic backups, point-in-time recovery, deletion protection; no authorized public client networks |
| Photos | `closr-512507-closer-staging-photos`, uniform bucket access and public access prevention |
| Build source | Separate private bucket `closr-512507-closer-build-source`; no access to photos for the build identity |
| Container images | Regional Artifact Registry repository `closer` |

This small database is intended for the first two-person staging trial. Shared-core tiers do not carry the Cloud SQL SLA. This is not the capacity or availability specification for a wider public launch.

Cloud Run can scale to zero; Cloud SQL keeps accruing running and storage costs when the app is idle. Backups, storage growth, network transfer, builds, image storage, logging, AI, and taxes can add costs. Scaling settings and an alerts-only billing budget do not cap the whole bill. Review the region-specific Cloud SQL estimate before creation. Existing trial credits can offset eligible usage while valid; do not upgrade the billing account merely to run this deployment.

`cost-estimate.json` records a Cloud Billing Catalog lookup on 26 October 2026: Mumbai zonal PostgreSQL micro compute costs ₹1.209458249/hour, or about ₹883 for 730 hours. This excludes SSD storage, backups, tax, and other services. The planned ₹2,000/month gross-usage alert is a notification threshold, not a hard limit or complete price quote.

- [Cloud SQL pricing](https://cloud.google.com/sql/pricing)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)

## 1. Authorize the local deployment tools

The Google Cloud CLI is required. In the user's Terminal:

```sh
gcloud auth login
```

Use the personal Google account that owns this project. Complete Google's consent screen directly; do not paste authentication codes or tokens into chat. The deployment script supplies `--project` explicitly, so changing a global default project is unnecessary. No downloaded service account keys are needed.

```sh
npm run cloud:plan
npm run cloud:check
```

`cloud:plan` never calls Google or changes resources. `cloud:check` reads resource metadata, not secret payloads, and lists missing prerequisites. It does not prove all IAM permissions or app functionality.

## 2. Provision infrastructure after cost review

This step is performed explicitly after cost/IAM review with `npm run cloud:provision -- --apply`; without `--apply`, the provisioning command exits without changes. `cloud:deploy` itself does not create a database, change passwords, or add IAM roles. The provisioner creates missing staging resources, configures the documented grants, source/untagged-image cleanup, and usage alert, and waits for the database. It generates credentials into Secret Manager, passes database-user credentials directly to the Cloud SQL API, and does not reset an existing user's password. A rerun still needs the same reviewed plan; it is not a general infrastructure reconciler.

Enable the APIs listed by `cloud:plan` / `cloud:check`: Cloud Run, Cloud SQL Admin, Artifact Registry, Cloud Build, Secret Manager, IAM, IAM Credentials, Storage, Cloud Billing, and Billing Budgets. Create the resources in the table above. Explicitly select Enterprise edition when using PostgreSQL 17 to avoid a larger default Enterprise Plus instance. Use `ENCRYPTED_ONLY` for direct database SSL mode. Leave authorized networks empty; the service and migration job use Cloud Run's authenticated Cloud SQL proxy and Unix socket.

Set up budget alerts before provisioning the running database. Limit alert scope to this project and exclude promotional credits if monitoring gross usage against the chosen budget. Budget/spend-cap coverage must be checked per service; it is not a universal cap on Cloud SQL or all Google Cloud spending. Use a separate budget for OpenAI when AI is enabled.

Create two service accounts and scope their grants:

| Identity | Access |
| --- | --- |
| `closer-runtime` | Cloud SQL Client on this project; Storage Object User on the **photo bucket only**; Secret Accessor separately on the three staging secrets below |
| `closer-runtime` | Service Account Token Creator on **itself only**, for private photo signed URLs |
| `closer-build` | Artifact Registry Writer on the **closer repository only**; Storage Object Viewer on the **build-source bucket only**; Logs Writer on this project |

The deploying human needs permission to act as these identities, submit builds, deploy services/jobs, and configure the service's public invocation policy. The app's Google authentication continues to protect API data when Cloud Run invocation is public. Do not grant the build identity access to app secrets, the database, or the photo bucket.

Apply a short retention lifecycle to uploaded **build source** and an Artifact Registry cleanup policy that preserves deployed/rollback images. Do not apply the source lifecycle to the photo bucket. Configure backup retention explicitly and review available database connection capacity for the two app instances plus a migration job.

For staging, the migration job uses the runtime identity and database credentials. Separate migration DDL privileges from application DML privileges before wider public launch. Cloud SQL's managed database users can have elevated default role membership; review those grants when separating the roles.

## 3. Configure Google login and secrets

The deterministic URL in this plan is:

```text
https://closer-staging-262689231739.asia-south1.run.app
```

The service is deployed at this URL. [Google documents the deterministic URL format](https://docs.cloud.google.com/run/docs/triggering/https-request#deterministic).

Create a Google OAuth **Web application** client in this project with:

- Authorized JavaScript origin: the URL above.
- Authorized redirect URI: the URL above followed by `/api/auth/callback/google`.

Configure the Google Auth consent screen with only the basic identity scopes: `openid`, `email`, and `profile` (or their `userinfo` equivalents). [Google exempts these sign-in-only requests from the Testing-mode test-user allowlist and seven-day authorization expiry](https://support.google.com/cloud/answer/15549945?hl=en). Adding a second account to Google's test-user list is not a prerequisite for Closr's current login. Recheck Google's requirements before requesting any additional scopes.

Google's tester list is not an application access policy for these scopes. A signed-in account can create its own couple space; a one-use partner invite controls access to an existing space. Store only the public web client ID in `gcp.json` as `googleWebClientId`. Add the public iOS client ID later when setting up native iOS login.

Normal sign-in opens the home screen even when the account has no partner or couple space. Private journals and their photos are scoped to the account and do not require pairing. Creating an invitation from home prepares a couple space only when needed; opening an invitation requires a separate acceptance after Google login. A previously created empty one-person invitation space can be retired when joining another invitation, while private entries stay with the account. A connected space or one with saved shared content is never silently replaced.

Create these Secret Manager secrets directly in the project:

| Secret | Contents |
| --- | --- |
| `closer-staging-database-url` | PostgreSQL connection URI for `closer_staging`, with a URL-encoded password and `/cloudsql/closr-512507:asia-south1:closer-pg` as its URL-encoded socket host query parameter |
| `closer-staging-auth-secret` | Random secret of at least 32 characters |
| `closer-staging-google-secret` | Google web OAuth client secret |

Do not put secret values in `gcp.json`, a command-line argument, this runbook, GitHub, or browser build variables. `.env.*` and `.closer-cloud/` are ignored by Git; Docker and Google uploads use explicit source-file allowlists. If using a local secret file, keep it outside the upload inputs with owner-only permissions.

The Cloud SQL proxy encrypts and authenticates its connection to Google; the Node PostgreSQL driver uses the local Unix socket with `DATABASE_SSL=false`. This is not a direct unencrypted public database connection.

Apple and AI are intentionally not configured by this Google-only staging deploy command. Partial Apple credentials are rejected. Before an iOS store release, add all Apple credentials, set `REQUIRE_APPLE_SIGN_IN=true`, and update the deployment configuration to mount the private key. Add the AI secret and model/cost controls when enabling AI. The mobile release build still requires its existing provider configuration.

## 4. Build, migrate, then deploy

```sh
npm run cloud:check
npm run cloud:deploy -- --apply
```

To build while the database is still provisioning, `npm run cloud:build -- --apply` writes an ignored `.closer-cloud/last-build.json` receipt. Deploy that exact digest with `npm run cloud:deploy -- --apply --image=IMMUTABLE_IMAGE`; only a digest in this project's reviewed Artifact Registry image path is accepted. Do not reuse an image after changing its application source without rebuilding.

The deploy command:

1. Checks project identity, billing, enabled APIs, resource settings, and secret-version metadata.
2. Builds the web assets and production container in Cloud Build. `.env` files and native signing files are not uploaded.
3. Pins the resulting image digest and enabled secret version numbers.
4. Runs `scripts/migrate-all.mjs` as a single Cloud Run Job with no automatic retries. Better Auth and Closr schema changes are serialized by an advisory lock; completed Closr migrations are recorded with checksums. Application instances do not migrate on startup.
5. Deploys that same image as the service. Startup probes use `/api/ready`; liveness probes use `/api/health`. The app refuses insecure production auth configuration.

Use the same probe URLs for external monitoring. [Cloud Run reserves some URL paths ending in `z`](https://docs.cloud.google.com/run/docs/known-issues#reserved-url-paths), so paths such as `/healthz` can return Google's 404 before reaching the app.

An existing app revision keeps serving if the build or migration job fails. Do not apply destructive migrations to a running service; future data/schema changes need backwards-compatible expand/contract steps and a tested backup recovery path. A failed migration does not automatically roll back earlier completed migrations.

## 5. Before anyone treats this as a release

Confirm `/api/ready`, actual Google login, two-account pairing, status/ping/chat synchronization, private journal/photo isolation, account deletion, and backup restoration in staging. No real device checks, signed APK/AAB/IPA, or store submissions are implied by successful deployment. Also finish the shared rate limiter, retention/export and privacy disclosures, native dependency license inventory, Apple sign-in, and store signing before wider launch.
