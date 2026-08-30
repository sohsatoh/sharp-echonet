// data/ki-ux75.json is the source of truth. Generate TypeScript from it so that
// nothing has to be read from disk at runtime, which keeps decoding usable where
// there is no filesystem.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const json = readFileSync(fileURLToPath(new URL("data/ki-ux75.json", root)), "utf8");
const out = `// Generated. Do not edit. Change data/ki-ux75.json and run npm run gen.
import type { Table } from "./table.ts";

export const tableData = ${json.trim()} as unknown as Table;
`;
writeFileSync(fileURLToPath(new URL("src/table.data.ts", root)), out);
console.log("src/table.data.ts written");
