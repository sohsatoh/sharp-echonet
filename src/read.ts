import { decodeAll, waterTankEmpty, type DecodedField, type DecodeOptions } from "./decode.ts";
import { EchonetClient } from "./echonet.ts";
import { matchesProductCode } from "./table.ts";

const EPC_OPERATION_STATUS = 0x80;
const EPC_INSTANT_POWER = 0x84;
const EPC_FAULT = 0x88;
const EPC_PRODUCT_CODE = 0x8c;
const EPC_AIR_POLLUTION = 0xc0;
const VENDOR_EPCS = [0xf1, 0xf2, 0xf3];

export interface Reading {
  power: "on" | "off" | undefined;
  watts: number | undefined;
  fault: boolean | undefined;
  airPollutionDetected: boolean | undefined;
  /** Undefined when the byte could not be read, which is not the same as full. */
  waterTankEmpty: boolean | undefined;
  fields: Record<string, DecodedField>;
  raw: Map<number, Uint8Array>;
}

export interface ReadOptions extends DecodeOptions {
  client?: EchonetClient;
  /**
   * Read EPC 0x8C first and refuse to decode hardware the table does not cover.
   * Leave this on unless you are deliberately probing another model.
   */
  checkModel?: boolean;
}

/**
 * Read one air purifier and decode what the table knows.
 *
 * The model check is on by default because these offsets were established on one
 * model and one firmware. Applying them to different hardware would produce
 * numbers that look plausible and are wrong, which is worse than no reading.
 */
export async function read(ip: string, options: ReadOptions = {}): Promise<Reading> {
  const client = options.client ?? new EchonetClient();
  const owned = !options.client;
  try {
    const epcs = [
      EPC_OPERATION_STATUS,
      EPC_INSTANT_POWER,
      EPC_FAULT,
      EPC_AIR_POLLUTION,
      ...VENDOR_EPCS,
    ];
    if (options.checkModel !== false) epcs.push(EPC_PRODUCT_CODE);
    const props = await client.get(ip, epcs);

    if (options.checkModel !== false) {
      const code = props.get(EPC_PRODUCT_CODE);
      if (!code || !matchesProductCode(code)) {
        throw new Error(
          `${ip} reports a product code this table does not cover. Pass checkModel: false to decode anyway.`,
        );
      }
    }

    const status = props.get(EPC_OPERATION_STATUS);
    const power = status?.length === 1 ? (status[0] === 0x30 ? "on" : "off") : undefined;
    const watts = byteLen(props.get(EPC_INSTANT_POWER), 2)
      ? (props.get(EPC_INSTANT_POWER)![0]! << 8) | props.get(EPC_INSTANT_POWER)![1]!
      : undefined;

    return {
      power,
      watts,
      fault: flag(props.get(EPC_FAULT)),
      airPollutionDetected: flag(props.get(EPC_AIR_POLLUTION)),
      waterTankEmpty: waterTankEmpty(props),
      fields: decodeAll(props, options),
      raw: props,
    };
  } finally {
    if (owned) client.close();
  }
}

function byteLen(v: Uint8Array | undefined, n: number): boolean {
  return v?.length === n;
}

/** ECHONET spells these as 0x41 for yes and 0x42 for no. */
function flag(v: Uint8Array | undefined): boolean | undefined {
  return v?.length === 1 ? v[0] === 0x41 : undefined;
}
