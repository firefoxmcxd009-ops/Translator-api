const WebSocket = require('ws');

// មុខងារបង្កើត Request ID ក្លែងការណ៍
function generateRequestId() {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, () => (Math.random() * 16 | 0).toString(16));
}

module.exports = async (req, res) => {
    // បើកសិទ្ធិ CORS ឱ្យ HTML ក្រៅហៅចូលបាន
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(200).send('Edge TTS Serverless API runs perfectly!');
    }
    
    try {
        const { text, voiceID } = req.body;
        const voice = voiceID || 'km-KH-SreymomNeural';
        
        if (!text) {
            return res.status(400).json({ error: 'សូមបញ្ចូលអត្ថបទ' });
        }
        
        const reqId = generateRequestId();
        const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9B87E7B3D284414B3A&ConnectionId=${reqId}`;
        
        const ws = new WebSocket(url, {
            headers: {
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
                'Origin': 'chrome-extension://jdiccjclmhkunfdbjkobmpejfgedjlhf'
            }
        });
        
        let audioBuffer = Buffer.alloc(0);
        
        ws.on('open', () => {
            const configMsg = `X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"system":{"name":"SpeechSDK","version":"1.30.0","build":"JavaScript","lang":"JavaScript"},"os":{"platform":"Browser","name":"Chrome","version":"130.0.0.0"}}}`;
            ws.send(configMsg);
            
            const ssmlMsg = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toString()}\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='km-KH'><voice name='${voice}'><prosody rate='0%' pitch='0%'>${text}</prosody></voice></speak>`;
            ws.send(ssmlMsg);
        });
        
        await new Promise((resolve, reject) => {
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    const headerLen = data.readUInt16BE(0);
                    const audioChunk = data.slice(2 + headerLen);
                    audioBuffer = Buffer.concat([audioBuffer, audioChunk]);
                } else {
                    if (data.toString().includes('turn.end')) {
                        ws.close();
                        resolve();
                    }
                }
            });
            ws.on('error', (err) => reject(err));
            ws.on('close', () => resolve());
            setTimeout(() => { ws.close();
                resolve(); }, 8000); // ទប់ស្កាត់ការគាំង Timeout
        });
        
        if (audioBuffer.length === 0) {
            return res.status(401).json({ error: "Microsoft ទាត់ចោល (401) - IP របស់ Vercel អាចនឹងជាប់ប្លុកដែរហើយ" });
        }
        
        // បោះហ្វាយសំឡេងទៅឱ្យ Frontend វិញ
        res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.length
        });
        res.end(audioBuffer);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};