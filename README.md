# Node OTA
## TL;DR
- see Example section of this document

## Motivation
I'd like to run/maintain an Arduino board that is connected to a Raspberry Pi Zero without having the need
to hassle with manual updating the Arduino firmware via the Rasperry. Therefore I implemented this node-based ArduinoOTA
server. The idea is that you can implement changes in your IDE of choice (Arduino IDE, vscode, or Visual Studio with vMicro etc) 
and just hit the "upload" button. This library will receive all update requests from the IDE and provide you some callbacks
(like ArduinoOTA) that can be used e.g. to transfer the binary via UART using avrdude or similar tools. 

That's none of my best works, but will do the trick for my project and most likely also yours.
Nonetheless, I'll reply to all issues you create and review/merge your PRs (if they're not total garbage).

## Version history (semantic versioning)
- v1.0.1 -> first working implementation
- v1.0.2 -> fix package.json
- v2.0.0 -> fix onProgress event and extend example
- v2.0.1 -> updated example and documentation
- v2.0.2 -> added another example

## Implementation
I followed the implementation of the original [ArduinoOTA](https://github.com/esp8266/Arduino/blob/master/libraries/ArduinoOTA) library
and extended the relevant functionality (port propagation) from Arduino's MDNS library. Additionally I adjusted the
error escalation a bit:
- the only error escalated to your application via the onError callback, are errors that occur during transmission (e.g. socket time out)
- other errors (auth, begin etc) are handled inside the NodeOTA class or escalated as exceptions if reasonable

### External dependencies
I'm using Node 14.15.4 on a Windows machine and the following external libraries
- [md5 2.3.0](https://www.npmjs.com/package/md5)
- [bonjour 3.5.0](https://www.npmjs.com/package/bonjour)

## Code
The NodeOTA class holds all necessary functions and provides the following methods for interaction:

### begin(name, port, password, isPasswordMD5): NodeOTA
Call this method to initialize the bonjour instance for service propagation and the UDP socket for incoming connections.
This method will return the NodeOTA instance and has the following parameters:
- `name: string` will be displayed in your IDE in the port section
- `port: number` is the port on which your device will be listening for update requests from your IDE
- `password: string` if you want to secure your connection provide a password here or a MD5 hash
- `isPasswordMD5: boolean = false` set to true if the password provided through `password` is already and MD5 hash

### end(): void
Call this method to shutdown the NodeOTA instance and thus terminating the MDNS instance and UDP socket

### error(): void
Call this method to notify your IDE that something went wrong during data transmission on your end. The TCP socket connection
for transmitting the binary image will be terminated afterwards

### onStart(cb: onStartCallback): NodeOTA
Call this method and provide a callback if you like to be notified about upcoming data transmissions. The onStartCallback
type returns void and accepts the following parameters:
- `size: number` the number of bytes that are about to be transmitted

### onProgress(cb: onProgressCallback): NodeOTA
Call this method and provide a callback if you like to be notified about a data transmission's progress. The callback
will be called per packet that is sent by the IDE (so most likely pretty often). The onProgressCallback type returns void
and accepts the following parameters:
- `currentPacket: number` is the number of bytes that were transferred in the current packet
- `transferred: number` holds the number of bytes that were transferred so far
- `total: number` the size of the whole binary
- `data: string` the content of the current packet. Concatenate all those data portions to get the whole binary

### onError(cb: onErrorCallback): NodeOTA
Call this method and provide a callback if you like to be notified about errors during binary image transmissions. The 
onErrorCallback type returns void and accepts the following parameters:
- `err: Error` the error thrown by the UDP socket or by the TCP socket which reads the binary image from your IDE

### onEnd(cb: onEndCallback): NodeOTA
Call this method and provide a callback if you like to be notified about upcoming data transmissions. The onEndCallback
type returns void and has no parameters

### Example for ESP chips and linux-based device
- run `npm install node-ota` 
- copy this code into a .js file and adjust the board constant (ESP32 or ESP8266) and adjust the child process call in the onEnd callback
- execute it with node
```js
const nodeOta = require('node-ota');
const fs = require('fs');
const { spawn } = require('child_process');
const ota = new nodeOta.NodeOTA(true);

const board = 'ESP8266'; // or 'ESP32';

let filehandle = null;
ota
    .begin('Node Device', 8266, 'test')
    .onStart((size => {
        filehandle = fs.createWriteStream('./binary.bin');
        console.log('Script.start()');
    }))
    .onProgress(((currentPacket, transferred, total, data) => {
        filehandle.write(data);
    }))
    .onError(((err) => {
        console.log('Script.error()');
    }))
    .onEnd(() => {
        console.log('Script.end()');
        filehandle.close();

        const params = board === 'ESP32'
            ? ['--port', '/dev/ttyUSB0', '--baud', '115200', '--before', 'default_reset', '--after', 'hard_reset', 'write_flash', '0x10000', 'binary.bin']
            : ['--port', '/dev/ttyUSB0', '--baud', '115200', '--before', 'default_reset', '--after', 'hard_reset', 'write_flash', '0x0', 'binary.bin']
        const esptool = spawn('esptool.py', params, {cwd: __dirname});

        esptool.stdout.on('data', (data) => {
            console.log('Esptool.stdout(' + data + ')');
        });

        esptool.stderr.on('data', (data) => {
            console.error('Esptool.stderr(' + data + ')');
        });

        esptool.on('close', (code) => {
            if (code !== 0) {
                console.log('Esptool.error()');
                ota.error();
            }
            console.log('Esptool.end(code=' + code + ')');
        });
    });

process.on('SIGINT', function() {
    process.exit();
});
process.on('exit', code => {
    ota.end();
});
```
- go to your Arduino IDE, select the port labelled as 'Node Device'
- build and upload a sketch e.g. the Blink sketch (password is `test`)

# License
This is licensed under WTFPL, so do whatever you like with this code.

# Development/Usage
This library is written in TypeScript und bundled with rollup for further usage and publishing and see src/NodeOTA.ts for
the source code. If you just want to use the library either get via npm or run `npm run start`, which will bundle the
library first and start the node script `basic_example.js` afterwards.

# Contribution
Feel free to create issues or PRs.

# TODOs
- [x] publishing this library as npm
- [ ] automatic test