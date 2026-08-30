import { createSocket, type Socket } from "node:dgram";

export const EL_PORT = 3610;
export const EL_MULTICAST = "224.0.23.0";

const EHD1 = 0x10;
const EHD2 = 0x81;
const ESV_GET = 0x62;
const ESV_GET_RES = 0x72;
const ESV_GET_SNA = 0x52;

/** Air cleaner, class group 0x01, class 0x35, instance 1. */
export const EOJ_AIR_CLEANER = Uint8Array.from([0x01, 0x35, 0x01]);
/** Node profile. The target for discovery. */
export const EOJ_NODE_PROFILE = Uint8Array.from([0x0e, 0xf0, 0x01]);
/** Controller. What this library calls itself. */
const EOJ_CONTROLLER = Uint8Array.from([0x05, 0xff, 0x01]);

const EPC_INSTANCE_LIST = 0xd6;

export interface Frame {
  tid: number;
  seoj: Uint8Array;
  deoj: Uint8Array;
  esv: number;
  props: Map<number, Uint8Array>;
}

export function buildFrame(tid: number, deoj: Uint8Array, esv: number, epcs: number[]): Buffer {
  const head = [EHD1, EHD2, tid >> 8, tid & 0xff, ...EOJ_CONTROLLER, ...deoj, esv, epcs.length];
  const body: number[] = [];
  for (const epc of epcs) body.push(epc, 0);
  return Buffer.from([...head, ...body]);
}

export function parseFrame(b: Uint8Array): Frame | null {
  if (b.length < 12 || b[0] !== EHD1 || b[1] !== EHD2) return null;
  const props = new Map<number, Uint8Array>();
  const opc = b[11]!;
  let i = 12;
  for (let n = 0; n < opc; n++) {
    if (i + 2 > b.length) return null;
    const epc = b[i]!;
    const pdc = b[i + 1]!;
    i += 2;
    if (i + pdc > b.length) return null;
    props.set(epc, b.slice(i, i + pdc));
    i += pdc;
  }
  return {
    tid: (b[2]! << 8) | b[3]!,
    seoj: b.slice(4, 7),
    deoj: b.slice(7, 10),
    esv: b[10]!,
    props,
  };
}

/** Instance list from EPC 0xD6: one count byte, then three bytes per object. */
export function parseInstanceList(edt: Uint8Array): Uint8Array[] {
  if (edt.length < 1) return [];
  const out: Uint8Array[] = [];
  for (let i = 0; i < edt[0]!; i++) {
    const off = 1 + i * 3;
    if (off + 3 > edt.length) break;
    out.push(edt.slice(off, off + 3));
  }
  return out;
}

export interface ClientOptions {
  /** Milliseconds to wait for one reply. */
  timeoutMs?: number;
}

/**
 * A minimal ECHONET Lite client.
 *
 * Two things about this protocol cost real time to discover, so they are worth
 * stating plainly:
 *
 * - Replies come back to port 3610, not to the port the request went out from.
 *   Waiting on an ephemeral port times out every time.
 * - Joining the multicast group is unnecessary. Discovery goes out as multicast
 *   and devices answer by unicast.
 *
 * Because 3610 is a shared port, hold one client for the life of the process and
 * demultiplex replies by transaction id rather than opening a socket per request.
 */
export class EchonetClient {
  private socket: Socket;
  private tid = 0;
  private pending = new Map<number, (f: { from: string; frame: Frame }) => void>();
  private timeoutMs: number;
  private ready: Promise<void>;

  constructor(options: ClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.socket = createSocket({ type: "udp4", reuseAddr: true });
    this.socket.on("message", (msg, rinfo) => {
      const frame = parseFrame(msg);
      if (!frame) return;
      this.pending.get(frame.tid)?.({ from: rinfo.address, frame });
    });
    this.ready = new Promise((resolve, reject) => {
      this.socket.once("error", reject);
      this.socket.bind(EL_PORT, () => resolve());
    });
  }

  private nextTid(): number {
    this.tid = (this.tid + 1) & 0xffff || 1;
    return this.tid;
  }

  /** Read properties from one device. Unreadable EPCs come back with empty data. */
  async get(
    ip: string,
    epcs: number[],
    deoj: Uint8Array = EOJ_AIR_CLEANER,
  ): Promise<Map<number, Uint8Array>> {
    await this.ready;
    const tid = this.nextTid();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tid);
        reject(new Error(`${ip} did not answer`));
      }, this.timeoutMs);
      this.pending.set(tid, ({ from, frame }) => {
        if (from !== ip) return;
        clearTimeout(timer);
        this.pending.delete(tid);
        if (frame.esv !== ESV_GET_RES && frame.esv !== ESV_GET_SNA) {
          reject(new Error(`unexpected ESV 0x${frame.esv.toString(16)}`));
          return;
        }
        resolve(frame.props);
      });
      this.socket.send(buildFrame(tid, deoj, ESV_GET, epcs), EL_PORT, ip);
    });
  }

  /** Ask a node which objects it hosts. */
  async instances(ip: string): Promise<Uint8Array[]> {
    const props = await this.get(ip, [EPC_INSTANCE_LIST], EOJ_NODE_PROFILE);
    const edt = props.get(EPC_INSTANCE_LIST);
    return edt ? parseInstanceList(edt) : [];
  }

  /** Multicast for air cleaners and collect the addresses that answer. */
  async discover(windowMs = 2000): Promise<string[]> {
    await this.ready;
    const tid = this.nextTid();
    const found = new Set<string>();
    this.pending.set(tid, ({ from, frame }) => {
      const edt = frame.props.get(EPC_INSTANCE_LIST);
      if (!edt) return;
      const hit = parseInstanceList(edt).some((eoj) => eoj[0] === 0x01 && eoj[1] === 0x35);
      if (hit) found.add(from);
    });
    const pkt = buildFrame(tid, EOJ_NODE_PROFILE, ESV_GET, [EPC_INSTANCE_LIST]);
    // UDP drops happen, so ask more than once.
    for (let i = 0; i < 3; i++) {
      this.socket.send(pkt, EL_PORT, EL_MULTICAST);
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, windowMs));
    this.pending.delete(tid);
    return [...found];
  }

  close(): void {
    this.socket.close();
  }
}
