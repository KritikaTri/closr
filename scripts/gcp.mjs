import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(resolve(root, "deploy/gcp.json"), "utf8"));
const command = process.argv[2] || "plan";
const requiredApis = ["run.googleapis.com", "sqladmin.googleapis.com", "artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "secretmanager.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "storage.googleapis.com", "cloudbilling.googleapis.com", "billingbudgets.googleapis.com"];
const requiredSecrets = { DATABASE_URL: "closer-staging-database-url", BETTER_AUTH_SECRET: "closer-staging-auth-secret", GOOGLE_CLIENT_SECRET: "closer-staging-google-secret" };
const origin = `https://${config.service}-${config.projectNumber}.${config.region}.run.app`;
const runtimeIdentity = `${config.runtimeServiceAccount}@${config.projectId}.iam.gserviceaccount.com`;
const buildIdentity = `${config.buildServiceAccount}@${config.projectId}.iam.gserviceaccount.com`;
const connectionName = `${config.projectId}:${config.region}:${config.sqlInstance}`;

// Every subprocess uses argv, never a shell. Captured results are metadata only;
// this tool never reads or prints secret payloads or bearer tokens.
function gcloud(args, { capture = false, allowFailure = false } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn("gcloud", [...args, `--project=${config.projectId}`, "--quiet"], {
      cwd: root,
      env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1" },
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    let errorOutput = "";
    child.stdout?.on("data", (data) => { output += data; });
    child.stderr?.on("data", (data) => { errorOutput += data; });
    child.on("error", (error) => reject(new Error(error.code === "ENOENT" ? "Install the Google Cloud CLI, then run gcloud auth login with your personal account." : error.message)));
    child.on("close", (code) => {
      if (code && !allowFailure) reject(new Error(capture ? errorOutput.trim() || "Google Cloud command failed." : "Google Cloud command failed; deployment stopped."));
      else resolveResult({ code, output: output.trim() });
    });
  });
}
async function metadata(args) {
  const result = await gcloud([...args, "--format=json"], { capture: true });
  return JSON.parse(result.output);
}
async function exists(args) {
  return (await gcloud([...args, "--format=value(name)"], { capture: true, allowFailure: true })).code === 0;
}
function validateConfig() {
  for (const key of ["projectId", "service", "sqlInstance", "database", "artifactRepository", "runtimeServiceAccount", "buildServiceAccount"]) {
    if (!/^[a-z][a-z0-9_-]+$/.test(config[key])) throw new Error(`Invalid deployment setting: ${key}`);
  }
  if (!/^\d+$/.test(config.projectNumber) || !/^[a-z]+-[a-z]+\d$/.test(config.region)) throw new Error("Invalid project number or region.");
  for (const key of ["minInstances", "maxInstances", "concurrency", "databasePoolSize"]) {
    if (!Number.isInteger(config[key]) || config[key] < (key === "minInstances" ? 0 : 1)) throw new Error(`Invalid deployment limit: ${key}`);
  }
  if (config.maxInstances > 2 || config.minInstances !== 0 || config.databasePoolSize * config.maxInstances > 10) {
    throw new Error("The staging limits were raised. Review the database capacity and cost plan before updating these guards.");
  }
  if (config.sqlTier !== "db-f1-micro" || !Number.isInteger(config.sqlDiskGb) || !Number.isInteger(config.sqlDiskLimitGb) || config.sqlDiskGb < 10 || config.sqlDiskLimitGb < config.sqlDiskGb || config.sqlDiskLimitGb > 20) {
    throw new Error("Review the database cost plan before raising the staging tier or disk limits.");
  }
  for (const key of ["googleWebClientId", "googleIosClientId"]) {
    if (config[key] && !/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(config[key])) throw new Error(`Invalid OAuth client ID: ${key}`);
  }
}

function plan() {
  console.log(JSON.stringify({
    status: "Prepared configuration only; no cloud resources are created by this command.",
    project: config.projectId,
    region: config.region,
    requiredApis,
    monthlyGrossUsageAlert: { currency: "INR", amount: config.monthlyAlertInr, hardSpendingCap: false },
    plannedOrigin: origin,
    googleOAuth: { applicationType: "Web application", authorizedJavaScriptOrigin: origin, authorizedRedirectUri: `${origin}/api/auth/callback/google` },
    cloudRun: { minInstances: config.minInstances, maxInstances: config.maxInstances, concurrency: config.concurrency, memory: "512Mi", cpu: 1, identity: runtimeIdentity },
    database: { instance: config.sqlInstance, name: config.database, version: "POSTGRES_17", edition: "ENTERPRISE", tier: config.sqlTier, diskGb: config.sqlDiskGb, diskGrowthLimitGb: config.sqlDiskLimitGb, automaticBackups: true, pointInTimeRecovery: true, deletionProtection: true, applicationPoolPerInstance: config.databasePoolSize },
    photos: { bucket: config.bucket, publicAccess: "prevented", access: "Owner/couple authorization followed by short-lived signed URLs." },
    build: { repository: config.artifactRepository, sourceBucket: config.sourceBucket, identity: buildIdentity, logs: "Cloud Logging only", secretPayloadsInBuild: false },
    secretNames: requiredSecrets,
    requirements: ["Personal Google Cloud CLI sign-in", "Billing enabled and cost plan reviewed", "Required APIs, service accounts, scoped IAM grants, and infrastructure provisioned", "Google OAuth client and consent screen configured", "Secret Manager values populated without putting them in this repository"],
    limitations: ["Shared-core PostgreSQL is for the first two-person trial, has no Cloud SQL SLA, and must be upgraded for wider launch.", "Cloud SQL has a running cost even when no one opens the app.", "This config bounds scaling, not the total bill. Storage, backups, network, builds, AI, and tax are separate.", "Apple sign-in, the AI key, signed mobile releases, and public-launch checks remain separate steps."],
  }, null, 2));
}

