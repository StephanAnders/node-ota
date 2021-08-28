import {Socket} from 'dgram';

// NodeOTA constants
const U_FLASH = 0;
const U_FS = 100;
const U_AUTH = 200;

// local types
enum OtaState {
    IDLE,
    WAITING,
    UPDATING,
    ERROR
}

// public types
export type onStartCallback = (size: number) => void;
export type onProgressCallback = (currentPacket: number, transferred: number, total: number, data: Buffer) => void;
export type onErrorCallback = (err: Error) => void;
export type onEndCallback = () => void;

export class NodeOTA {
    private bonjour = require('bonjour')();
    private md5Builder = require('md5');
    private socket: Socket = require('dgram').createSocket('udp4');

    private state: OtaState = OtaState.IDLE;
    private password: string | null = null;
    private remoteTcpPort: number = 0;
    private remoteUdpPort: number = 0;
    private remoteIP: string = '';
    private size: number = 0;
    private md5: string = '';
    private nonce: string = '';
    private readonly debug: boolean;

    // callbacks
    private onStartCb: onStartCallback | null = null;
    private onProgressCb: onProgressCallback | null = null;
    private onErrorCb: onErrorCallback | null = null;
    private onEndCb: onEndCallback | null = null;
    
    constructor(debug: boolean = false) {
        this.debug = debug;
    }

    /**
     * @param   name
     * @param   port
     * @param   password
     * @param   isPasswordMD5
     * @throws  Error
     */
    public begin(name = 'Node OTA', port = 8266, password: string | null = null, isPasswordMD5 = false): NodeOTA {
        if (this.debug) console.log('NodeOTA.begin(name=' + name + ', port=' + port + ')');

        if (password) {
            this.password = isPasswordMD5 ? password : this.md5Builder(password);
        }

        const publishOptions = {
            name: name,
            type: 'arduino',
            port: port,
            protocol: 'tcp',
            txt: {
                board: 'node',
                tcp_check: 'no',
                ssh_upload: 'no',
                auth_upload: password ? 'yes' : 'no'
            }
        };

        if (this.debug) console.log('NodeOTA.mdns.publish(' + JSON.stringify(publishOptions) + ')');
        this.bonjour.publish(publishOptions);

        this.socket
            .on('message', (msg: Buffer, rinfo: any) => {
                this.receive(msg.toString(), rinfo);
            })
            .on('error', (err => {
                console.error(err);
                if (this.state === OtaState.UPDATING) {
                    if (this.onErrorCb) this.onErrorCb(err);

                    if (this.debug) console.log('NodeOTA.state(updating => idle)');
                    this.state = OtaState.IDLE;

                } else if (this.state === OtaState.WAITING) {
                    if (this.debug) console.log('NodeOTA.state(waiting => idle)');
                    this.state = OtaState.IDLE;
                }
            }))
            .on('listening', () => {
                const address = this.socket.address();
                if (this.debug) console.log('NodeOTA.socket.bind(address=' + address.address + ', port=' + address.port + ')');
            })
            .bind(port);

        return this;
    }

    public end() {
        if (this.debug) console.log('NodeOTA.end()');

        this.bonjour.unpublishAll();
        this.bonjour.destroy();
        if (this.debug) console.log('NodeOTA.mdns.unpublishAll()', 'NoteOTA.mdns.destroy()');

        this.socket.close();
        if (this.debug) console.log('NodeOTA.socket.close())');
    }

    public error() {
        if (this.debug) console.log('NodeOTA.state(updating => error)');
        this.state = OtaState.ERROR;
    }

    public onStart(cb: onStartCallback): NodeOTA {
        this.onStartCb = cb;
        return this;
    }

    public onProgress(cb: onProgressCallback): NodeOTA {
        this.onProgressCb = cb;
        return this;
    }

    public onError(cb: onErrorCallback): NodeOTA {
        this.onErrorCb = cb;
        return this;
    }

    public onEnd(cb: onEndCallback): NodeOTA {
        this.onEndCb = cb;
        return this;
    }

    private receive(message: string, remote: any) {
        if (this.debug) console.log('NodeOTA.receive(message=' + message.replace('\n', '') + ', ip=' + remote.address + ', port=' + remote.port + ')');

        const data: any = message.replace('\n', '').split(' ');
        switch (this.state) {
            case OtaState.IDLE:
                if (data[0] != U_FLASH && data[0] != U_FS || data[3].length !== 32) {
                    console.error('NodeOTA.receive(idle, invalid data)');
                    return;
                }
                this.remoteIP = remote.address;
                this.remoteUdpPort = remote.port;
                this.remoteTcpPort = data[1];
                this.size = parseInt(data[2]);
                this.md5 = data[3];

                if (this.password) {
                    this.nonce = this.md5Builder(Math.random() + '');
                    this.socket.send('AUTH ' + this.nonce, this.remoteUdpPort, this.remoteIP);
                    this.state = OtaState.WAITING;
                    if (this.debug) console.log('NodeOTA.state(idle => waiting for auth)');
                } else {
                    if (this.debug) console.log('NodeOTA.state(idle => updating)');
                    this.runUpdate();
                }

                break;
            case OtaState.WAITING:
                if (data[0] != U_AUTH || (data[1].length !== 32 || data[2].length !== 32)) {
                    if (this.debug) console.log('NodeOTA.state(waiting => updating)');
                    console.error('NodeOTA.receive(waiting, invalid data)');
                    this.state = OtaState.IDLE;
                    return;
                }

                const challenge: string = this.password + ':' + this.nonce + ':' + data[1];
                if (data[2] === this.md5Builder(challenge)) {
                    if (this.debug) console.log('NodeOTA.state(waiting => updating)');
                    this.runUpdate();

                } else {
                    console.error('NoteOTA.receive(waiting, invalid credentials)');
                    this.socket.send('Authentication failed', this.remoteUdpPort, this.remoteIP);
                }

                break;
        }
    }

    private runUpdate() {
        if (this.debug) console.log('NodeOTA.runUpdate(size=' + this.size + ')');
        this.state = OtaState.UPDATING;

        this.socket.send('OK', this.remoteUdpPort, this.remoteIP);
        if (this.onStartCb) this.onStartCb(this.size);

        // wait shortly for the IDE to process the response above
        setTimeout(() => {
            let transferred = 0;
            const socket = require('net').createConnection(this.remoteTcpPort, this.remoteIP);
            socket.setNoDelay(true);
            socket.on('error', (err: Error) => {
                console.error(err);
                if (this.onErrorCb) this.onErrorCb(err)

                if (this.debug) console.log('NodeOTA.state(updating => idle)');
                this.state = OtaState.IDLE;
            });
            socket.on('data', (data: Buffer) => {
                if (this.state === OtaState.UPDATING) {
                    transferred += data.length;
                    socket.write(data.length.toString());
                    if (this.onProgressCb) this.onProgressCb(data.length, transferred, this.size, data);

                    if (transferred == this.size) {
                        if (this.debug) console.log('NodeOTA.runUpdate(transferred=' + transferred + ')');

                        socket.write('OK');
                        socket.end();
                        if (this.onEndCb) this.onEndCb();

                        if (this.debug) console.log('NodeOTA.state(updating => idle)');
                        this.state = OtaState.IDLE;
                    }
                }

                if (this.state === OtaState.ERROR) {
                    socket.destroy();

                    if (this.debug) console.log('NodeOTA.state(error => idle)');
                    this.state = OtaState.IDLE;
                }
            });
        }, 100);
    }
}
