import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const c = JSON.parse(await readFile(new URL("../deploy/gcp.json", import.meta.url), "utf8"));
if (!process.argv.includes("--apply")) {
  console.log("Provisioning is opt-in. Review deploy/README.md and the cost plan before using --apply.");
  process.exit(0);
}
if (c.projectId !== "closr-512507" || c.region !== "asia-south1" || c.sqlTier !== "db-f1-micro") throw new Error("Provisioning target differs from the reviewed staging plan.");

function cli(args, { input, allowFailure = false } = {}) {
  return new Promise((done, fail) => {
    const process = spawn("gcloud", [...args, `--project=${c.projectId}`, "--quiet"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", error = "";
    process.stdout.on("data", (bytes) => { output += bytes; });
    process.stderr.on("data", (bytes) => { error += bytes; });
    process.on("error", fail);
    process.on("close", (code) => code && !allowFailure ? fail(new Error(error.trim() || "Cloud provisioning command failed.")) : done({ code, output: output.trim() }));
    process.stdin.end(input);
  });
}
async function exists(args) { return (await cli([...args, "--format=value(name)"], { allowFailure: true })).code === 0; }
async function json(args) { return JSON.parse((await cli([...args, "--format=json"])).output); }
const runtime = `${c.runtimeServiceAccount}@${c.projectId}.iam.gserviceaccount.com`;
const builder = `${c.buildServiceAccount}@${c.projectId}.iam.gserviceaccount.com`;
const runtimeMember = `serviceAccount:${runtime}`, buildMember = `serviceAccount:${builder}`;
const secretIds = ["closer-staging-database-url", "closer-staging-auth-secret", "closer-staging-google-secret"];

if (!await exists(["sql", "instances", "describe", c.sqlInstance])) {
  await cli(["sql", "instances", "create", c.sqlInstance, `--region=${c.region}`, "--database-version=POSTGRES_17", "--edition=ENTERPRISE", `--tier=${c.sqlTier}`, "--availability-type=ZONAL", "--storage-type=SSD", `--storage-size=${c.sqlDiskGb}GB`, "--storage-auto-increase", `--storage-auto-increase-limit=${c.sqlDiskLimitGb}`, "--backup-start-time=20:30", "--retained-backups-count=7", "--enable-point-in-time-recovery", "--retained-transaction-log-days=7", "--deletion-protection", "--ssl-mode=ENCRYPTED_ONLY", "--assign-ip", "--async"]);
  console.log("PostgreSQL provisioning started with the reviewed staging settings.");
}

async function secretMetadata(id) {
  if (!await exists(["secrets", "describe", id])) await cli(["secrets", "create", id, "--replication-policy=automatic"]);
}
async function secretValue(id, factory, readExisting = false) {
  await secretMetadata(id);
  const version = (await cli(["secrets", "versions", "list", id, "--filter=state:ENABLED", "--sort-by=~createTime", "--limit=1", "--format=value(name)"])).output;
  if (version) return readExisting ? (await cli(["secrets", "versions", "access", version.split("/").at(-1), `--secret=${id}`])).output : undefined;
  const value = factory();
  await cli(["secrets", "versions", "add", id, "--data-file=-"], { input: value });
  console.log(`Configured private secret: ${id}`);
  return value;
}

for (const [id, label] of [[c.runtimeServiceAccount, "Closer staging runtime"], [c.buildServiceAccount, "Closer container builder"]]) {
  if (!await exists(["iam", "service-accounts", "describe", `${id}@${c.projectId}.iam.gserviceaccount.com`])) await cli(["iam", "service-accounts", "create", id, `--display-name=${label}`]);
  console.log(`Service account ready: ${id}`);
}
if (!await exists(["artifacts", "repositories", "describe", c.artifactRepository, `--location=${c.region}`])) await cli(["artifacts", "repositories", "create", c.artifactRepository, `--location=${c.region}`, "--repository-format=docker", "--description=Closer staging container images"]);
for (const bucket of [c.bucket, c.sourceBucket]) {
  if (!await exists(["storage", "buckets", "describe", `gs://${bucket}`])) await cli(["storage", "buckets", "create", `gs://${bucket}`, `--location=${c.region}`, "--uniform-bucket-level-access", "--public-access-prevention"]);
  console.log(`Private bucket ready: ${bucket}`);
}
await cli(["projects", "add-iam-policy-binding", c.projectId, `--member=${runtimeMember}`, "--role=roles/cloudsql.client", "--condition=None"]);
await cli(["projects", "add-iam-policy-binding", c.projectId, `--member=${buildMember}`, "--role=roles/logging.logWriter", "--condition=None"]);
await cli(["storage", "buckets", "add-iam-policy-binding", `gs://${c.bucket}`, `--member=${runtimeMember}`, "--role=roles/storage.objectUser"]);
await cli(["storage", "buckets", "add-iam-policy-binding", `gs://${c.sourceBucket}`, `--member=${buildMember}`, "--role=roles/storage.objectViewer"]);
await cli(["artifacts", "repositories", "add-iam-policy-binding", c.artifactRepository, `--location=${c.region}`, `--member=${buildMember}`, "--role=roles/artifactregistry.writer"]);
await cli(["iam", "service-accounts", "add-iam-policy-binding", runtime, `--member=${runtimeMember}`, "--role=roles/iam.serviceAccountTokenCreator"]);
for (const id of secretIds) {
  await secretMetadata(id);
  await cli(["secrets", "add-iam-policy-binding", id, `--member=${runtimeMember}`, "--role=roles/secretmanager.secretAccessor"]);
}
console.log("Scoped build/runtime permissions configured.");

await mkdir(new URL("../.closer-cloud/", import.meta.url), { recursive: true, mode: 0o700 });
const lifecycleFile = fileURLToPath(new URL("../.closer-cloud/build-source-lifecycle.json", import.meta.url));
await writeFile(lifecycleFile, JSON.stringify({ rule: [{ action: { type: "Delete" }, condition: { age: 7 } }] }), { mode: 0o600 });
await cli(["storage", "buckets", "update", `gs://${c.sourceBucket}`, `--lifecycle-file=${lifecycleFile}`]);
const cleanupFile = fileURLToPath(new URL("../.closer-cloud/image-cleanup.json", import.meta.url));
await writeFile(cleanupFile, JSON.stringify([{ name: "delete-old-untagged", action: { type: "Delete" }, condition: { tagState: "untagged", olderThan: "30d" } }]), { mode: 0o600 });
await cli(["artifacts", "repositories", "set-cleanup-policies", c.artifactRepository, `--location=${c.region}`, `--policy=${cleanupFile}`, "--no-dry-run"]);

const billing = await json(["billing", "projects", "describe", c.projectId]);
const billingAccount = billing.billingAccountName.split("/").at(-1);
const budgets = await json(["billing", "budgets", "list", `--billing-account=${billingAccount}`]);
const budgetName = "Closer staging gross monthly";
if (!budgets.some((budget) => budget.displayName === budgetName)) {
  await cli(["billing", "budgets", "create", `--billing-account=${billingAccount}`, `--display-name=${budgetName}`, `--budget-amount=${c.monthlyAlertInr}INR`, `--filter-projects=projects/${c.projectNumber}`, "--credit-types-treatment=exclude-all-credits", "--threshold-rule=percent=0.5", "--threshold-rule=percent=0.8", "--threshold-rule=percent=1.0"]);
}
console.log(`Monthly gross-usage alert configured at INR ${c.monthlyAlertInr}; this is not a spending cap.`);
await secretValue("closer-staging-auth-secret", () => randomBytes(48).toString("base64url"));

console.log("Waiting for the PostgreSQL instance to become ready.");
const started = Date.now();
let state;
while (true) {
  const sql = await json(["sql", "instances", "describe", c.sqlInstance]);
  if (sql.state !== state) { state = sql.state; console.log(`PostgreSQL state: ${state}`); }
  if (state === "RUNNABLE") break;
  if (["FAILED", "SUSPENDED", "MAINTENANCE"].includes(state) || Date.now() - started > 1_800_000) throw new Error("PostgreSQL provisioning needs attention; credentials have not been changed.");
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
if (!await exists(["sql", "databases", "describe", c.database, `--instance=${c.sqlInstance}`])) await cli(["sql", "databases", "create", c.database, `--instance=${c.sqlInstance}`]);
const users = await json(["sql", "users", "list", `--instance=${c.sqlInstance}`]);
const userExists = users.some((user) => user.name === "closer_app");
const versions = (await cli(["secrets", "versions", "list", secretIds[0], "--filter=state:ENABLED", "--limit=1", "--format=value(name)"])).output;
if (userExists && !versions) throw new Error("Existing database user has no stored credentials. Stopped without resetting its password.");
const uri = await secretValue(secretIds[0], () => {
  const password = randomBytes(36).toString("base64url");
  const host = `/cloudsql/${c.projectId}:${c.region}:${c.sqlInstance}`;
  return `postgresql://closer_app:${encodeURIComponent(password)}@localhost/${c.database}?host=${encodeURIComponent(host)}`;
}, true);
if (!userExists) {
  const token = (await cli(["auth", "print-access-token"])).output;
  const response = await fetch(`https://sqladmin.googleapis.com/sql/v1beta4/projects/${c.projectId}/instances/${c.sqlInstance}/users`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "closer_app", password: decodeURIComponent(new URL(uri).password), type: "BUILT_IN" }),
  });
  if (!response.ok) throw new Error(`Database-user creation returned HTTP ${response.status}; its credentials are already stored privately in Secret Manager.`);
  const operation = await response.json();
  await cli(["sql", "operations", "wait", operation.name, "--timeout=300"]);
}
console.log("Staging infrastructure is ready. Google OAuth client credentials and application deployment are the remaining steps.");
