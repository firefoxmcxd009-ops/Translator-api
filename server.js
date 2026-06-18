const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

// 🚀 ម៉ាស៊ីនបង្កើតកូដសុវត្ថិភាព Sec-MS-GEC ដើម្បីបន្លំជា Microsoft Edge ពិតៗ (ដោះស្រាយ Error 400)
function generateSecMsGecToken() {
    const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
    const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
    
    // គណនាពេលវេលាប្រព័ន្ធជា Ticks (100-nanosecond) តាមស្តង់ដារ Windows
    const ticks = BigInt(Math.floor((Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH))) * 10000000n;
    // បង្គត់ពេលវេលាទៅ ៥ នាទីម្តង ដើម្បីឱ្យត្រូវនឹងប្រព័ន្ធ Microsoft
    const roundedTicks = ticks - (ticks % 3000000000n);
    
    const strToHash = `${roundedTicks}${TRUSTED_CLIENT_TOKEN}`;
    const hash = crypto.createHash('sha256');
    hash.update(strToHash, 'ascii');
    return hash.digest('hex').toUpperCase();
}

function mapVoiceAndLang(incomingVoiceID) {
    let voiceID = 'km-KH-SreymomNeural';
    let lang = 'km-KH';

    if (incomingVoiceID) {
        const v = incomingVoiceID.toLowerCase();
        if (v.includes('piseth')) {
            voiceID = 'km-KH-PisethNeural';
            lang = 'km-KH';
        } else if (v.includes('sreymom') || v.includes('km') || v.includes('kh')) {
            voiceID = 'km-KH-SreymomNeural';
            lang = 'km-KH';
        } else if (v.includes('en') || v.includes('us')) {
            voiceID = 'en-US-AvaNeural';
            lang = 'en-US';
        }
    }
    return { voiceID, lang };
}

function mapSpeed(voiceSpeed) {
    if (!voiceSpeed) return '+0%';
    const speed = parseInt(voiceSpeed);
    if (speed === 1) return '+20%';
    if (speed === 2) return '+40%';
    if (speed === -1) return '-20%';
    if (speed === -2) return '-40%';
    return '+0%';
}

// មុខងារហៅទៅកាន់ប្រព័ន្ធ Microsoft Edge TTS ពិតប្រាកដ ១០០%
function getEdgeAudio(text, incomingVoiceID, incomingSpeed) {
    return new Promise((resolve, reject) => {
        const { voiceID, lang } = mapVoiceAndLang(incomingVoiceID);
        const rate = mapSpeed(incomingSpeed);
        const requestId = crypto.randomUUID().replace(/-/g, '');
        
        // បង្កើត Token សុវត្ថិភាពថ្មីបំផុត
        const secMsGec = generateSecMsGecToken();
        const CHROMIUM_FULL_VERSION = '130.0.2849.68';
        
        // ប្តូរទៅកាន់ API Endpoint ថ្មីរបស់ Microsoft Edge ដែលគាំទ្រ Sec-MS-GEC
        const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}&ConnectionId=${requestId}`;
        
        const ws = new WebSocket(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'Origin': 'chrome-extension://jdiccldimpdaibmpbnoehnmfiafhaocl' // បញ្ជាក់ថាជា Extension ផ្លូវការរបស់ Edge
            }
        });
        
        let audioBuffers = [];
        let isFinished = false;

        let timeout = setTimeout(() => {
            if (!isFinished) {
                isFinished = true;
                ws.terminate();
                reject(new Error("Microsoft Edge TTS Timeout"));
            }
        }, 12000);

        ws.on('open', () => {
            const configMsg = `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbps-mono-mp3"}}}}`;
            ws.send(configMsg);

            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voiceID}'><prosody rate='${rate}'>${text}</prosody></voice></speak>`;
            const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
            ws.send(ssmlMsg);
        });

        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                const headerLength = data.readUInt16BE(0);
                audioBuffers.push(data.slice(2 + headerLength));
            } else if (data.toString().includes("Path:turn.end")) {
                isFinished = true;
                clearTimeout(timeout);
                ws.close();
                resolve(Buffer.concat(audioBuffers));
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        
        ws.on('close', () => clearTimeout(timeout));
    });
}

// បង្កើត Node.js HTTP Server
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/api/tts') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (!data.text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'សូមបញ្ចូលអត្ថបទ' }));
                }

                console.log(`[API] ទទួលបានសំណើថ្មីសម្រាប់សំឡេង: ${data.voiceID || 'Sreymom'}`);
                
                // ហៅទៅយកសំឡេងពី Microsoft Edge ដោយផ្ទាល់
                const audioBuffer = await getEdgeAudio(data.text, data.voiceID, data.voiceSpeed);
                
                res.writeHead(200, {
                    'Content-Type': 'audio/mpeg',
                    'Content-Length': audioBuffer.length
                });
                res.end(audioBuffer);
                console.log("[API] បានបញ្ជូនហ្វាយសំឡេង Piseth/Sreymom ទៅ HTML រួចរាល់! 🎉\n");

            } catch (error) {
                console.error("[API Error] មូលហេតុកំហុសគឺ:", error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ប្រព័ន្ធ API ដំណើរការធម្មតា!');
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server កំពុងរត់នៅលើ Port: ${PORT}`);
});
