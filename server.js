const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

// មុខងារផ្គូផ្គង Voice ID របស់ Microsoft Edge TTS
function mapVoiceAndLang(incomingVoiceID) {
    let voiceID = 'km-KH-SreymomNeural';
    let lang = 'km-KH';

    if (incomingVoiceID) {
        const v = incomingVoiceID.toLowerCase();
        if (v.includes('piseth')) {
            voiceID = 'km-KH-PisethNeural';
        } else if (v.includes('sreymom') || v.includes('km') || v.includes('kh')) {
            voiceID = 'km-KH-SreymomNeural';
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

// មុខងារបង្កើត Sec-MS-GEC Token
function generateSecMsGecToken(offsetTicks = 0n) {
    const WINDOWS_FILE_TIME_EPOCH = 11644473600n;
    const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9B87E7EFD3C454C3EF';
    
    let ticks = BigInt(Math.floor(Date.now() / 1000) + Number(WINDOWS_FILE_TIME_EPOCH)) * 10000000n;
    ticks += offsetTicks;
    
    const roundedTicks = ticks - (ticks % 3000000000n); // បង្គត់ទៅ ៥ នាទីម្តង
    const strToHash = `${roundedTicks}${TRUSTED_CLIENT_TOKEN}`;
    
    return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

// មុខងារភ្ជាប់ទៅកាន់ WebSocket
function connectToEdge(text, voiceID, lang, rate, offsetTicks = 0n) {
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID().replace(/-/g, '');
        const secMsGec = generateSecMsGecToken(offsetTicks);
        const CHROMIUM_FULL_VERSION = '130.0.2849.68';
        
        const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9B87E7EFD3C454C3EF&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}&ConnectionId=${requestId}`;
        
        const ws = new WebSocket(url, {
            headers: {
                'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION}`,
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'Origin': 'chrome-extension://jdiccldimpdaibmpbnoehnmfiafhaocl'
            }
        });
        
        let audioBuffers = [];
        let isFinished = false;
        let responseStatusCode = 200;

        let timeout = setTimeout(() => {
            if (!isFinished) {
                isFinished = true;
                ws.terminate();
                reject({ message: "Timeout (ម៉ាស៊ីនមិនឆ្លើយតប)", statusCode: 408 });
            }
        }, 10000);

        ws.on('unexpected-response', (req, res) => {
            responseStatusCode = res.statusCode;
        });

        ws.on('open', () => {
            // កែសម្រួល៖ លុប X-Timestamp ចេញដើម្បីកុំឱ្យទម្រង់ Frame របស់ Microsoft គាំង
            const configMsg = `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbps-mono-mp3"}}}}`;
            ws.send(configMsg);

            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voiceID}'><prosody rate='${rate}'>${text}</prosody></voice></speak>`;
            const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
            ws.send(ssmlMsg);
        });

        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                // ទាញយកទិន្នន័យសំឡេងពីកញ្ចប់ Binary របស់ Microsoft
                const headerLength = data.readUInt16BE(0);
                audioBuffers.push(data.slice(2 + headerLength));
            } else {
                const msgStr = data.toString();
                // បង្ហាញព្រឹត្តិការណ៍ពី Microsoft ទៅកាន់ Render Log ដើម្បីងាយស្រួលតាមដាន
                if (msgStr.includes("Path:turn.start")) console.log("[Microsoft] ចាប់ផ្តើមដំណើរការសំឡេង...");
                if (msgStr.includes("Path:turn.end")) {
                    isFinished = true;
                    clearTimeout(timeout);
                    ws.close();
                    
                    // ការពារករណីទទួលបានទិន្នន័យទទេ (0 Byte)
                    if (audioBuffers.length === 0) {
                        reject({ message: "ទទួលបានទិន្នន័យទទេពី Microsoft (Empty Audio Buffer)", statusCode: 200 });
                    } else {
                        resolve(Buffer.concat(audioBuffers));
                    }
                }
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject({ message: err.message, statusCode: responseStatusCode });
        });
        
        ws.on('close', () => {
            clearTimeout(timeout);
            if (!isFinished) {
                reject({ message: "ការភ្ជាប់ត្រូវបានបិទមុនពេលកំណត់", statusCode: responseStatusCode });
            }
        });
    });
}

// មុខងារចម្បងជាមួយប្រព័ន្ធ Auto-Retry Loop ៣ ដំណាក់កាល
async function getEdgeAudio(text, incomingVoiceID, incomingSpeed) {
    const { voiceID, lang } = mapVoiceAndLang(incomingVoiceID);
    const rate = mapSpeed(incomingSpeed);
    
    // បង្កើតការតេស្តម៉ោង Server [ម៉ោងបច្ចុប្បន្ន, ថយក្រោយ៥នាទី, ទៅមុខ៥នាទី]
    const timeOffsets = [0n, -3000000000n, 3000000000n]; 
    let lastError = null;

    for (const offset of timeOffsets) {
        try {
            console.log(`[Edge TTS] កំពុងព្យាយាមទាញយកសំឡេងជាមួយ Offset: ${offset}n...`);
            const buffer = await connectToEdge(text, voiceID, lang, rate, offset);
            return buffer; 
        } catch (err) {
            console.warn(`[Edge TTS] មិនជោគជ័យត្រង់ម៉ោង Offset ${offset}n (Status: ${err.statusCode}, Error: ${err.message})`);
            lastError = err;
        }
    }
    
    throw new Error(lastError?.message || "Microsoft បដិសេធការបង្កើតសំឡេង");
}

// បង្កើត Node.js Server
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

                console.log(`[API] ទទួលបានសំណើសម្រាប់សំឡេង: ${data.voiceID || 'Sreymom'}`);
                
                const audioBuffer = await getEdgeAudio(data.text, data.voiceID, data.voiceSpeed);
                
                res.writeHead(200, {
                    'Content-Type': 'audio/mpeg',
                    'Content-Length': audioBuffer.length
                });
                res.end(audioBuffer);
                console.log("[API] បានបញ្ជូនហ្វាយសំឡេងទៅ HTML រួចរាល់! 🎉\n");

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
