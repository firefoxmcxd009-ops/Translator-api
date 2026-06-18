const http = require('http');
const https = require('https');
const crypto = require('crypto');
const WebSocket = require('ws');

// មុខងារផ្គូផ្គង Voice សម្រាប់ Microsoft
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

// ម៉ាស៊ីនទី១៖ ទាញយកសំឡេងពី Microsoft Edge (WebSocket)
function getEdgeAudio(text, incomingVoiceID, incomingSpeed) {
    return new Promise((resolve, reject) => {
        const { voiceID, lang } = mapVoiceAndLang(incomingVoiceID);
        const rate = mapSpeed(incomingSpeed);
        const requestId = crypto.randomUUID().replace(/-/g, '');
        
        const ws = new WebSocket(
            `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/trusted/v1/aria/stream?TrustedClientToken=6A5AA1D4EAFF4E9B87E7EFD3C454C3EF&ConnectionId=${requestId}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
                }
            }
        );
        
        let audioBuffers = [];
        let isFinished = false;

        let timeout = setTimeout(() => {
            if (!isFinished) {
                isFinished = true;
                ws.terminate();
                reject(new Error("Microsoft Timeout"));
            }
        }, 6000);

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

// ម៉ាស៊ីនទី២ (ប្រព័ន្ធការពារជម្រើសទី២)៖ ទាញយកសំឡេងពី Google Translate TTS (ស្ថិរភាពខ្ពស់បំផុត ១០០%)
function getGoogleAudio(text, lang) {
    return new Promise((resolve, reject) => {
        const targetLang = lang === 'en-US' ? 'en' : 'km';
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${targetLang}&client=tw-ob&q=${encodeURIComponent(text)}`;
        
        https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        }, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Google TTS Error: ${res.statusCode}`));
            }
            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

// បង្កើត HTTP Server
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

                console.log(`[API] ទទួលបានអត្ថបទ: "${data.text.substring(0, 30)}..."`);
                let audioBuffer;

                try {
                    // ជំហានទី១៖ ព្យាយាមប្រើ Microsoft Edge
                    console.log("[TTS] កំពុងសាកល្បងប្រើម៉ាស៊ីន Microsoft Edge...");
                    audioBuffer = await getEdgeAudio(data.text, data.voiceID, data.voiceSpeed);
                    console.log("[Success] ទទួលបានសំឡេងពី Microsoft ជោគជ័យ!");
                } catch (msError) {
                    // ជំហានទី២៖ បើម៉ាស៊ីនទី១ ត្រូវ Microsoft block វានឹងរត់មកទីនេះភ្លាម
                    console.warn(`[Warning] Microsoft បានទប់ស្កាត់ IP របស់ Render (${msError.message})។`);
                    console.log("[Fallback] កំពុងប្តូរទៅប្រើម៉ាស៊ីន Google TTS ជំនួសវិញជាស្វ័យប្រវត្ត...");
                    
                    const { lang } = mapVoiceAndLang(data.voiceID);
                    audioBuffer = await getGoogleAudio(data.text, lang);
                    console.log("[Success] ទទួលបានសំឡេងពី Google ជំនួសវិញជោគជ័យ!");
                }

                res.writeHead(200, {
                    'Content-Type': 'audio/mpeg',
                    'Content-Length': audioBuffer.length
                });
                res.end(audioBuffer);
                console.log("[API] បានបញ្ជូនហ្វាយសំឡេងទៅ HTML រួចរាល់! 🎉\n");

            } catch (error) {
                console.error("[API Error] កំហុសធ្ងន់ធ្ងរ៖", error.message);
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
