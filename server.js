const http = require('http');
const https = require('https');
const crypto = require('crypto');

// មុខងារវៃឆ្លាត៖ ទាញយកកូដភាសា (Language Code) ចេញពី Voice ID ដោយស្វ័យប្រវត្ត
function getLangFromVoice(voiceID) {
    if (!voiceID) return 'km-KH';
    const parts = voiceID.split('-');
    if (parts.length >= 2) {
        return `${parts[0]}-${parts[1]}`; // ឧទាហរណ៍៖ km-KH ឬ en-US
    }
    return 'km-KH';
}

function getEdgeAudio(text, voiceID = 'km-KH-SreymomNeural') {
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
                    reject(new Error('ស្ថានភាពកំហុសពី Server: ' + res.statusCode));
                }
            });
        });

        req.on('error', (err) => reject(err));

        // កំណត់ភាសាឱ្យរត់ឌីណាមិកតាម Voice ID ការពារកុំឱ្យលោត Error 400
        const lang = getLangFromVoice(voiceID);
        
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voiceID}'><pitch value='+0Hz'><rate value='+0%'/>${text}</voice></speak>`;
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

                const audioBuffer = await getEdgeAudio(data.text, data.voiceID);
                
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
