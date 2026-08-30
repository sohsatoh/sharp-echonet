import { tableData } from "./table.data.ts";

/**
 * How much weight a field carries.
 *
 * The distinction matters more than it looks. Two of the byte positions in this
 * table were nearly published as flags before a second experiment showed they
 * were constants that differ per unit. Anything short of `confirmed` should be
 * treated as a lead, not a reading.
 */
export type Confidence =
  /** Matched on two units at aligned timestamps, or moved with a deliberate change. */
  | "confirmed"
  /** The byte position is certain, but the value is not trustworthy on this model. */
  | "offset-confirmed"
  /** Placed by the ordering of neighbouring fields, never seen to move. */
  | "probable";

export interface FieldSpec {
  offset: number;
  size: number;
  name: string;
  type: "uint" | "flag" | "bits";
  unit?: string;
  /** Value that makes a `flag` field true, as a hex string such as `0xff`. */
  trueValue?: string;
  bits?: string;
  vendorSlot?: string;
  confidence: Confidence;
  /** False when the field exists but this model cannot produce a meaningful value. */
  usable?: boolean;
  note?: string;
}

export interface PropertySpec {
  length?: number;
  fields?: FieldSpec[];
  unresolved?: { vendorSlot?: string; name?: string; note: string }[];
  note?: string;
}

export interface Table {
  model: string;
  /** EPC 0x8C (product code) as lowercase hex, used to refuse unknown hardware. */
  productCode: string;
  firmware: string[];
  eoj: string;
  standardVersion: string;
  note: string;
  spec: Record<string, boolean | number>;
  standardProperties: Record<string, { name: string; unit?: string; size?: number; note?: string }>;
  properties: Record<string, PropertySpec>;
  traps: { where: string; claim?: string; reality: string }[];
}

/**
 * data/ki-ux75.json is the source of truth. This reads the TypeScript generated
 * from it rather than the file itself, so that decoding works where there is no
 * filesystem.
 */
export const table: Table = tableData;

/** Every field of one property, in byte order. */
export function fieldsOf(epc: number): FieldSpec[] {
  const spec = table.properties[hexEpc(epc)];
  return [...(spec?.fields ?? [])].sort((a, b) => a.offset - b.offset);
}

export function hexEpc(epc: number): string {
  return `0x${epc.toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * Whether a product code belongs to the hardware this table describes.
 *
 * EPC 0x8C carries the product code as ASCII padded with zero bytes, so
 * `KIUX75` arrives as `4b4955583735000000000000`. Compare only the prefix.
 */
export function matchesProductCode(productCode: Uint8Array | string): boolean {
  const hex =
    typeof productCode === "string"
      ? productCode.toLowerCase()
      : [...productCode].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.startsWith(table.productCode);
}
