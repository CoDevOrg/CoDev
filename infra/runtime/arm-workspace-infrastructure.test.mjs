import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("VM attaches exactly one existing disk with explicit retention and outbound-only networking", () => {
  const template = read("../azure/arm-workspace-vm.bicep");
  assert.match(template, /createOption: 'Attach'/);
  assert.match(template, /deleteOption: 'Detach'/);
  assert.match(template, /managedDisk: \{ id: dataDiskResourceId \}/);
  assert.match(template, /lun: 0/);
  assert.match(template, /defaultOutboundAccess: false/);
  assert.match(template, /access: 'Deny'/);
  assert.doesNotMatch(
    template,
    /access: 'Allow'|diskSizeGB|customData|protectedSettings/,
  );
});

test("disk initialization refuses unidentified or already initialized saved data", () => {
  const script = read("./scripts/prepare-arm-workspace-disk.sh");
  assert.match(script, /17179869184/);
  assert.match(script, /wipefs --no-act/);
  assert.match(script, /DISK_ALREADY_INITIALIZED/);
  assert.match(script, /DISK_IDENTITY_MISMATCH/);
  assert.match(script, /SAVED_METADATA_MISSING/);
  assert.match(script, /chmod 3775 \/workspace/);
  assert.match(script, /chmod 00700/);
  assert.match(script, /InaccessiblePaths=\/workspace\/\.codev-runtime/);
  assert.match(script, /What=\/workspace\/\.codev-runtime\/superset/);
  assert.match(script, /ExecStartPre=\n/);
  assert.doesNotMatch(script, /chgrp -R|chmod -R|mkfs.*-F/);
  const image = read("./scripts/provision-arm-workspace-image.sh");
  assert.doesNotMatch(
    image,
    /ExecStartPre=.*(?:chgrp -R|chmod -R|find \/workspace)/,
  );
});

test("connection service keeps the connector credential out of process arguments", () => {
  const script = read("./scripts/install-arm-workspace-connection.sh");
  assert.match(script, /O_NOFOLLOW/);
  assert.match(script, /--token-file \/etc\/codev\/tunnel-token/);
  assert.match(script, /codev-local-api-guard.service/);
  assert.match(script, /sha256sum --check --status/);
  assert.doesNotMatch(script, /--token \$|set -x/);
});

test("stop checks generation ownership, deallocates before delete, and never deletes the data disk", () => {
  const script = read("../azure/stop-arm-workspace-vm.sh");
  assert.match(script, /tags.get\("Generation"\) == sys.argv\[2\]/);
  assert.match(script, /PowerState\/deallocated/);
  assert.ok(
    script.indexOf("az vm deallocate") < script.indexOf("az vm delete"),
  );
  assert.doesNotMatch(script, /az disk delete|group delete/);
});

test("stale teardown performs no Azure mutations; retry cleans only surviving generation resources", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codev-arm-stop-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, "calls");
  await writeFile(
    join(directory, "az"),
    `#!/bin/bash
echo "$*" >> "$MOCK_LOG"
case "$1 $2" in
  'account show') echo subscription ;;
  'resource list')
    if [[ "$*" == *'-o tsv'* ]]; then
      echo /subscriptions/subscription/resourceGroups/codev-arm-workspace-test/providers/Microsoft.Network/networkInterfaces/candidate-nic
    else
      echo '[{"name":"candidate-nic","id":"/subscriptions/subscription/resourceGroups/codev-arm-workspace-test/providers/Microsoft.Network/networkInterfaces/candidate-nic"}]'
    fi ;;
  'resource show') echo "{\\"Runtime\\":\\"arm-workspace\\",\\"WorkspaceId\\":\\"workspace\\",\\"Generation\\":\\"$MOCK_GENERATION\\"}" ;;
  'resource delete') exit 0 ;;
  *) exit 99 ;;
esac
`,
    { mode: 0o755 },
  );
  const options = {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      AZURE_RESOURCE_GROUP: "codev-arm-workspace-test",
      MOCK_LOG: log,
      MOCK_GENERATION: "2",
    },
  };
  const script = new URL("../azure/stop-arm-workspace-vm.sh", import.meta.url)
    .pathname;
  await assert.rejects(
    promisify(execFile)(
      "bash",
      [script, "candidate", "workspace", "1"],
      options,
    ),
  );
  assert.doesNotMatch(await readFile(log, "utf8"), /delete|deallocate/);
  await writeFile(log, "");
  options.env.MOCK_GENERATION = "1";
  await promisify(execFile)(
    "bash",
    [script, "candidate", "workspace", "1"],
    options,
  );
  const calls = await readFile(log, "utf8");
  assert.equal(calls.match(/resource delete/g)?.length, 1);
  assert.doesNotMatch(calls, /disk delete|vm deallocate/);
});
