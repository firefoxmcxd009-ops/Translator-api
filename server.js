const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

// មុខងារវៃឆ្លាត៖ ផ្គូផ្គងទិន្នន័យចាស់ពី HTML ទៅកាន់សំឡេងពិតរបស់ Microsoft
function mapVoiceAndLang(incomingVoiceID) {
    let voiceID = 'km-KH-SreymomNeural'; // លំនាំដើម
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
        } else {
            voiceID = incomingVoiceID;
            const parts = incomingVoiceID.split('-');
            if (parts.length >= 2) lang = `${parts[0]}-${parts[1]}`;
        }
    }
    return { voiceID, lang };
}

// មុខងារបំប្លែងល្បឿនសំឡេង
function mapSpeed(voiceSpeed) {
    if (!voiceSpeed) return '+0%';
    const speed = parseInt(voiceSpeed);
    if (speed === 1) return '+20%';
    if (speed === 2) return '+40%';
    if (speed === -1) return '-20%';
    if (speed === -2) return '-40%';
    return '+0%';
}

function getEdgeAudio(text, incomingVoiceID, incomingSpeed) {
    return new Promise((resolve, reject) => {
        const { voiceID, lang } = mapVoiceAndLang(incomingVoiceID);
        const rate = mapSpeed(incomingSpeed);
        const requestId = crypto.randomUUID().replace(/-/g, '');
        
        // 🔥 ចំណុចកែប្រែសំខាន់បំផុត៖ បន្ថែម options { headers } បន្លំខ្លួនជា Microsoft Edge Browser ការពារ Error 400
        const ws = new WebSocket(
            `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/trusted/v1/aria/stream?TrustedClientToken=6A5AA1D4EAFF4E9B87E7EFD3C454C3EF&ConnectionId=${requestId}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
                    'Pragma': 'no-cache',
                    'Cache-Control': 'no-cache',
                    'Origin': 'chrome-extension://jdiccjclgidgnoocibehandapbafbgne'
                }
            }
        );
        
        let audioBuffers = [];
        let timeout = setTimeout(() => {
            ws.terminate();
            reject(new Error("អស់រយៈពេលរង់ចាំពី Microsoft Server (Timeout)"));
        }, 20000);

        ws.on('open', () => {
            const now = new Date().toString();
            // ផ្ញើការកំណត់ទម្រង់សំឡេង
            const configMsg = `X-Timestamp:${now}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbps-mono-mp3"}}}}`;
            ws.send(configMsg);

            // ផ្ញើអត្ថបទ SSML
            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voiceID}'><prosody rate='${rate}'>${text}</prosody></voice></speak>`;
            const ssmlMsg = `X-RequestId:${requestId}\r\nX-Timestamp:${now}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
            ws.send(ssmlMsg);
        });

        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                try {
                    const headerLength = data.readUInt16BE(0);
                    const audioChunk = data.slice(2 + headerLength);
                    audioBuffers.push(audioChunk);
                } catch (e) {
                    // បង្ការកំហុសតូចតាចពេលអានទិន្នន័យ Binary
                }
            } else {
                if (data.toString().includes("Path:turn.end")) {
                    clearTimeout(timeout);
                    ws.close();
                    resolve(Buffer.concat(audioBuffers));
                }
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        ws.on('close', () => {
            clearTimeout(timeout);
        });
    });
}

const server = http.createServer(async (req, res) => {
    // បើក CORS ឱ្យទំព័រ HTML របស់អ្នកអាចទាក់ទងមកបានទោះនៅទីណាក៏ដោយ
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

                const audioBuffer = await getEdgeAudio(data.text, data.voiceID, data.voiceSpeed);
                
                res.writeHead(200, {
                    'Content-Type': 'audio/mpeg',
                    'Content-Disposition': 'attachment; filename=speech.mp3'
                });
                res.end(audioBuffer);

            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ប្រព័ន្ធ API ដំណើរការជាធម្មតា!');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server កំពុងរត់នៅលើ Port: ${PORT}`);
});
