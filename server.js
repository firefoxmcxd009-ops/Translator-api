const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

// មុខងារផ្គូផ្គង Voice ID ឱ្យត្រូវនឹងស្តង់ដារ Microsoft 
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

// មុខងារកំណត់ល្បឿនសំឡេង
function mapSpeed(voiceSpeed) {
    if (!voiceSpeed) return '+0%';
    const speed = parseInt(voiceSpeed);
    if (speed === 1) return '+20%';
    if (speed === 2) return '+40%';
    if (speed === -1) return '-20%';
    if (speed === -2) return '-40%';
    return '+0%';
}

// ម៉ាស៊ីនទាញយកសំឡេងពី Microsoft Edge TTS (Aria Stable Protocol)
function getEdgeAudio(text, incomingVoiceID, incomingSpeed) {
    return new Promise((resolve, reject) => {
        const { voiceID, lang } = mapVoiceAndLang(incomingVoiceID);
        const rate = mapSpeed(incomingSpeed);
        const requestId = crypto.randomUUID().replace(/-/g, '');
        
        // ប្រើប្រាស់ Aria Stable Endpoint ដែលមានស្ថិរភាពខ្ពស់បំផុតសម្រាប់ Cloud Server
        const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/trusted/v1/aria/stream?TrustedClientToken=6A5AA1D4EAFF4E9B87E7EFD3C454C3EF&ConnectionId=${requestId}`;
        
        const ws = new WebSocket(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
                'Origin': 'chrome-extension://jdiccldimpdaibmpbnoehnmfiafhaocl', // ហត្ថលេខា Extension ផ្លូវការដើម្បីការពារ Error 400/403
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache'
            }
        });
        
        let audioBuffers = [];
        let isFinished = false;

        // ការពារករណីគាំងរង់ចាំយូរ
        let timeout = setTimeout(() => {
            if (!isFinished) {
                isFinished = true;
                ws.terminate();
                reject(new Error("អស់រយៈពេលរង់ចាំឆ្លើយតបពី Microsoft (Timeout)"));
            }
        }, 15000);

        ws.on('open', () => {
            // បច្ចុប្បន្នភាព៖ ត្រូវតែមាន X-Timestamp នៅក្នុងរាល់ Frame ផ្ញើទៅកាន់ Microsoft ដាច់ខាត
            const timestamp = new Date().toString();
            
            // ១. ផ្ញើការកំណត់ទម្រង់ហ្វាយសំឡេង (Audio Output Config)
            const configMsg = `X-Timestamp:${timestamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbps-mono-mp3"}}}}`;
            ws.send(configMsg);

            // ២. ផ្ញើអត្ថបទអក្ខរាវិរុទ្ធ SSML ដើម្បីបង្កើតសំឡេង
            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voiceID}'><prosody rate='${rate}'>${text}</prosody></voice></speak>`;
            const ssmlMsg = `X-RequestId:${requestId}\r\nX-Timestamp:${timestamp}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
            ws.send(ssmlMsg);
        });

        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                // ទាញយកទិន្នន័យសំឡេង MP3 ពីកញ្ចប់ Binary របស់ Microsoft
                const headerLength = data.readUInt16BE(0);
                audioBuffers.push(data.slice(2 + headerLength));
            } else if (data.toString().includes("Path:turn.end")) {
                // នៅពេលប្រព័ន្ធបញ្ចប់ការបញ្ជូនសំឡេងទាំងស្រុង
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
    // កំណត់ CORS ដើម្បីអនុញ្ញាតឱ្យ HTML ហៅមកប្រើប្រាស់បានដោយសេរី
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
                
                // ហៅទៅទាញយកសំឡេងពី Microsoft Edge ដោយផ្ទាល់
                const audioBuffer = await getEdgeAudio(data.text, data.voiceID, data.voiceSpeed);
                
                // ផ្ញើហ្វាយសំឡេង MP3 ត្រឡប់ទៅកាន់ HTML វិញ
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
