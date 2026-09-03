# Development helpers

## An adapter without hardware

```bash
npx dev-server setup     # once - the profile lives in .dev-server/, which is gitignored
npx dev-server watch     # js-controller, the admin UI and the adapter, restarted on every change
```

`dev-server run` starts everything **except** the adapter, which is what you want for admin UI
work; `watch` is what you want here. The admin URL is printed on start (http://localhost:8081).

## Feeding telegrams over TCP

The package contains a receiver that the admin UI does not offer: it takes telegrams as JSON on a
local TCP port. Point the instance at it:

```bash
cd .dev-server/default
./iob object extend system.adapter.wireless-mbus.0 '{"native":{"deviceType":"tcp","serialPort":"5000"}}'
./iob restart wireless-mbus.0
```

Then, from the adapter directory:

```bash
node dev/send-telegram.js plain
node dev/send-telegram.js volume
node dev/send-telegram.js 2C446532821851582C067AE1000000046D19 --frame-type B --crc
```

Careful: saving the instance configuration in the admin UI overwrites `deviceType`, because `tcp`
is not in the list of receivers it offers. Set it again with the command above.

## Feeding telegrams through a serial port

The "Simple Hexstring" receiver reads one telegram per line from a serial port, and `socat` can
make a pair of them:

```bash
socat -d -d pty,raw,echo=0,link=/tmp/wmbus-port pty,raw,echo=0,link=/tmp/wmbus-feed &
```

Configure the instance for "Simple Hexstring" with `/tmp/wmbus-port` as its serial port - that
receiver *is* in the UI, so the setting survives saving the configuration - and feed it:

```bash
node dev/send-telegram.js plain --to /tmp/wmbus-feed
```

This is the way that also exercises the line extraction of a receiver. The TCP receiver skips all
of that and hands the telegram straight to the parser.

## The samples

| name | what it is |
| --- | --- |
| `plain` | LSE-58511882, six data records, decodes without a key |
| `volume` | CEN-12345678, a volume in m³, frame type B with CRCs |
| `encrypted` | ELS-12345678, needs the key `000102030405060708090A0B0C0D0E0F` in the AES key list |
| `unknown-key` | KAM-63452869, encrypted with a key nobody has - ends up in the "needs key" list |

`node dev/send-telegram.js --list` prints them, `--help` the options. Anything that is not a
sample name is taken as a telegram in hex, and `--frame-type` and `--crc` then say how to read it.

## A busy installation

Issue #308 is about what happens when many meters transmit at the same time:

```bash
node dev/send-telegram.js plain --repeat 25 --interval 0
```

For the framing of a particular receiver, the tests are the better tool: `npm run test:unit`
covers all of them with device mocks, and `WMBUS_TEST_RECEIVER=Cul npm run test:integration`
runs one of them against a real js-controller.
