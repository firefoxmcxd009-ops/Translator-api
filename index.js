const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Middleware
app.use(cors());
app.use(express.json());

// Root endpoint ដើម្បីដឹងថា Server កំពុងដំណើរការ
app.get('/', (req, res) => {
    res.send('Translator API is running!');
});

// Endpoint: បកប្រែអត្ថបទធម្មតា (POST /api/translate)
app.post('/api/translate', async (req, res) => {
    const { text, target } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });

    try {
        const response = await axios.post('https://translate.argosopentech.com/translate', {
            q: text,
            source: 'auto',
            target: target || 'en',
            format: 'text'
        });
        res.json({ result: response.data.translatedText });
    } catch (err) {
        res.status(500).json({ error: "Translation failed" });
    }
});

// Endpoint: បកប្រែឯកសារ (POST /api/translate-file)
app.post('/api/translate-file', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file provided" });

        const text = fs.readFileSync(req.file.path, 'utf8');
        const response = await axios.post('https://translate.argosopentech.com/translate', {
            q: text,
            target: req.body.target || 'en',
            format: 'text'
        });

        // លុបឯកសារចោលក្រោយពីបកប្រែរួចដើម្បីសន្សំទំហំ
        fs.unlinkSync(req.file.path);
        res.json({ result: response.data.translatedText });
    } catch (err) {
        res.status(500).json({ error: "File processing failed" });
    }
});

// កំណត់ Port ឱ្យស្របតាម Render (ឬ 3000 សម្រាប់ Local)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
