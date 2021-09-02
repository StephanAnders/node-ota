// imports
const NodeOTA = require('../dist').NodeOTA;
const fs = require('fs');
const { spawn } = require('child_process');
const SerialPort = require('serialport');
const http = require('http');
const Readline = require('@serialport/parser-readline');
const WebSocketServer = require('ws').WebSocketServer;

// constants
const webserverPort = 8000;
const OS = 'windows'; // linux
const uploadCommand = {
    linux: {
        esp8266: 'esptool.py',
        esp32: 'esptool.py'
    },
    windows: {
        esp8266: 'C:\\Users\\User\\AppData\\Local\\Arduino15\\packages\\esp8266\\tools\\python3\\3.7.2-post1\\python3',
        esp32: 'C:\\Users\\User\\AppData\\Local\\Arduino15\\packages\\esp32\\tools\\esptool_py\\3.0.0\\esptool.exe'
    }
}
const firstParam = {
    linux: {
        esp8266: [],
        esp32: []
    },
    windows: {
        esp8266: ['C:\\Users\\User\\AppData\\Local\\Arduino15\\packages\\esp8266\\hardware\\esp8266\\2.7.4\\tools\\upload.py'],
        esp32: []
    }
}

// define attached devices
const hardware = [
    {
        id: 'device1',
        chip: 'esp8266', // esp32
        ota: new NodeOTA(),
        otaPort: 8266,
        serial: null,
        serialPort: 'COM4', // '/dev/ttyUSB0',
        filehandle: null,
        websocket: null,
        websocketPort: 81,
        isOTAActive: false
    }
]


// setup each device
for (const device of hardware) {
    // setup serial monitor and websocket
    device.serial = new SerialPort(device.serialPort, {
        baudRate: 115200,
        autoOpen: false
    });
    const wss = new WebSocketServer({
        port: device.websocketPort
    });

    // link websocket and serial
    device.serial.open();
    device.serial.on('open', () => console.log('serial open'));
    const lineStream = device.serial.pipe(new Readline())
    lineStream.on('data', data => {
        if (device.websocket) {
            device.websocket.send(JSON.stringify({
                serial: data
            }));
        }
    });
    wss.on('connection', function connection(ws) {
        device.websocket = ws;
        ws.on('message', function incoming(message) {
            const obj = JSON.parse(message);
            if (obj['serial'] && !device.isOTAActive) {
                device.serial.write(obj['serial']);
            }
        });
    });

    // ota
    device.ota
        .begin(device.id, device.otaPort, device.id)
        .onStart((size => {
            device.filehandle = fs.createWriteStream('./' + device.id + '.bin');
            activateOTA(device);
        }))
        .onProgress(((currentPacket, transferred, total, data) => {
            device.filehandle.write(data);
        }))
        .onError(((err) => {
            device.filehandle.close();
            deactivateOTA(device);
        }))
        .onEnd(() => {
            device.filehandle.close();

            const params = [
                ...firstParam[OS][device.chip],
                '--port',
                device.serialPort,
                '--baud',
                '115200',
                '--before',
                'default_reset',
                '--after',
                'hard_reset',
                'write_flash',
                device.chip === 'ESP32' ? '0x10000' : '0x0',
                device.id + '.bin'
            ]
            const esptool = spawn(
                uploadCommand[OS][device.chip],
                params,
                {cwd: __dirname}
            );
            esptool.stdout.on('data', (data) => {
                console.log('Esptool.stdout(' + data + ')');
            });
            esptool.stderr.on('data', (data) => {
                console.error('Esptool.stderr(' + data + ')');
            });
            esptool.on('close', (code) => {
                if (code !== 0) {
                    device.ota.error();
                }
                deactivateOTA(device);
            });
        });
}

// setup webserver
const requestListener = function (req, res) {
    console.log(req.url);
    switch (req.url) {
        case '/devices':
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader("Content-Type", "application/json");
            res.writeHead(200);
            res.end(JSON.stringify(hardware.map(device => {
                return {
                    id: device.id,
                    websocketPort: device.websocketPort
                };
            })));
            break;
        default:
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader("Content-Type", "application/json");
            res.writeHead(404);

        // send requested file
    }
}
const server = http.createServer(requestListener);
server.listen(webserverPort, () => {
    console.log(`Server is running on port ${webserverPort}`);
});

// setup current process
process.on('SIGINT', function() {
    process.exit();
});
process.on('exit', code => {
    for (const device of hardware) {
        if (device.serial) device.serial.close();
        if (device.websocket) device.websocket.close();
        device.ota.end();
    }
});


// helper methods
const activateOTA = (device) => {
    device.isOTAActive = true;
    if (device.websocket) device.websocket.send(JSON.stringify({
        serial: 'Closing serial for OTA update'
    }));
    device.serial.close();
}
const deactivateOTA = (device) => {
    device.isOTAActive = false;
    setTimeout(() => {
        device.serial.open(() => {
            if (device.websocket) device.websocket.send(JSON.stringify({
                serial: 'Opening serial after OTA update'
            }));
        });
    }, 500)
}