import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decodeAll, decodeProperty, waterTankEmpty } from "../src/decode.ts";
import { matchesProductCode, table } from "../src/table.ts";
import { buildFrame, parseFrame, parseInstanceList } from "../src/echonet.ts";

interface Sample {
  note: string;
  props: Record<string, string>;
  expect?: Record<string, number>;
}

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/reads.json", import.meta.url)), "utf8"),
) as { samples: Record<string, Sample> };

function propsOf(name: string): Map<number, Uint8Array> {
  const sample = fixtures.samples[name];
  assert.ok(sample, `missing fixture ${name}`);
  return new Map(
    Object.entries(sample.props).map(([epc, hex]) => [
      Number.parseInt(epc.replace(/^0x/i, ""), 16),
      Uint8Array.from(Buffer.from(hex, "hex")),
    ]),
  );
}

for (const name of ["unitA", "unitB"]) {
  test(`decodes the values the vendor reported for ${name}`, () => {
    const expected = fixtures.samples[name]?.expect ?? {};
    const fields = decodeAll(propsOf(name));
    for (const [key, want] of Object.entries(expected)) {
      assert.equal(fields[key]?.value, want, key);
    }
  });
}

// The point of the whole exercise. An empty tank is the state nobody can see
// from the outside, so getting this backwards is the expensive failure.
test("reads the tank state on both sides of a refill", () => {
  assert.equal(waterTankEmpty(propsOf("tankEmpty")), true);
  assert.equal(waterTankEmpty(propsOf("tankFilled")), false);
});

test("reports an unreadable tank byte as unknown rather than full", () => {
  assert.equal(waterTankEmpty(new Map()), undefined);
  assert.equal(waterTankEmpty(new Map([[0xf2, Uint8Array.from([0, 1, 2])]])), undefined);
});

// Two byte positions in this table were nearly published as flags before a
// second experiment showed they were constants that differ per unit. Callers who
// have not opted in should never see that class of field.
test("keeps unconfirmed fields out of the default result", () => {
  const relaxed = decodeProperty(0xf2, propsOf("unitA").get(0xf2)!, { minConfidence: "probable" });
  const strict = decodeProperty(0xf2, propsOf("unitA").get(0xf2)!);
  assert.ok(relaxed.length > strict.length);
  assert.ok(strict.every((f) => f.confidence === "confirmed"));
  assert.ok(relaxed.some((f) => f.confidence === "probable"));
});

// This model has no PM2.5 sensor. The bytes move, so a caller that trusted them
// would publish a number that means nothing.
test("hides fields this model cannot actually measure", () => {
  const shown = decodeProperty(0xf1, propsOf("unitA").get(0xf1)!);
  assert.equal(
    shown.find((f) => f.name === "pm25Value"),
    undefined,
  );
  const asked = decodeProperty(0xf1, propsOf("unitA").get(0xf1)!, {
    minConfidence: "offset-confirmed",
    includeUnusable: true,
  });
  assert.equal(asked.find((f) => f.name === "pm25Value")?.usable, false);
});

// A shorter payload means different firmware laid the property out differently.
test("drops fields that run past the end of a short payload", () => {
  const short = Uint8Array.from(Buffer.from(fixtures.samples.unitA!.props.F1!, "hex").subarray(0, 10));
  const fields = decodeProperty(0xf1, short);
  assert.ok(fields.some((f) => f.name === "roomTemperature"));
  assert.equal(
    fields.find((f) => f.name === "numberOfParticles"),
    undefined,
  );
});

test("matches the product code with its zero padding", () => {
  assert.equal(matchesProductCode("4b4955583735000000000000"), true);
  assert.equal(matchesProductCode(Buffer.from("KIUX75\0\0\0\0\0\0", "binary")), true);
  assert.equal(matchesProductCode("4b4954583735000000000000"), false);
});

test("frames round trip", () => {
  const frame = parseFrame(buildFrame(0x1234, Uint8Array.from([1, 0x35, 1]), 0x62, [0x80, 0xf1]));
  assert.equal(frame?.tid, 0x1234);
  assert.equal(frame?.esv, 0x62);
  assert.deepEqual([...(frame?.props.keys() ?? [])], [0x80, 0xf1]);
});

test("reads an instance list and survives a truncated one", () => {
  assert.equal(parseInstanceList(Uint8Array.from([1, 0x01, 0x35, 0x01])).length, 1);
  assert.equal(parseInstanceList(Uint8Array.from([2, 0x01, 0x35, 0x01, 0x01])).length, 1);
  assert.equal(parseInstanceList(Uint8Array.from([])).length, 0);
});

test("every trap in the table names what it actually is", () => {
  assert.ok(table.traps.length >= 5);
  for (const trap of table.traps) assert.ok(trap.where && trap.reality);
});

// data/ki-ux75.json is the source of truth and src/table.data.ts is generated
// from it. A stale copy would ship offsets nobody reviewed.
test("the generated table matches the json it comes from", () => {
  const json = JSON.parse(
    readFileSync(fileURLToPath(new URL("../data/ki-ux75.json", import.meta.url)), "utf8"),
  );
  assert.deepEqual(table, json);
});