async function check({ forDeploy = false } = {}) {
  const account = (await gcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"], { capture: true })).output;
  if (!account) throw new Error("Google Cloud CLI is installed but not signed in. Run gcloud auth login with your personal Google account.");
  const project = await metadata(["projects", "describe", config.projectId]);
  if (String(project.projectNumber) !== config.projectNumber || project.lifecycleState !== "ACTIVE") throw new Error("Project identity or lifecycle state does not match the deployment plan.");
  const billing = await metadata(["billing", "projects", "describe", config.projectId]);
  console.log(`Signed in as ${account}. Project identity confirmed. Billing enabled: ${Boolean(billing.billingEnabled)}.`);
  const missing = [];
  if (!billing.billingEnabled) missing.push("An active billing account linked to this project");
  const apis = new Set((await metadata(["services", "list", "--enabled"])).map((api) => api.config.name));
  const disabled = requiredApis.filter((api) => !apis.has(api));
  if (disabled.length) missing.push(`Enable APIs: ${disabled.join(", ")}`);
  const versions = {};
  if (disabled.length === 0) {
    if (!await exists(["artifacts", "repositories", "describe", config.artifactRepository, `--location=${config.region}`])) missing.push("Artifact Registry repository");
    for (const identity of [runtimeIdentity, buildIdentity]) {
      if (!await exists(["iam", "service-accounts", "describe", identity])) missing.push(`Service account: ${identity}`);
    }
    for (const bucket of [config.bucket, config.sourceBucket]) {
      const result = await gcloud(["storage", "buckets", "describe", `gs://${bucket}`, "--format=json"], { capture: true, allowFailure: true });
      if (result.code) missing.push(`Private bucket: ${bucket}`);
      else {
        const settings = JSON.parse(result.output);
        if (settings.public_access_prevention !== "enforced" || settings.uniform_bucket_level_access !== true || String(settings.project_number) !== config.projectNumber || String(settings.location).toLowerCase() !== config.region) {
          missing.push(`Bucket access, project, or region does not match the plan: ${bucket}`);
        }
      }
    }
    const sqlResult = await gcloud(["sql", "instances", "describe", config.sqlInstance, "--format=json"], { capture: true, allowFailure: true });
    if (sqlResult.code) missing.push("PostgreSQL instance and application database");
    else {
      const sql = JSON.parse(sqlResult.output);
      if (sql.state !== "RUNNABLE" || sql.region !== config.region || sql.databaseVersion !== "POSTGRES_17" || sql.settings.ipConfiguration.authorizedNetworks?.length) missing.push("Review PostgreSQL state, region, version, and public network access");
      if (sql.settings.tier !== config.sqlTier || sql.settings.edition !== "ENTERPRISE" || Number(sql.settings.dataDiskSizeGb) > config.sqlDiskLimitGb || Number(sql.settings.storageAutoResizeLimit) !== config.sqlDiskLimitGb) missing.push("Review PostgreSQL tier and disk growth against the staging cost plan");
      if (!["ENCRYPTED_ONLY", "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"].includes(sql.settings.ipConfiguration.sslMode)) missing.push("Require encrypted direct PostgreSQL connections");
      if (!sql.settings.backupConfiguration?.enabled || !sql.settings.backupConfiguration?.pointInTimeRecoveryEnabled || !sql.settings.deletionProtectionEnabled) missing.push("Enable PostgreSQL backups, point-in-time recovery, and deletion protection");
      if (!await exists(["sql", "databases", "describe", config.database, `--instance=${config.sqlInstance}`])) missing.push(`Application database: ${config.database}`);
    }
    for (const [variable, secret] of Object.entries(requiredSecrets)) {
      const result = await gcloud(["secrets", "versions", "list", secret, "--filter=state:ENABLED", "--sort-by=~createTime", "--limit=1", "--format=value(name)"], { capture: true, allowFailure: true });
      if (result.code || !result.output) missing.push(`Secret Manager value: ${secret}`);
      else versions[variable] = `${secret}:${result.output.split("/").at(-1)}`;
    }
  }
  if (!config.googleWebClientId) missing.push("Google web OAuth client ID in deploy/gcp.json");
  if (missing.length) {
    console.log("Still required:\n" + missing.map((item) => `- ${item}`).join("\n"));
    if (forDeploy) throw new Error("Preflight is incomplete. No image build or deployment started.");
    process.exitCode = 1;
  } else console.log("Resource configuration preflight complete. IAM permissions and real sign-in still need confirmation during deployment.");
  return versions;
}

async function buildImage() {
  const directory = resolve(root, ".closer-cloud");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tag = `deploy-${new Date().toISOString().replace(/[^0-9]/g, "")}`;
  const image = `${config.region}-docker.pkg.dev/${config.projectId}/${config.artifactRepository}/closer:${tag}`;
  const buildFile = resolve(directory, "cloudbuild.json");
  await writeFile(buildFile, JSON.stringify({
    steps: [{ name: "gcr.io/cloud-builders/docker", args: ["build", "--tag", image, "."] }],
    images: [image],
    options: { logging: "CLOUD_LOGGING_ONLY" },
    timeout: "1200s",
  }, null, 2), { mode: 0o600 });
  await gcloud(["builds", "submit", ".", `--region=${config.region}`, `--config=${buildFile}`, `--gcs-source-staging-dir=gs://${config.sourceBucket}/source`, `--service-account=projects/${config.projectId}/serviceAccounts/${buildIdentity}`]);
  const digest = (await gcloud(["artifacts", "docker", "images", "describe", image, "--format=value(image_summary.digest)"], { capture: true })).output;
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Could not resolve an immutable image digest. Deployment stopped.");
  const pinnedImage = `${image.slice(0, image.lastIndexOf(":"))}@${digest}`;
  await writeFile(resolve(directory, "last-build.json"), JSON.stringify({ image: pinnedImage, time: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(`Built immutable image: ${pinnedImage}`);
  return pinnedImage;
}

async function deploy() {
  if (!process.argv.includes("--apply")) {
    plan();
    console.log("Deployment requires --apply after cloud:check and infrastructure cost review.");
    return;
  }
  const versions = await check({ forDeploy: true });
  const reuse = process.argv.find((value) => value.startsWith("--image="))?.slice("--image=".length);
  const expectedPrefix = `${config.region}-docker.pkg.dev/${config.projectId}/${config.artifactRepository}/closer@`;
  if (reuse && (!reuse.startsWith(expectedPrefix) || !/^sha256:[a-f0-9]{64}$/.test(reuse.slice(expectedPrefix.length)))) throw new Error("Reuse requires an immutable image digest from the reviewed project/repository.");
  const pinnedImage = reuse || await buildImage();
  const directory = resolve(root, ".closer-cloud");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const env = {
    NODE_ENV: "production", HOST: "0.0.0.0", AUTH_REQUIRED: "true",
    BETTER_AUTH_URL: origin, APP_ORIGINS: `${origin},capacitor://localhost,https://localhost`,
    DATABASE_POOL_SIZE: String(config.databasePoolSize), DATABASE_SSL: "false",
    GCS_BUCKET: config.bucket, GOOGLE_CLIENT_ID: config.googleWebClientId,
    ...(config.googleIosClientId ? { GOOGLE_IOS_CLIENT_ID: config.googleIosClientId } : {}),
    REQUIRE_APPLE_SIGN_IN: "false",
  };
  const envFile = resolve(directory, "environment.json");
  await writeFile(envFile, JSON.stringify(env, null, 2), { mode: 0o600 });
  const secrets = Object.entries(versions).map(([variable, version]) => `${variable}=${version}`).join(",");
  const common = [`--region=${config.region}`, `--image=${pinnedImage}`, `--service-account=${runtimeIdentity}`, `--env-vars-file=${envFile}`, `--set-secrets=${secrets}`, "--memory=512Mi", "--cpu=1"];
  // This job completes before a new app revision receives traffic. App replicas
  // never run migrations in their startup path.
  await gcloud(["run", "jobs", "deploy", `${config.service}-migrate`, ...common, `--set-cloudsql-instances=${connectionName}`, "--command=node", "--args=scripts/migrate-all.mjs", "--tasks=1", "--parallelism=1", "--max-retries=0", "--task-timeout=600s"]);
  await gcloud(["run", "jobs", "execute", `${config.service}-migrate`, `--region=${config.region}`, "--wait"]);
  await gcloud(["run", "deploy", config.service, ...common, `--add-cloudsql-instances=${connectionName}`, "--allow-unauthenticated", "--ingress=all", `--min=${config.minInstances}`, `--max=${config.maxInstances}`, `--concurrency=${config.concurrency}`, "--timeout=60s", "--port=8080", "--startup-probe=httpGet.path=/readyz,timeoutSeconds=5,periodSeconds=5,failureThreshold=24", "--liveness-probe=httpGet.path=/healthz,timeoutSeconds=5,periodSeconds=30,failureThreshold=3"]);
  await writeFile(resolve(directory, "last-deployment.json"), JSON.stringify({ projectId: config.projectId, service: config.service, region: config.region, image: pinnedImage, origin, time: new Date().toISOString(), verification: "Cloud Run deployment completed; two-account/device checks have not been performed." }, null, 2), { mode: 0o600 });
  console.log(`Staging deployed at ${origin}. Next: verify /readyz, real Google login, pairing, sync, and private-journal isolation on two accounts. This is not a mobile store release.`);
}

try {
  validateConfig();
  if (command === "plan") plan();
  else if (command === "check") await check();
  else if (command === "build") {
    if (process.argv.includes("--apply")) await buildImage();
    else plan();
  }
  else if (command === "deploy") await deploy();
  else throw new Error("Use plan, check, build [--apply], or deploy [--apply] [--image=IMMUTABLE_IMAGE].");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
