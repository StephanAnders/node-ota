const nodeOta = require('../dist');
const fs = require('fs');
const ota = new nodeOta.NodeOTA(true);

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
    });

process.on('SIGINT', function() {
    process.exit();
});
process.on('exit', code => {
    ota.end();
});