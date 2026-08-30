# sharp-echonet

Read a Sharp humidifying air purifier over ECHONET Lite on the local network, and
decode the vendor-specific properties that carry most of what the machine knows.

Worked out on two **KI-UX75** units, firmware `SHARP_B02`.

## Why this exists

The standard part of ECHONET Lite gets you very little from this hardware. The
air cleaner class (`0x0135`) defines six class properties, and KI-UX75 implements
three of them: power, air flow rate, and a dirty-air flag. Temperature, humidity,
particle count, filter usage and the water tank all live in the vendor-specific
properties `0xF1` to `0xF3`, which are not documented anywhere.

The standard does define a water level for humidifiers, at EPC `0xC5` of the
humidifier class, with six steps. KI-UX75 never announces a humidifier object, so
that route is closed on this hardware even though the machine humidifies.

## Install

```
npm install sharp-echonet
```

Node 18 or newer. No runtime dependencies.

## Use

```ts
import { read } from "sharp-echonet";

const r = await read("192.168.1.20");

r.power;            // "on"
r.waterTankEmpty;   // false, or undefined when the byte could not be read
r.fields.roomTemperature.value;   // 28
r.fields.numberOfParticles.value; // 1101
```

Finding the units on the network:

```ts
import { EchonetClient } from "sharp-echonet";

const client = new EchonetClient();
const ips = await client.discover();
client.close();
```

Or from a shell:

```
npx sharp-echonet discover
npx sharp-echonet read 192.168.1.20
npx sharp-echonet table
```

`read` checks the product code (EPC `0x8C`) first and refuses hardware the table
does not cover. These offsets came from one model on one firmware, so applying
them elsewhere would produce numbers that look plausible and are wrong. Pass
`checkModel: false` if you are deliberately probing something else.

## What it reads

| Field | Property | Notes |
| --- | --- | --- |
| `roomTemperature` | `0xF1[3]` | degrees C |
| `roomHumidity` | `0xF1[4]` | per cent |
| `lightingLevel` | `0xF1[8]` | three steps, from the top four bits |
| `brightnessRaw` | `0xF1[2]` | 0 to 255, not lux, non-linear |
| `totalOperatingTime` | `0xF1[11:15]` | minutes |
| `cadrUsed` | `0xF1[21:25]` | cumulative volume of air cleaned |
| `dustFilterUsed` | `0xF1[29:31]` | compare against `dustFilterLimit` of 3000 |
| `smellFilterUsed` | `0xF1[31:33]` | |
| `humidFilterUsed` | `0xF1[35:37]` | |
| `totalHumidificationAmount` | `0xF1[38:40]` | |
| `numberOfParticles` | `0xF1[40:43]` | particles per litre |
| `waterPresent` | `0xF2[19]` | `0xff` while the tank has water |
| `lightSensorFlag` | `0xF2[20]` | `0xff` in a lit room |
| `humidificationEnabled` | `0xF3[15]` | the setting, not whether it is humidifying now |

The full table, including the fields that are still unresolved, ships as
[`data/ki-ux75.json`](data/ki-ux75.json) and is importable on its own:

```ts
import table from "sharp-echonet/table" with { type: "json" };
```

Porting the table to another language is a short job, which is the point of
keeping it as data rather than burying it in code.

## Confidence

Every field carries a confidence level, and `read` returns only `confirmed` ones
unless asked otherwise.

- `confirmed` means the field matched on two units at aligned timestamps, or
  moved when something was deliberately changed.
- `probable` means the position follows from the ordering of its neighbours and
  was never seen to move.
- `offset-confirmed` means the byte position is certain but the value is not
  trustworthy on this model.

That last case is real. The vendor's own app names `0xF1[27:29]` as a PM2.5
reading, and the bytes do move, but the device reports that it has no PM2.5
sensor. Publishing that as a measurement would be a fabricated number.

```ts
await read(ip, { minConfidence: "probable", includeUnusable: true });
```

## Traps

These cost time, so they ship in the table as explicit negative entries.

- `0xF3[5]` and `0xF2[39]` read `0x00` on one unit and `0x01` on the other, which
  makes them look like flags. They are constants that differ per unit. Neither
  moved when the tank was refilled or when humidification was switched on and
  off. Comparing two machines is not enough to call a byte a flag.
- `0xF1[42]` drifts constantly and never returns to where it was, so on its own
  it reads as noise. It is the low byte of the three-byte particle count at
  offset 40.
- `0xF1[14]` counts up once a minute, `0xF1[24]` roughly every 43 seconds.
- Writes to `0xA0` are answered with ESV `0x71` and then ignored. Instantaneous
  power does not change. Power is the only write that takes effect.
- `0xF4` was zero in every reading on both units.

## The tank

Nothing on the vendor side reports a refill. The app has no such wording, and the
field at `0xF2[19]` is the one slot in its group that the app never reads, though
the cloud sends it. The machine only lights an indicator on its own panel.

The value was pinned by switching humidification off while water remained, which
separates "has water" from "is humidifying". Those two states overlap completely
otherwise, since a dry machine cannot humidify.

Pulling the tank out does not change the byte. The sensor appears to watch the
tray rather than the tank, so routine cleaning will not raise a false refill.

Anything other than `0xff` is reported as empty. Only two values have ever been
observed, and treating an unrecognised third one as a full tank would fail
silently in the one direction that matters.

## Protocol notes

Two details cost real time to find:

- Replies arrive on port 3610, not on the port the request went out from. Waiting
  on an ephemeral port times out every time.
- Joining the multicast group is unnecessary. Discovery goes out as multicast and
  devices answer by unicast.

Since 3610 is shared, keep one `EchonetClient` for the life of the process and
let it demultiplex replies by transaction id.

## How the offsets were established

Values were read from the units over the local network and compared against what
the same machines reported through the manufacturer's own account view, at
matching timestamps, using the author's own login and the author's own hardware.
Field boundaries were confirmed on a second unit at a different time before being
recorded here.

This repository contains no credentials, and nothing here depends on the
manufacturer's cloud at runtime. The library speaks only to devices on the local
network.

## Scope

Reading. Power is the only write this hardware honours, and the library does not
wrap it. There is no daemon, no HTTP surface and no Home Assistant component
here, on purpose. What travels well is the table.

## Licence

MIT
