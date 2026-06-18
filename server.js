const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

function mapVoiceAndLang(incomingVoiceID) {
    let voiceID = 'km-KH-SreymomNeural';
    let lang = 'km-KH';
    if (incomingVoiceID && incomingVoiceID.toLowerCase().includes('piseth')) {
        voiceID = 'km-KH-PisethNeural';
    }
    return { voiceID, lang };
}

function generateToken() {
    const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
    const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9B87E7EFD3C454C3EF';
    let ticks = BigInt(Math.floor(Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH)) * 10000000n;
    const roundedTicks = ticks - (ticks % 3000000000n);
    return crypto.createHash('sha256').update(`${roundedTicks}${TRUSTED_CLIENT_TOKEN}`, 'ascii').digest('hex').toUpperCase();
}

function connectToEdge(text, voiceID, lang) {
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID().replace(/-/g, '');
        const token = generateToken();
        const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9B87E7EFD3C454C3EF&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=${requestId}`;
        
        const ws = new WebSocket(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68',
                'Origin': 'chrome-extension://jdiccldimpdaibmpbnoehnmfiafhaocl'
            }
        });
        
        let audioBuffers = [];
        let hasAudioData = false;
        
        const timeout = setTimeout(() => {
            ws.terminate();
            reject(new Error("Microsoft មិនឆ្លើយតបយូរពេក (Timeout) - ប្រហែលជា IP ត្រូវបានប្លុក"));
        }, 8000);
        
        ws.on('open', () => {
            const configMsg = `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"outputFormat":"audio-24khz-48kbps-mono-mp3"}}}}`;
            ws.send(configMsg);
            
            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voiceID}'><prosody rate='+0%'>${text}</prosody></voice></speak>`;
            const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
            ws.send(ssmlMsg);
        });
        
        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                // ចាប់យកទិន្នន័យចំណងជើងកញ្ចប់ភីកសែល
                const headerLength = data.readUInt16BE(0);
                const audioContent = data.slice(2 + headerLength);
                if (audioContent.length > 0) {
                    hasAudioData = true;
                    audioBuffers.push(audioContent);
                }
            } else if (data.toString().includes("Path:turn.end")) {
                clearTimeout(timeout);
                ws.close();
                if (!hasAudioData) {
                    reject(new Error("Microsoft បានបដិសេធ (ទិន្នន័យសំឡេងស្មើ 0 Byte) - IP ជាប់ Blacklist របស់ Microsoft"));
                } else {
                    resolve(Buffer.concat(audioBuffers));
                }
            }
        });
        
        ws.on('error', (err) => { clearTimeout(timeout);
            reject(err); });
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') { return res.writeHead(204).end(); }
    
    if (req.method === 'POST' && req.url === '/api/tts') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { voiceID, lang } = mapVoiceAndLang(data.voiceID);
                
                console.log(`[Edge TTS] កំពុងហៅសំឡេង: ${voiceID}`);
                const audioBuffer = await connectToEdge(data.text, voiceID, lang);
                
                res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
                res.end(audioBuffer);
                console.log("[Edge TTS] បានបញ្ជូនសំឡេងរួចរាល់! 🎉");
            } catch (error) {
                console.error("[Render Log Error]:", error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    } else {
        res.writeHead(200).end('Edge TTS Working');
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT);