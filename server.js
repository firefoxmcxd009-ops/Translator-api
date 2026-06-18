const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves our frontend HTML

// Configure Multer for temporary file storage
const upload = multer({ dest: 'uploads/' });

// Helper function to simulate a transcription delay (Replace with actual STT logic)
const mockTranscriptionWorkaround = async (filePathOrUrl) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve("This is a simulated transcript. In a real production environment, this is where you would pass the file to Whisper API, Google Cloud Speech, or a local Vosk instance.");
        }, 3000);
    });
};

/**
 * POST /api/transcribe
 * Accepts 'audioFile' (multipart/form-data) OR 'url' (JSON)
 */
app.post('/api/transcribe', upload.single('audioFile'), async (req, res) => {
    try {
        const file = req.file;
        const { url } = req.body;

        if (!file && !url) {
            return res.status(400).json({ error: "Please provide a file or a valid URL." });
        }

        let target = file ? file.path : url;
        
        // Process the transcription (Workaround)
        const transcript = await mockTranscriptionWorkaround(target);

        // Cleanup uploaded file to prevent server storage bloat
        if (file) {
            fs.unlinkSync(file.path);
        }

        res.json({ success: true, text: transcript });

    } catch (error) {
        console.error("Transcription error:", error);
        res.status(500).json({ error: "Failed to process the transcription." });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running smoothly on port ${PORT}`);
});
