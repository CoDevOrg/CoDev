import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const outputDirectory = resolve(process.argv[2] ?? "");
if (basename(outputDirectory) !== "web") {
  throw new Error("Expected the generated Orca output directory named web.");
}

const indexPath = join(outputDirectory, "web-index.html");
let index = await readFile(indexPath, "utf8");
if (!index.includes("<title>Orca Web</title>")) {
  throw new Error(
    "Unexpected Orca web title; refusing an unsafe branding rewrite.",
  );
}
index = index
  .replace("<title>Orca Web</title>", "<title>CoDev Workspace</title>")
  .replace(
    /(<script type="module"[^>]*><\/script>)/,
    '<script src="./codev-preload.js"></script>\n    $1',
  );
await writeFile(indexPath, index);

const assetsDirectory = join(outputDirectory, "assets");
const assetNames = await readdir(assetsDirectory);
const logoAssets = assetNames.filter((name) => /^logo-[\w-]+\.js$/.test(name));
if (logoAssets.length !== 1) {
  throw new Error(`Expected one Orca logo module, found ${logoAssets.length}.`);
}
await writeFile(
  join(assetsDirectory, logoAssets[0]),
  "var e=`data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3e%3cpath%20d='M%2067%2033%20A%2024%2024%200%201%200%2067%2067'%20fill='none'%20stroke='%23ffffff'%20stroke-width='13'%20stroke-linecap='round'/%3e%3ccircle%20cx='74'%20cy='50'%20r='6.5'%20fill='%23d9652d'/%3e%3c/svg%3e`;export{e as t};",
);

const localeAsset = /^(?:es|ja|ko|zh)-/;
await Promise.all(
  assetNames
    .filter((name) => name.endsWith(".js") && !localeAsset.test(name))
    .map(async (name) => {
      const path = join(assetsDirectory, name);
      const source = await readFile(path, "utf8");
      const branded = source
        .replace(/\bORCA\b/g, "CODEV")
        .replace(/\bOrca\b/g, "CoDev")
        .replace(/\ban CoDev\b/g, "a CoDev");
      if (branded !== source) {
        await writeFile(path, branded);
      }
    }),
);
