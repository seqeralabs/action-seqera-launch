#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const manifest = parse(await readFile(resolve(root, "action.yml"), "utf8"));
const bundle = resolve(root, manifest.runs.main);
assert.equal(manifest.runs.using, "node24");
assert.ok(Number(process.versions.node.split(".")[0]) >= 24, "Use Node 24 or newer");
const hash = createHash("sha256").update(await readFile(bundle)).digest("hex");
const scenarios = {
  primary: { inputs: { wait: "none" }, statuses: ["SUBMITTED"] },
  named: { inputs: { "compute-env": "secondary", wait: "none" }, statuses: ["SUBMITTED"] },
  running: { inputs: {}, statuses: ["SUBMITTED", "RUNNING"] },
  completion: { inputs: { wait: "completion", "compute-env-id": "explicit", "compute-env": "ignored", "work-dir": "s3://explicit/work" }, statuses: ["RUNNING", "SUCCEEDED"] },
  failure: { inputs: { wait: "completion" }, statuses: ["FAILED"] },
  invalid: { inputs: { wait: "invalid" }, statuses: [] },
};
const selected = process.argv[2] ?? "all";
if (selected === "doctor") {
  console.log(JSON.stringify({ node: process.version, bundle, sha256: hash, scenarios: Object.keys(scenarios) }, null, 2));
  process.exit(0);
}
assert.ok(selected === "all" || Object.hasOwn(scenarios, selected), `Unknown scenario: ${selected}`);
const artifacts = resolve(root, ".amp/in/artifacts");
await mkdir(artifacts, { recursive: true });
const evidence = await mkdtemp(resolve(artifacts, "verify-seqera-"));
console.log(`Evidence: ${evidence}`);
const results = [];

