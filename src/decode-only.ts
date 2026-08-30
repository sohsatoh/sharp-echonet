/**
 * Decoding on its own, pulling in no node built-ins.
 *
 * The root entry point carries the UDP client and therefore `node:dgram`. Where
 * there is no UDP, such as an edge runtime, the bytes have to be fetched
 * elsewhere and unpacked here, so that path is kept separate.
 */
export { table, fieldsOf, matchesProductCode, hexEpc } from "./table.ts";
export type { Table, FieldSpec, PropertySpec, Confidence } from "./table.ts";
export { decodeProperty, decodeAll, waterTankEmpty } from "./decode.ts";
export type { DecodedField, DecodeOptions } from "./decode.ts";
