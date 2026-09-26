# Development helpers

## An adapter without hardware

```bash
npx dev-server setup     # once - the profile lives in .dev-server/, which is gitignored
npx dev-server watch     # js-controller, the admin UI and the adapter, restarted on every change
```

`dev-server run` starts everything **except** the adapter, which is what you want for admin UI
work; `watch` is what you want here. The admin URL is printed on start (http://localhost:8081).

## A profile with devices

A fresh profile has no devices. With `dev-server watch` running, this fills it:

```bash
node tools/seed-dev-server.js
```

It points the instance at the TCP receiver below (port 5100), adds the AES key the `encrypted` sample
needs, restarts the adapter if that changed anything, and sends the samples: the Sensus meter
`LSE-58511882` in three layouts, the volume, the encrypted meter, the Itron smoke detector and the one
with an unknown key. It can run any number of times - what is configured stays as it is, and the
telegrams arrive again. `--profile` picks another dev-server profile, `--port` another port.

The devices are created by the adapter as it is checked out, which is the point: a backup of a
populated profile (`dev-server backup`, `dev-server setup --backupFile`) would bring back objects as an
older version created them.

## Feeding telegrams over TCP

The package contains a receiver that the admin UI does not offer: it takes telegrams as JSON on a
local TCP port. Point the instance at it:

```bash
cd .dev-server/default
./iob object extend system.adapter.wireless-mbus.0 '{"native":{"deviceType":"tcp","serialPort":"5100"}}'
./iob object get system.adapter.wireless-mbus.0 | grep -E '"(deviceType|serialPort)"'
```

The change can reach the objects database noticeably later than the command returns, so restart
the adapter only once the second command shows the new values. Under `dev-server watch` the dev
server runs the adapter itself, and it restarts it when a file under `build/` changes:

```bash
touch build/main.js    # from the adapter directory
```

The dev server is also meant to restart the adapter when the instance configuration changes, but
that does not always happen - after a save in the admin UI as well. If the log shows no new start of
the adapter, touch the file.

Do not use `./iob restart wireless-mbus.0` under `dev-server watch`. The dev server keeps the instance
disabled, so that js-controller leaves the adapter to it; `iob restart` enables it, and js-controller
starts a second copy, which ends with `ADAPTER_ALREADY_RUNNING` and is started again every 30
seconds. If that has happened, disable the instance again:

```bash
./iob object extend system.adapter.wireless-mbus.0 '{"common":{"enabled":false}}'
```

Then, from the adapter directory:

```bash
node tools/send-telegram.js plain
node tools/send-telegram.js volume
node tools/send-telegram.js 2C446532821851582C067AE1000000046D19 --frame-type B --crc
```

Careful: saving the instance configuration in the admin UI overwrites `deviceType`, because `tcp`
is not in the list of receivers it offers. Set it again with the command above.

Port 5100 rather than 5000 on purpose: the integration test uses 5000, and a dev-server sitting on
it makes `npm run test:integration` fail with `EADDRINUSE`.

## Feeding telegrams through a serial port

The "Simple Hexstring" receiver reads one telegram per line from a serial port, and `socat` can
make a pair of them. A line may start with a `Z` to say that the telegram carries its block CRCs;
without it the parser looks for them itself, and a line that is no hex string at all is dropped:

```bash
socat -d -d pty,raw,echo=0,link=/tmp/wmbus-port pty,raw,echo=0,link=/tmp/wmbus-feed &
```

Configure the instance for "Simple Hexstring" with `/tmp/wmbus-port` as its serial port - that
receiver *is* in the UI, so the setting survives saving the configuration - and feed it:

```bash
node tools/send-telegram.js plain --to /tmp/wmbus-feed
```

This is the way that also exercises the line extraction of a receiver. The TCP receiver skips all
of that and hands the telegram straight to the parser.

## The samples

| name | what it is |
| --- | --- |
| `plain` | LSE-58511882, six data records, decodes without a key |
| `plain-maximum` | LSE-58511882 again, with a maximum volume where `plain` has the current one: another record under the same state id |
| `plain-other` | LSE-58511882 again, with a fabrication number, a flow and a return temperature in place of three records of `plain` |
| `volume` | CEN-12345678, a volume in m³, frame type B with CRCs |
| `encrypted` | ELS-12345678, needs the key `000102030405060708090A0B0C0D0E0F` in the AES key list |
| `itron` | ITW-12345678, an Itron smoke detector - the 26 values its manufacturer specific record holds |
| `unknown-key` | KAM-63452869, encrypted with a key nobody has - the "Check for new devices that need a key" button offers it afterwards |

`node tools/send-telegram.js --list` prints them, `--help` the options. Anything that is not a
sample name is taken as a telegram in hex, and `--frame-type` and `--crc` then say how to read it.

## Gotchas

dev-server disables the instance in js-controller and runs the adapter itself. Whatever enables it
again - the instance list in the admin UI, for instance - gets you two processes for one instance:
the second one cannot bind the port of the TCP receiver, so it dies and js-controller restarts it
for as long as you let it. `pgrep -af io.wireless-mbus` says how many are running, and
`./iob object set system.adapter.wireless-mbus.0 common.enabled=false` ends the race.

The adapter is **not** restarted when the instance configuration is saved while dev-server runs
it, so `this.config` stays at what it was when the adapter started. Anything that answers from the
saved configuration then answers with yesterday's news - restart it after a change, by touching a
source file in watch mode or with `./iob restart wireless-mbus.0`.

## A busy installation

Issue #308 is about what happens when many meters transmit at the same time:

```bash
node tools/send-telegram.js plain --repeat 25 --interval 0
```

For the framing of a particular receiver, the tests are the better tool: `npm run test:unit`
covers all of them with device mocks, and `WMBUS_TEST_RECEIVER=Cul npm run test:integration`
runs one of them against a real js-controller.
