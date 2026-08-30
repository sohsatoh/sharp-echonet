import { fieldsOf, hexEpc, table, type Confidence, type FieldSpec } from "./table.ts";

export interface DecodedField {
  name: string;
  value: number | boolean;
  unit?: string;
  confidence: Confidence;
  /** False when the field exists but this model cannot produce a meaningful value. */
  usable: boolean;
  vendorSlot?: string;
  note?: string;
}

export interface DecodeOptions {
  /**
   * Lowest confidence to return. Defaults to `confirmed`, so callers get only
   * fields that survived a second experiment unless they ask for more.
   */
  minConfidence?: Confidence;
  /** Include fields whose value this model cannot produce. Off by default. */
  includeUnusable?: boolean;
}

const RANK: Record<Confidence, number> = {
  confirmed: 3,
  "offset-confirmed": 2,
  probable: 1,
};

function readUint(edt: Uint8Array, offset: number, size: number): number {
  let n = 0;
  for (let i = 0; i < size; i++) n = n * 256 + edt[offset + i]!;
  return n;
}

function decodeField(edt: Uint8Array, f: FieldSpec): number | boolean | undefined {
  // A short response means a different firmware laid the property out
  // differently. Returning nothing beats returning a number from the wrong place.
  if (offsetOutOfRange(edt, f)) return undefined;
  switch (f.type) {
    case "flag":
      return edt[f.offset] === Number(f.trueValue ?? "0xff");
    case "bits":
      return edt[f.offset]! >> 4;
    default:
      return readUint(edt, f.offset, f.size);
  }
}

function offsetOutOfRange(edt: Uint8Array, f: FieldSpec): boolean {
  return f.offset + f.size > edt.length;
}

/** Decode one vendor property (0xF1, 0xF2, 0xF3) into named fields. */
export function decodeProperty(
  epc: number,
  edt: Uint8Array,
  options: DecodeOptions = {},
): DecodedField[] {
  const floor = RANK[options.minConfidence ?? "confirmed"];
  const out: DecodedField[] = [];
  for (const f of fieldsOf(epc)) {
    if (RANK[f.confidence] < floor) continue;
    const usable = f.usable !== false;
    if (!usable && !options.includeUnusable) continue;
    const value = decodeField(edt, f);
    if (value === undefined) continue;
    out.push({
      name: f.name,
      value,
      ...(f.unit ? { unit: f.unit } : {}),
      confidence: f.confidence,
      usable,
      ...(f.vendorSlot ? { vendorSlot: f.vendorSlot } : {}),
      ...(f.note ? { note: f.note } : {}),
    });
  }
  return out;
}

/**
 * Decode a whole read into one flat object keyed by field name.
 *
 * Properties the table does not describe are skipped rather than guessed at.
 */
export function decodeAll(
  props: Map<number, Uint8Array>,
  options: DecodeOptions = {},
): Record<string, DecodedField> {
  const out: Record<string, DecodedField> = {};
  for (const [epc, edt] of props) {
    if (!table.properties[hexEpc(epc)]) continue;
    for (const field of decodeProperty(epc, edt, options)) out[field.name] = field;
  }
  return out;
}

/**
 * Whether the tank needs a refill.
 *
 * Returns undefined when the byte is missing, never false. "I could not read it"
 * and "there is water" are different answers, and collapsing them means a dry
 * machine reports as full.
 *
 * Anything other than the water-present value counts as empty. Only two values
 * have ever been observed, so an unrecognised third one is more safely treated
 * as a refill than as a full tank.
 */
export function waterTankEmpty(props: Map<number, Uint8Array>): boolean | undefined {
  const edt = props.get(0xf2);
  const field = fieldsOf(0xf2).find((f) => f.name === "waterPresent");
  if (!edt || !field || edt.length <= field.offset) return undefined;
  return edt[field.offset] !== Number(field.trueValue ?? "0xff");
}
