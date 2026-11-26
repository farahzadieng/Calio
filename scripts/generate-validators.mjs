import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone/index.js";
import { build } from "esbuild";
import { compile } from "json-schema-to-typescript";

const names = ["extract", "portion", "research", "weekly"];
const ajv = new Ajv2020({
  code: { source: true, esm: true, lines: true },
  strictNumbers: true,
});
addFormats(ajv);
const out = new URL("../src/generated/", import.meta.url);
await mkdir(out, { recursive: true });
const exports = {};

for (const operation of names) {
  const schema = JSON.parse(
    await readFile(
      new URL(`../schemas/${operation}.schema.json`, import.meta.url),
      "utf8",
    ),
  );
  const typeName = `${operation[0].toUpperCase()}${operation.slice(1)}Output`;
  schema.title = typeName;
  schema.$id = `urn:calio:${operation}:1`;
  ajv.addSchema(schema);
  exports[operation] = schema.$id;
  const declarations = await compile(schema, typeName, {
    additionalProperties: false,
  });
  await writeFile(new URL(`${operation}.d.ts`, out), declarations);
}

const bundle = await build({
  stdin: {
    contents: standaloneCode(ajv, exports),
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  format: "esm",
  write: false,
  platform: "browser",
  minify: true,
  legalComments: "inline",
});
await writeFile(new URL("validate.mjs", out), bundle.outputFiles[0].text);
await writeFile(
  new URL("validate.d.mts", out),
  names
    .map(
      (name) =>
        `export function ${name}(value: unknown): value is import('./${name}').${name[0].toUpperCase()}${name.slice(1)}Output;\n`,
    )
    .join(""),
);
