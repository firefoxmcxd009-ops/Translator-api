const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

// មុខងារផ្គូផ្គង Voice ID ពី HTML ចាស់ ទៅកាន់សំឡេង AI ពិតរបស់ Microsoft
function mapVoiceAndLang(incomingVoiceID) {
    let voiceID = 'km-KH-SreymomNeural'; // លំនាំដើម សំឡេងស្រីមុំ
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

// មុខងារបំប្លែងល្បឿនសំឡេងពី HTML
function mapSpeed(voiceSpeed) {
    if (!voiceSpeed) return '+0%';
    const speed = parseInt(voiceSpeed);
    if (speed === 1) return '+20%';
    if (speed === 2) return '+40%';
    if (speed === -1) return '-20%';
    if (speed === -2) return '-40%';
    return '+0%';
}

// មុខងារស្នូល៖ ទាញយកសំឡេងតាមរយៈ WebSocket (វិធីសាស្ត្រផ្លូវការ)
function getEdgeAudio(text, incomingVoiceID, incomingSpeed) {
    return new Promise((resolve, reject) => {
        const { voiceID, lang } = mapVoiceAndLang(incomingVoiceID);
        const rate = mapSpeed(incomingSpeed);
        const requestId = crypto.randomUUID().replace(/-/g, '');
        
        // បើកការតភ្ជាប់ WebSocket ទៅកាន់ Microsoft Server
        const ws = new WebSocket(`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/trusted/v1/aria/stream?TrustedClientToken=6A5AA1D4EAFF4E9B87E7EFD3C454C3EF&X-ConnectionId=${requestId}`);
        
        let audioBuffers = [];
        let timeout = setTimeout(() => {
            ws.terminate();
            reject(new Error("អស់រយៈពេលរង់ចាំ (Timeout)"));
        }, 20000);

        ws.on('open', () => {
            // ១. ផ្ញើការកំណត់ទម្រង់ហ្វាយអូឌីយ៉ូ (Audio Format)
            const configMsg = `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbps-mono-mp3"}}}}`;
            ws.send(configMsg);

            // ២. ផ្ញើអត្ថបទ និងទម្រង់ SSML ទៅបំប្លែង
            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voiceID}'><prosody rate='${rate}'>${text}</prosody></voice></speak>`;
            const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
            ws.send(ssmlMsg);
        });

        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                // ប្រសិនបើជាទិន្នន័យសំឡេង (Binary) ត្រូវកាត់ក្បាល Header ចេញដើម្បីយកសាច់ MP3 សុទ្ធ
                const headerLength = data.readUInt16BE(0);
                const audioChunk = data.slice(2 + headerLength);
                audioBuffers.push(audioChunk);
            } else {
                // ប្រសិនបើឃើញពាក្យ turn.end មានន័យថា Microsoft បញ្ចប់ការនិយាយហើយ
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

// បង្កើត HTTP Server សម្រាប់ឱ្យ HTML ហៅមកប្រើ
const server = http.createServer(async (req, res) => {
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

                // ដំណើរការបង្កើតសំឡេងតាម WebSocket
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
        res.end('ប្រព័ន្ធ WebSocket TTS ដំណើរការជាធម្មតា!');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server កំពុងរត់នៅលើ Port: ${PORT}`);
});
