import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
  assert.match(script, /CODEV_DISK_MODE/);
  assert.match(script, /CODEV_DISK_EXPECTED_UUID/);
  assert.doesNotMatch(script, /readonly mode=\$\{1:/);
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

test("saved Git recovery is a no-op on a new disk and clears stale locks on a saved one", async (t) => {
  const script = read("./scripts/prepare-arm-workspace-disk.sh");
  const body = script.match(/^recover_git_state\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];
  assert.ok(body, "recover_git_state must stay a top-level function");
  // Resolve symlinked temp roots so Git's absolute path matches, as /workspace does.
  const root = await realpath(await mkdtemp(join(tmpdir(), "codev-recover-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Stub fuser as Linux psmisc reports an unheld lock; macOS rejects -s.
  await promisify(execFile)("mkdir", ["-p", join(root, "bin")]);
  await writeFile(join(root, "bin", "fuser"), "#!/bin/sh\nexit 1\n", {
    mode: 0o755,
  });
  const run = (workspace) =>
    promisify(execFile)(
      "bash",
      [
        "-c",
        `set -euo pipefail\n${body.replaceAll("/workspace", workspace)}recover_git_state\necho recovered`,
      ],
      {
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
        },
      },
    );
  const fresh = join(root, "fresh");
  await promisify(execFile)("mkdir", ["-p", fresh]);
  assert.equal((await run(fresh)).stdout.trim(), "recovered");
  const saved = join(root, "saved");
  await promisify(execFile)("git", ["init", "-q", saved]);
  await writeFile(join(saved, ".git", "index.lock"), "");
  assert.equal((await run(saved)).stdout.trim(), "recovered");
  await assert.rejects(readFile(join(saved, ".git", "index.lock")));
});

test("connection setup waits for dpkg and keeps connector credentials out of process arguments", () => {
  const script = read("./scripts/install-arm-workspace-connection.sh");
  assert.match(script, /O_NOFOLLOW/);
  assert.match(script, /--token-file \/etc\/codev\/tunnel-token/);
  assert.match(script, /codev-local-api-guard.service/);
  assert.match(script, /sha256sum --check --status/);
  assert.match(script, /lock was locked by another process/);
  assert.match(script, /SECONDS >= install_deadline/);
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

test("baked boot verifies the disk before mounting and turns subsequent boots into saved-disk opens", () => {
  const image = read("./scripts/provision-arm-workspace-image.sh");
  const boot = read("./scripts/boot-arm-workspace.sh");
  const activation = read("./scripts/activate-arm-workspace-boot.sh");
  const installer = read("./scripts/install-arm-workspace-boot.sh");
  assert.doesNotMatch(
    image,
    /ln -s .*multi-user.target.wants\/(?:workspace.mount|codev-guestd.service)/,
  );
  assert.match(boot, /subprocess.run.*codev-prepare-arm-disk.*check=True/);
  assert.match(boot, /config\["diskMode"\] = "existing"/);
  assert.doesNotMatch(boot + activation, /curl|apt-get|dpkg|--token /);
  assert.match(activation, /O_NOFOLLOW/);
  assert.match(activation, /systemctl start codev-arm-boot/);
  assert.match(installer, /--token-file \/etc\/codev\/tunnel-token/);
});

function unitBody(script, name) {
  const body = script.match(
    new RegExp(
      `cat >/etc/systemd/system/${name} <<'UNIT'\\n([\\s\\S]*?)\\nUNIT`,
    ),
  )?.[1];
  assert.ok(body, `${name} must be written by a heredoc`);
  return body.split("\n");
}

test("the preview proxy runs as a dynamic user behind a socket held from early boot", () => {
  const installer = read("./scripts/install-arm-workspace-boot.sh");
  const socket = unitBody(installer, "codev-arm-preview.socket");
  for (const line of [
    "ListenStream=127.0.0.1:5261",
    "FreeBind=yes",
    "NoDelay=true",
    "WantedBy=sockets.target",
  ])
    assert.ok(socket.includes(line), line);
  const service = unitBody(installer, "codev-arm-preview.service");
  for (const line of [
    "ExecStart=/usr/bin/node /usr/local/lib/codev/start-arm-workspace-preview.mjs",
    "Requires=codev-arm-preview.socket",
    "StartLimitIntervalSec=0",
    "Restart=always",
    "DynamicUser=yes",
    "NoNewPrivileges=yes",
    "ProtectSystem=strict",
    "ProtectHome=yes",
    "PrivateTmp=yes",
    "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
    "IPAddressDeny=any",
    "IPAddressAllow=localhost",
    "InaccessiblePaths=/workspace /var/lib/codev /etc/codev",
    "ReadOnlyPaths=-/etc/codev-preview",
    "MemoryMax=256M",
  ])
    assert.ok(service.includes(line), line);
  // A fixed uid could be 0, 1000 or 2000; ProcSubset=pid would hide /proc/net.
  for (const line of service)
    assert.doesNotMatch(line, /^(?:User|Group|ProcSubset|PrivateNetwork)=/);
  assert.match(installer, /^systemctl enable codev-arm-preview\.socket/m);
});

test("activation writes only the public preview identity, readable despite umask 077", async (t) => {
  const script = read("./scripts/activate-arm-workspace-boot.sh");
  const code = script.match(/python3 -c '\n([\s\S]*?)\n'\n/)?.[1];
  assert.ok(code, "activation must keep its inline Python");
  const root = await mkdtemp(join(tmpdir(), "codev-activate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const program = join(root, "activate.py");
  await writeFile(
    program,
    code
      .replaceAll("/etc/codev-preview", join(root, "preview"))
      .replaceAll("/etc/codev", join(root, "codev")),
  );
  const verificationKey =
    "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAexample\n-----END PUBLIC KEY-----\n";
  const input = {
    workspaceId: "8a1f2c9e-0d4b-4f53-9a51-3b0f7f0a4c11",
    generation: 3,
    audience: "codev-0123456789abcdef0123-g3.trycodev.com",
    diskUuid: "7ddb1948-b876-4f47-80fe-7b9c8e0b6fad",
    verificationKey,
    tunnelToken: "tunnel-secret",
    diskMode: "new",
  };
  await new Promise((resolve, reject) => {
    const child = execFile(
      "bash",
      ["-c", 'umask 077 && exec python3 "$0"', program],
      (error) => (error ? reject(error) : resolve()),
    );
    child.stdin.end(JSON.stringify(input));
  });
  const mode = async (path) => (await stat(join(root, path))).mode & 0o777;
  assert.equal(await mode("preview"), 0o755);
  assert.equal(await mode("preview/identity.json"), 0o644);
  assert.equal(await mode("codev/arm-runtime.json"), 0o600);
  assert.equal(await mode("codev/tunnel-token"), 0o600);
  assert.deepEqual(
    JSON.parse(await readFile(join(root, "preview/identity.json"), "utf8")),
    {
      workspaceId: input.workspaceId,
      generation: 3,
      verificationPublicKey: verificationKey,
    },
  );
});

test("the verified boot restarts the preview proxy only once its identity exists", () => {
  const script = read("./scripts/prepare-arm-workspace-disk.sh");
  const services = script.indexOf(
    "systemctl start codev-guestd codev-superset-host",
  );
  const preview = script.indexOf("systemctl start codev-arm-preview.socket");
  const gateway = script.indexOf("systemctl start codev-arm-gateway");
  assert.ok(services < preview && preview < gateway);
  assert.match(
    script,
    /-f \/etc\/systemd\/system\/codev-arm-preview\.socket &&\s+-f \/etc\/codev-preview\/identity\.json/,
  );
  assert.match(script, /systemctl try-restart codev-arm-preview\.service/);
});

test("a preview start failure stops only the preview, never the verified boot", async (t) => {
  const script = read("./scripts/prepare-arm-workspace-disk.sh");
  const block = script.match(
    /\nif \[\[ -f \/etc\/systemd\/system\/codev-arm-preview\.socket[\s\S]*?\nfi\n/,
  )?.[0];
  assert.ok(block, "the preview block must be one guarded if");
  const root = await mkdtemp(join(tmpdir(), "codev-preview-boot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "socket"), "");
  await writeFile(join(root, "identity"), "");
  const boot = async (failing) => {
    const program = [
      "set -euo pipefail",
      `systemctl() { echo "systemctl $*"; [[ "$*" != '${failing}' ]]; }`,
      block
        .replace(
          "/etc/systemd/system/codev-arm-preview.socket",
          join(root, "socket"),
        )
        .replace("/etc/codev-preview/identity.json", join(root, "identity")),
      "echo BOOT_CONTINUES",
    ].join("\n");
    const { stdout } = await promisify(execFile)("bash", ["-c", program]);
    return stdout.trim().split("\n");
  };
  assert.deepEqual(await boot("none"), [
    "systemctl start codev-arm-preview.socket",
    "systemctl try-restart codev-arm-preview.service",
    "BOOT_CONTINUES",
  ]);
  for (const failing of [
    "start codev-arm-preview.socket",
    "try-restart codev-arm-preview.service",
  ]) {
    const calls = await boot(failing);
    assert.equal(calls.at(-1), "BOOT_CONTINUES", failing);
    assert.equal(calls.at(-2), "systemctl stop codev-arm-preview.service");
  }
});

test("every module a guest entrypoint imports ships in the image and is validated", () => {
  const build = read("../azure/build-arm-workspace-image.sh");
  const provision = read("./scripts/provision-arm-workspace-image.sh");
  const validate = read("./scripts/validate-arm-workspace-image.sh");
  const listed = (text) =>
    text.match(/for script in ([^;]+); do/)?.[1].split(/\s+/) ?? [];
  const modules = (entry, seen = new Set()) => {
    seen.add(entry);
    for (const [, name] of read(`./scripts/${entry}`).matchAll(
      /from "\.\/([\w-]+\.mjs)"/g,
    ))
      if (!seen.has(name)) modules(name, seen);
    return seen;
  };
  for (const entry of [
    "start-arm-workspace-gateway.mjs",
    "start-arm-workspace-preview.mjs",
  ])
    for (const name of modules(entry)) {
      assert.ok(listed(build).includes(name), `${name} is uploaded`);
      assert.ok(listed(provision).includes(name), `${name} is installed`);
    }
  for (const name of modules("start-arm-workspace-preview.mjs"))
    assert.ok(validate.includes(name), `${name} is validated`);
  assert.match(
    provision,
    /^rm -f .*\/var\/tmp\/start-arm-workspace-preview\.mjs/m,
  );
  assert.match(
    validate,
    /systemd-analyze verify \/etc\/systemd\/system\/codev-arm-\{boot,gateway,tunnel,preview\}\.service \\\n\s+\/etc\/systemd\/system\/codev-arm-preview\.socket/,
  );
  assert.match(validate, /test ! -e \/etc\/codev-preview\/identity\.json/);
  assert.match(validate, /systemctl is-enabled codev-arm-preview\.socket/);
});
