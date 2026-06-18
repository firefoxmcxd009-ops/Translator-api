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
        } else if (v.includes('en') || v.includes('us') || v.includes('ava')) {
            voiceID = 'en-US-AvaNeural';
            lang = 'en-US';
        } else if (incomingVoiceID.includes('-')) {
            voiceID = incomingVoiceID;
            const parts = incomingVoiceID.split('-');
            lang = `${parts[0]}-${parts[1]}`;
        }
    }
    return { voiceID, lang };
}

// មុខងារវៃឆ្លាត៖ បំប្លែងល្បឿនសំឡេងឱ្យត្រូវគ្រប់ស្ថានភាព HTML ចាស់
function mapSpeed(voiceSpeed) {
    if (!voiceSpeed) return '+0%';
    if (typeof voiceSpeed === 'string' && voiceSpeed.includes('%')) return voiceSpeed;
    
    const speed = parseFloat(voiceSpeed);
    if (isNaN(speed)) return '+0%';
    
    // បើ HTML ផ្ញើមកជាកម្រិតគុណ (ឧទាហរណ៍៖ 0.5 ដល់ 2)
    if (speed >= 0.5 && speed <= 3) {
        const pct = Math.round((speed - 1) * 100);
        return pct >= 0 ? `+${pct}%` : `${pct}%`;
    }
    
    // បើ HTML ផ្ញើមកជាលេខរៀងចាស់ (-2, -1, 1, 2)
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
        
        console.log(`[TTS] កំពុងរៀបចំសំឡេង: Voice=${voiceID}, Rate=${rate}, Text="${text.substring(0, 20)}..."`);

        const ws = new WebSocket(
            `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/trusted/v1/aria/stream?TrustedClientToken=6A5AA1D4EAFF4E9B87E7EFD3C454C3EF&X-ConnectionId=${requestId}`,
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
        let isFinished = false;

        let timeout = setTimeout(() => {
            if (!isFinished) {
                isFinished = true;
                ws.terminate();
                reject(new Error("អស់រយៈពេលរង់ចាំពី Microsoft Server (Timeout)"));
            }
        }, 15000);

        ws.on('open', () => {
            console.log("[MS WebSocket] បានភ្ជាប់ទៅកាន់ Microsoft Server ជោគជ័យ។");
            const now = Date.now();
            
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
                    if (audioChunk.length > 0) {
                        audioBuffers.push(audioChunk);
                    }
                } catch (e) {
                    console.error("[Error] បញ្ហាអានទិន្នន័យអូឌីយ៉ូ:", e.message);
                }
            } else {
                const responseText = data.toString();
                // បើ Microsoft និយាយចប់
                if (responseText.includes("Path:turn.end")) {
                    isFinished = true;
                    clearTimeout(timeout);
                    ws.close();
                    console.log(`[Success] បង្កើតសំឡេងជោគជ័យ! ទទួលបានទំហំទិន្នន័យ: ${audioBuffers.length} Chunks`);
                    resolve(Buffer.concat(audioBuffers));
                }
            }
        });

        ws.on('error', (err) => {
            console.error("[MS WebSocket Error] មានបញ្ហាភ្ជាប់:", err.message);
            if (!isFinished) {
                isFinished = true;
                clearTimeout(timeout);
                reject(err);
            }
        });

        ws.on('close', (code, reason) => {
            if (!isFinished) {
                isFinished = true;
                clearTimeout(timeout);
                console.log(`[MS WebSocket Closed] ដាច់ការតភ្ជាប់មុនពេលនិយាយចប់! Code: ${code}, មូលហេតុ: ${reason}`);
                reject(new Error(`Microsoft បានផ្តាច់ការតភ្ជាប់មុនពេលបង្កើតសំឡេងចប់ (Code: ${code})`));
            }
        });
    });
}

const server = http.createServer(async (req, res) => {
    // កំណត់ CORS កម្រិតខ្ពស់ ការពារ Browser ទប់ស្កាត់ (Block) ទិន្នន័យ
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
                console.log("[API] ទទួលបានសំណើថ្មីពី HTML...");
                const data = JSON.parse(body);
                
                if (!data.text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'សូមបញ្ចូលអត្ថបទ' }));
                }

                const audioBuffer = await getEdgeAudio(data.text, data.voiceID, data.voiceSpeed);
                
                if (audioBuffer.length === 0) {
                    throw new Error("ទិន្នន័យសំឡេងដែលទទួលបានពី Microsoft គឺទទេស្អាត (Empty Audio)");
                }

                res.writeHead(200, {
                    'Content-Type': 'audio/mpeg',
                    'Content-Disposition': 'attachment; filename=speech.mp3',
                    'Content-Length': audioBuffer.length
                });
                res.end(audioBuffer);
                console.log("[API] បានផ្ញើហ្វាយសំឡេង MP3 ទៅកាន់ HTML វិញរួចរាល់!\n");

            } catch (error) {
                console.error("[API Error] មូលហេតុកំហុសគឺ:", error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ប្រព័ន្ធ API ដំណើរការជាធម្មតា!');
    }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server កំពុងរត់នៅលើ Port: ${PORT}`);
});
