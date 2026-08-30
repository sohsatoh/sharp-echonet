#!/usr/bin/env node
import { EchonetClient } from "./echonet.ts";
import { read } from "./read.ts";
import { table } from "./table.ts";

function usage(): never {
  console.error(`sharp-echonet <command>

  discover              find air purifiers on the local network
  read <ip> [--all]     read one purifier; --all includes unconfirmed fields
  table                 print what this build knows about ${table.model}
`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);

if (command === "discover") {
  const client = new EchonetClient();
  const found = await client.discover();
  client.close();
  if (found.length === 0) {
    console.error("nothing answered. Some networks block multicast between clients.");
    process.exit(1);
  }
  for (const ip of found) console.log(ip);
} else if (command === "read") {
  const ip = rest[0];
  if (!ip) usage();
  const all = rest.includes("--all");
  const reading = await read(ip, {
    ...(all ? { minConfidence: "probable" as const, includeUnusable: true } : {}),
  });
  const { raw, ...rest2 } = reading;
  console.log(
    JSON.stringify(
      { ...rest2, fields: Object.fromEntries(Object.entries(reading.fields)) },
      null,
      2,
    ),
  );
} else if (command === "table") {
  console.log(JSON.stringify(table, null, 2));
} else {
  usage();
}
