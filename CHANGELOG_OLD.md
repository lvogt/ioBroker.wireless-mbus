# Older changes
## 0.12.0 (2026-09-03)
* (ChL) Replace the built-in telegram parser with the wireless-mbus-parser library
* (ChL) New admin configuration UI (JSON config); a serial port can now simply be typed in, the separate "custom port" field is gone
* (ChL) Fix shutdown of the adapter: a serial connection over TCP was not closed properly and could reconnect itself while the adapter was stopping
* (ChL) Measured values are now stored as numbers instead of preformatted strings - a history adapter that stored them as text starts a new series
* (ChL) Fix decoding of the tariff and device unit of a data record
* (ChL) Compact telegrams are now supported without a separate option; the option "Cache for compact frames support" was removed
* (ChL) Follow further ioBroker repository recommendations: move the test code below `test/`, use the short `admin/i18n/<lang>.json` layout and clean up the keywords
* (ChL) Run the adapter tests only after linting and type checking succeeded
* (ChL) Use the adapter's own timer functions, so pending timers are cleared when the adapter is unloaded
* (ChL) Fix receivers getting stuck after disturbed reception: a damaged telegram no longer takes the following ones with it, and no longer leaves the adapter yellow until it is restarted by hand (#308, #309)
* (ChL) The adapter reconnects to the receiver instead of staying idle or stopping when the connection fails
* (ChL) Fix telegrams getting lost when several meters transmit at once, and damaged data being reported as readings of devices that do not exist
* (ChL) Declare the state that holds the raw data of an unreadable telegram as text rather than as a numeric value

## 0.11.0 (2026-08-29)
* (ChL) Require node.js 22 or newer, js-controller >=6.0.11 and admin >=7.6.20
* (ChL) Switch to @iobroker/eslint-config (ESLint 9 + Prettier)
* (ChL) Add release-script based release management
* (ChL) Include the admin translations in the published package

## 0.10.2
* (ChL) Improve robustness of IMST iU891A-XL communication

## 0.10.1
* (ChL) Fix SLIP encoder used by IMST iU891A-XL

## 0.10.0
* (ChL) Add support for IMST iU891A-XL receiver

## 0.9.4
* (ChL) Upgrade dependencies and general package stuff

## 0.9.3
* (ChL) Fix handling of 64bit integer DIFs

## 0.9.2
* (ChL) Fix handling of frame type B without CRC

## 0.9.1
* (ChL) Fix custom port display in admin page if SerialPort returns no ports

## 0.9.0
* (ChL/kubax) Experimental! Enable serial over raw TCP socket for all devices - use `tcp://host:port` as custom serial port
* serialport is upgraded to v11 - this finally breaks node v12 support!

## 0.8.10
* (ChL) Use compact frame cache independently from manufacturer code

## 0.8.9
* (ChL) Fix display of non-default settings in admin page

## 0.8.8
* (ChL) Add datetime type I handling

## 0.8.7
* (ChL) Slightly improve handling of LVAR DIF values

## 0.8.3 / 0.8.4 / 0.8.5 / 0.8.6
* (ChL) Update dev dependencies - Attention CI test will no longer support <= NodeJS 12
* (ChL) Minor logging changes

## 0.8.2
* (ChL) C-mode support for CUL

## 0.8.1
* (ChL) Fix connection state
* (ChL) Re-add serial logging

## 0.8.0
* (ChL) Complete rewrite of serial communication - now includes unit tested device classes
* (ChL) Upgrade to SerialPort 10.x and dependency clean up
* (ChL) Improve PRIOS decoder

## 0.7.9
* (ChL) Add debug logging to all serial devices

## 0.7.8
* (ChL) Improve logging from receiver modules
* (ChL) fix rawdata state

## 0.7.7
* (ChL) Add support for Diehl PRIOS encoded telegrams (ported from wmbusmeters)

## 0.7.5 / 0.7.6
* (ChL) Fix timeout handling - if no problems occur this will be republished as 1.0.0

## 0.7.3 / 0.7.4
* (ChL) Try to improve CUL support

## 0.7.1 / 0.7.2
* (ChL) Rename to ioBroker.wireless-mbus to be able to publish to npm
* (ChL) Fix block list, admin page logo and repo url in package.json

## 0.7.0
* (ChL) Change main adapter code to class
* (ChL) Include actual (machine) translations besides English and German
* (ChL) Upgrade denpendencies
* (ChL) Add test for wmbus decoder
* (ChL) Add integration tests
* (ChL) Add github workflow

## 0.6.2
* (ChL) Improve admin page to handle custom serialport path
* (ChL) Add option to turn automatic blocking of devices off
* (ChL) Add "Simple Hexstring" receiver for testing purposes
* (ChL) Internal refactoring

## 0.6.0 / 0.6.1
* (ChL) Upgrade of serialport library to 9.2.0
* (ChL) experimental CUL support

## 0.5.2
* (ChL) fix for connection indicator with js-controller 2.x

## 0.5.1
* (ChL) Small fixes
* (ChL) Internal telegram parser now supports wired M-Bus frames (not used - for testing / developing purpose)
* (D Glaser) Added timestamp of last update to device info
* (D Glaser/ChL) Added some setup documentation to README

## 0.5.0
* (ChL) Basic support for Techem devices
* (ChL) Option to force energy units (Wh and J) to kWh - BEWARE this is not really backwards compatible. Old states will keep their "old" unit, but display the adjusted value!

## 0.4.7
* (ChL) Block devices after 10 consecutive failed parse attempts until adapter restart
* (ChL) Assign roles derived from units (as does the mbus adapter)

## 0.4.6
* (ChL) Support for (Kamstrup?) compact frames through data record cache (pre-defined frames have been removed!)

## 0.4.5
* (ChL) Append device ids with key "UNKNOWN" at startup to needskey

## 0.4.2 / 0.4.3 / 0.4.4
* (ChL) Small fixes

## 0.4.1
* (ChL) basic IMST iM871A support

## 0.4.0
* (ChL) better Amber Stick support
* (ChL) Compact mode?
* (ChL) Nicer state names
* (ChL) wMBus mode partially selectable

## 0.3.0
* (ChL) Implemented all VIF types from MBus doc
* (ChL) VIF extensions are handled better (again)
* (ChL) reorganised VIF info
* (ChL) reorganised receiver handling
* (ChL) blocking of devices possible

## 0.2.0 (not tagged)
* (ChL) Dramatically improved parser: support for security mode 7, frame type B, many small fixes
* (ChL) VIF extensions are handled better, but correct handling is still not fully clear
* (ChL) CRCs are checked and removed if still present
* (ChL) raw data is saved if parser fails

## 0.1.0
* (ChL) initial release