for (const [name, scenario] of Object.entries(scenarios)) {
  if (selected !== "all" && name !== selected) continue;
  const dir = resolve(evidence, name);
  await mkdir(dir);
  const output = resolve(dir, "github-output.txt");
  const summary = resolve(dir, "summary.html");
  await writeFile(output, "");
  await writeFile(summary, "");
  const requests = [];
  const unexpected = [];
  let polls = 0;
  const server = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push({ method: req.method, url: req.url, body });
      assert.equal(req.headers.authorization, "Bearer local-verification-token");
      const url = new URL(req.url, "http://127.0.0.1");
      assert.equal(url.searchParams.get("workspaceId"), "42");
      let response;
      if (req.method === "GET" && url.pathname === "/compute-envs") {
        response = { computeEnvs: [
          { id: "ce-secondary", name: "secondary", status: "AVAILABLE", workDir: "s3://secondary/work" },
          { id: "ce-primary", name: "primary", primary: true, status: "AVAILABLE", workDir: "s3://primary/work" },
        ] };
      } else if (req.method === "POST" && url.pathname === "/workflow/launch") {
        response = { workflowId: "wf-local" };
      } else if (req.method === "GET" && url.pathname === "/workflow/wf-local") {
        const status = scenario.statuses[Math.min(polls++, scenario.statuses.length - 1)];
        response = { orgName: "seqera", workspaceName: "verification", workspaceId: 42,
          workflow: { id: "wf-local", status, errorMessage: name === "failure" ? "Pipeline failed" : null, errorReport: null, exitStatus: name === "failure" ? 1 : null } };
      } else if (req.method === "GET" && url.pathname === "/workflow/wf-local/tasks") {
        assert.equal(url.searchParams.get("search"), "status:failed");
        response = { tasks: [{ task: { taskId: 7, name: "ALIGN", errorMessage: "Alignment failed" } }] };
      } else if (req.method === "GET" && url.pathname === "/workflow/wf-local/log/7") {
        response = { log: { entries: [{ stderr: "fixture stderr: reference missing" }] } };
      } else {
        throw new Error(`Unexpected request: ${req.method} ${req.url}`);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    } catch (error) {
      unexpected.push(String(error));
      res.writeHead(400);
      res.end(JSON.stringify({ message: String(error) }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const inputs = Object.fromEntries(Object.entries(manifest.inputs)
      .filter(([key, value]) => value.default !== undefined && key !== "pipeline")
      .map(([key, value]) => [key, String(value.default)]));
    Object.assign(inputs, {
      "access-token": "local-verification-token",
      "api-endpoint": `http://127.0.0.1:${server.address().port}`,
      "workspace-id": "42", parameters: "reads: 3\npaired: false", profiles: "test,docker",
      "stub-run": "true", ...scenario.inputs,
    });
    const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: "verification/example", GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary };
    for (const [key, value] of Object.entries(inputs)) env[`INPUT_${key.toUpperCase()}`] = value;
    await writeFile(resolve(dir, "inputs.json"), JSON.stringify(inputs, null, 2));
    const run = await new Promise((done) => {
      execFile(process.execPath, [bundle], { cwd: root, env, timeout: 30000 }, (error, stdout, stderr) => {
        done({ exitCode: error ? error.code : 0, killed: error?.killed ?? false, stdout, stderr });
      });
    });
    await writeFile(resolve(dir, "process.json"), JSON.stringify(run, null, 2));
    await writeFile(resolve(dir, "requests.json"), JSON.stringify(requests, null, 2));
    assert.deepEqual(unexpected, []);
    assert.equal(run.killed, false, "Action exceeded 30 seconds");
    assert.equal(run.exitCode, name === "failure" || name === "invalid" ? 1 : 0);
    const rawOutputs = await readFile(output, "utf8");
    const html = await readFile(summary, "utf8");
    if (name === "invalid") {
      assert.deepEqual(requests, [], "Invalid input must fail before HTTP requests");
      assert.equal(rawOutputs, "");
      assert.match(run.stdout, /wait/u);
    } else {
      const launches = requests.filter((request) => request.method === "POST");
      assert.equal(launches.length, 1);
      const launch = JSON.parse(launches[0].body).launch;
      assert.equal(launch.pipeline, "https://github.com/verification/example");
      assert.deepEqual(JSON.parse(launch.paramsText), { reads: 3, paired: false });
      assert.deepEqual(launch.configProfiles, ["test", "docker"]);
      assert.equal(launch.stubRun, true);
      assert.equal(launch.computeEnvId, name === "completion" ? "explicit" : name === "named" ? "ce-secondary" : "ce-primary");
      assert.equal(launch.workDir, name === "completion" ? "s3://explicit/work" : name === "named" ? "s3://secondary/work" : "s3://primary/work");
      if (name === "completion") assert.ok(!requests.some((request) => request.url.startsWith("/compute-envs")));
      assert.equal(polls, scenario.statuses.length);
      const values = Object.fromEntries([...rawOutputs.matchAll(/^([^\n]+)<<([^\n]+)\n([\s\S]*?)\n\2$/gmu)].map((match) => [match[1], match[3]]));
      assert.equal(values["workflow-id"], "wf-local");
      assert.equal(values["workflow-url"], "http://127.0.0.1/orgs/seqera/workspaces/verification/watch/wf-local");
      assert.equal(values["workspace-id"], "42");
      assert.equal(values["workspace-ref"], "seqera/verification");
      assert.equal(values.status, scenario.statuses.at(-1));
      assert.match(html, /wf-local/u);
      assert.match(html, /seqera\/verification/u);
      assert.ok(html.includes(values.status));
      if (name === "failure") {
        assert.equal(values["error-message"], "Pipeline failed");
        assert.match(run.stdout, /Failed task: ALIGN/u);
        assert.match(run.stdout, /fixture stderr: reference missing/u);
        assert.match(html, /Launch step failed/u);
      } else {
        assert.match(html, /Launch step completed successfully/u);
      }
    }
    results.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: String(error) });
    process.exitCode = 1;
    console.error(`FAIL ${name}: ${error}`);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}
await writeFile(resolve(evidence, "report.json"), JSON.stringify({ node: process.version, bundleSha256: hash, results }, null, 2));
