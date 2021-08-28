const nodeOta = require('./dist/index.js');
const fs = require('fs');

const ota = new nodeOta.NodeOTA(true);

let file = '';
let filehandle = fs.createWriteStream('./binary.hex');
ota
    .begin('Node Device', 8266, 'test')
    .onStart((size => {
        file = '';
        console.log('START');
    }))
    .onProgress(((currentPacket, transferred, total, data) => {
        filehandle.write(data);
        console.log((transferred / total) * 100 + '%');
    }))
    .onError(((err) => {
        file = '';
        console.log('ERROR');
    }))
    .onEnd(() => {
        filehandle.close();
        console.log('FILE WRITTEN')
        console.log('END');
    });

process.on('SIGINT', function() {
    process.exit();
});
process.on('exit', code => {
    ota.end();
});
