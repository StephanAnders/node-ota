const nodeOta = require('./dist/index.js');

const ota = new nodeOta.NodeOTA(true);

let file = '';
ota
    .begin('Node Device', 8266, 'test')
    .onStart((size => {
        file = '';
        console.log('START');
    }))
    .onProgress(((currentPacket, transferred, total, data) => {
        file += data;
        console.log((transferred / total) * 100 + '%');
    }))
    .onError(((err) => {
        file = '';
        console.log('ERROR');
    }))
    .onEnd(() => {
        console.log('END')
    });

process.on('SIGINT', function() {
    process.exit();
});
process.on('exit', code => {
    ota.end();
});
