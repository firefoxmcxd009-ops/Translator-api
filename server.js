const http = require('http');
const https = require('https');
const crypto = require('crypto');

// មុខងារវៃឆ្លាត៖ ផ្គូផ្គង Voice ID ពី HTML ចាស់ ទៅកាន់សំឡេង AI ពិតរបស់ Microsoft
function mapVoiceAndLang(incomingVoiceID) {
    let voiceID = 'km-KH-SreymomNeural'; // លំនាំដើម សំឡេងស្រីមុំ
    let lang = 'km-KH';

    if (incomingVoiceID) {
        const v = incomingVoiceID.toLowerCase();
        if (v.includes('piseth')) {
            voiceID = 'km-KH-PisethNeural';
            lang = 'km-KH';
        } else if (v.includes('km') || v.includes('khmer')) {
            voiceID = 'km-KH-SreymomNeural';
            lang = 'km-KH';
        } else if (v.includes('en')) {
            voiceID = 'en-US-AvaNeural'; // សំឡេងអង់គ្លេស AI ពិរោះ
            lang = 'en-US';
        } else {
            // បើផ្ញើមកត្រូវទម្រង់ស្រាប់
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

function getEdgeAudio(text, incomingVoiceID, incomingSpeed) {
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID().replace(/-/g, '');
        const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/trusted/v1/aria/stream?Ocp-Apim-Subscription-Key=6A5AA1D4EAFF4E9B87E7EFD3C454C3EF&X-ConnectionId=${requestId}`;
        
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-24khz-48kbps-mono-mp3',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
            }
        }, (res) => {
            let chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(Buffer.concat(chunks));
                } else {
                    reject(new Error('Microsoft Server Error: ' + res.statusCode));
                }
            });
        });

        req.on('error', (err) => reject(err));

        // ចាប់ផ្តើមបំប្លែងទិន្នន័យឱ្យត្រូវស្តង់ដារ Microsoft 
        const { voiceID, lang } = mapVoiceAndLang(incomingVoiceID);
        const rate = mapSpeed(incomingSpeed);
        
        // កែសម្រួលទម្រង់ SSML ឱ្យត្រឹមត្រូវតាមបច្ចេកទេស (លែងលោត 400 ទៀតហើយ)
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voiceID}'><prosody rate='${rate}'>${text}</prosody></voice></speak>`;
        
        req.write(ssml);
        req.end();
    });
}

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

                // ផ្ញើទាំង text, voiceID, និង voiceSpeed ទៅដំណើរការ
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
        res.end('ប្រព័ន្ធ TTS កំពុងដំណើរការជាធម្មតា!');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server កំពុងរត់នៅលើ Port: ${PORT}`);
});
