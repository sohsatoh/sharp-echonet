# sharp-echonet

Read a Sharp humidifying air purifier over ECHONET Lite on the local network, and
decode the vendor-specific properties that carry most of what the machine knows.

Worked out on two **KI-UX75** units, firmware `SHARP_B02`.

## Why this exists

The standard side of ECHONET Lite gives almost nothing on this hardware. The air
cleaner class (`0x0135`) defines six class properties and KI-UX75 implements
three: power, air flow rate, and a dirty-air flag. Temperature, humidity, particle
count, filter usage and the water tank all sit in the vendor properties `0xF1` to
`0xF3`, which are not documented anywhere.

The standard does define a six-step water level for humidifiers, at EPC `0xC5` of
the humidifier class. KI-UX75 never announces a humidifier object, so that route
is closed even though the machine humidifies.

## Install

```
npm install sharp-echonet
```

Node 18 or newer, no runtime dependencies.

## Use

```ts
import { read } from "sharp-echonet";

const r = await read("192.168.1.20");

r.power;                          // "on"
r.waterTankEmpty;                 // false, or undefined when the byte was unreadable
r.fields.roomTemperature.value;   // 28
r.fields.numberOfParticles.value; // 1101
```

```ts
import { EchonetClient } from "sharp-echonet";

const client = new EchonetClient();
const ips = await client.discover();
client.close();
```

```
npx sharp-echonet discover
npx sharp-echonet read 192.168.1.20
npx sharp-echonet table
```

`read` checks the product code (EPC `0x8C`) first and refuses hardware the table
does not cover, because offsets from one model would produce plausible-looking
wrong numbers on another. Pass `checkModel: false` to probe anyway.

## What it reads

| Field | Property | Notes |
| --- | --- | --- |
| `roomTemperature` | `0xF1[3]` | degrees C |
| `roomHumidity` | `0xF1[4]` | per cent |
| `brightnessRaw` | `0xF1[2]` | 0 to 255, not lux, non-linear |
| `lightingLevel` | `0xF1[8]` | three steps, from the top four bits |
| `totalOperatingTime` | `0xF1[11:15]` | minutes |
| `cadrUsed` | `0xF1[21:25]` | cumulative volume of air cleaned |
| `dustFilterUsed` | `0xF1[29:31]` | compare against `dustFilterLimit` of 3000 |
| `smellFilterUsed` | `0xF1[31:33]` | |
| `humidFilterUsed` | `0xF1[35:37]` | |
| `totalHumidificationAmount` | `0xF1[38:40]` | |
| `numberOfParticles` | `0xF1[40:43]` | particles per litre |
| `waterPresent` | `0xF2[19]` | `0xff` while the tank has water |
| `lightSensorFlag` | `0xF2[20]` | `0xff` in a lit room |
| `humidificationEnabled` | `0xF3[15]` | the setting, not whether it humidifies now |

The full table, unresolved fields included, ships as
[`data/ki-ux75.json`](data/ki-ux75.json) and is importable on its own:

```ts
import table from "sharp-echonet/table" with { type: "json" };
```

Porting it to another language is a short job, which is why it is data rather
than code.

Where there is no UDP, such as an edge runtime, fetch the bytes elsewhere and
unpack them through the decode-only entry point, which pulls in no node built-ins:

```ts
import { decodeAll, waterTankEmpty } from "sharp-echonet/decode";
```

## Confidence

Fields carry a confidence level, and `read` returns only `confirmed` ones unless
asked otherwise.

- `confirmed`: matched on two units at aligned timestamps, or moved when
  something was deliberately changed.
- `probable`: the position follows from its neighbours and was never seen to move.
- `offset-confirmed`: the byte position is certain, the value is not trustworthy
  on this model.

That last case is real. The vendor app names `0xF1[27:29]` as a PM2.5 reading and
the bytes do move, but the device reports no PM2.5 sensor, so publishing it as a
measurement would be inventing a number.

```ts
await read(ip, { minConfidence: "probable", includeUnusable: true });
```

## Traps

- `0xF3[5]` and `0xF2[39]` read `0x00` on one unit and `0x01` on the other, which
  makes them look like flags. They are per-unit constants, and neither moved when
  the tank was refilled or humidification was toggled. Comparing two machines is
  not enough to call a byte a flag.
- `0xF1[42]` drifts and never returns, so alone it reads as noise. It is the low
  byte of the three-byte particle count at offset 40.
- `0xF1[14]` counts up once a minute, `0xF1[24]` roughly every 43 seconds.
- Writes to `0xA0` are answered with ESV `0x71` and then ignored, and power draw
  does not change. Power is the only write this hardware honours.

## The tank

Nothing on the vendor side reports a refill: the machine keeps running, the app
has no such wording, and `0xF2[19]` is the one slot in its group the app never
reads. Only the panel indicator shows it.

The byte was pinned by switching humidification off while water remained, which
separates having water from humidifying. Those states overlap completely
otherwise, since a dry machine cannot humidify. Pulling the tank out does not
change it, so the sensor appears to watch the tray and routine cleaning will not
raise a false refill.

Anything other than `0xff` counts as empty. Only two values have ever been seen,
and treating an unknown third one as a full tank would fail silently in the one
direction that matters.

## Protocol notes

- Replies arrive on port 3610, not on the port the request went out from. Waiting
  on an ephemeral port times out every time.
- Joining the multicast group is unnecessary. Discovery goes out as multicast and
  devices answer by unicast.
- Since 3610 is shared, keep one `EchonetClient` per process and let it
  demultiplex replies by transaction id.

## Scope and disclaimer

This project has no connection with Sharp Corporation and is neither endorsed nor
supported by it. Product and company names belong to their owners.

The offsets were derived by observing the author's own devices on the author's own
network. They are not published by the manufacturer, they are not a specification,
and a firmware update can invalidate any of them. Treat the table as findings that
held on two units at a point in time. The product code check exists so that a
mismatch fails loudly instead of returning numbers from the wrong place.

The library reads. Power is the only write the hardware honours and it is not
wrapped here. No credentials are included and nothing depends on the
manufacturer's cloud at runtime.

Provided as is, without warranty of any kind, under the MIT licence. Anyone using
it does so at their own risk.
