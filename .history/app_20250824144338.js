const express = require('express');
const mongoose = require('mongoose');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/youtube_downloader', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
    console.log('MongoDB connected successfully');
});

// Download Schema
const downloadSchema = new mongoose.Schema({
    title: { type: String, required: true },
    url: { type: String, required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, enum: ['audio', 'video'], required: true },
    downloadDate: { type: Date, default: Date.now },
    filePath: { type: String, required: true },
    fileSize: { type: Number },
    duration: { type: String },
    thumbnail: { type: String }
});

const Download = mongoose.model('Download', downloadSchema);

// Create downloads directory
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// Routes

// Homepage
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>YouTube Downloader</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }
            h1 {
                text-align: center;
                color: #333;
                margin-bottom: 30px;
            }
            .form-group {
                margin-bottom: 20px;
            }
            label {
                display: block;
                margin-bottom: 5px;
                font-weight: bold;
                color: #555;
            }
            input[type="url"] {
                width: 100%;
                padding: 12px;
                border: 2px solid #ddd;
                border-radius: 5px;
                font-size: 16px;
                box-sizing: border-box;
            }
            .radio-group {
                display: flex;
                gap: 20px;
                margin: 10px 0;
            }
            .radio-item {
                display: flex;
                align-items: center;
                gap: 5px;
            }
            button {
                background: linear-gradient(45deg, #667eea, #764ba2);
                color: white;
                padding: 12px 30px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
                width: 100%;
                transition: transform 0.2s;
            }
            button:hover {
                transform: translateY(-2px);
            }
            .downloads-section {
                margin-top: 40px;
                padding-top: 30px;
                border-top: 2px solid #eee;
            }
            .download-item {
                background: #f8f9fa;
                padding: 15px;
                margin: 10px 0;
                border-radius: 5px;
                border-left: 4px solid #667eea;
            }
            .download-title {
                font-weight: bold;
                margin-bottom: 5px;
            }
            .download-info {
                font-size: 12px;
                color: #666;
            }
            .status {
                padding: 10px;
                margin: 10px 0;
                border-radius: 5px;
                display: none;
            }
            .status.success {
                background: #d4edda;
                color: #155724;
                border: 1px solid #c3e6cb;
            }
            .status.error {
                background: #f8d7da;
                color: #721c24;
                border: 1px solid #f5c6cb;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎵 YouTube Downloader</h1>
            
            <form id="downloadForm">
                <div class="form-group">
                    <label for="url">YouTube URL:</label>
                    <input type="url" id="url" name="url" required 
                           placeholder="https://www.youtube.com/watch?v=...">
                </div>
                
                <div class="form-group">
                    <label>Download Type:</label>
                    <div class="radio-group">
                        <div class="radio-item">
                            <input type="radio" id="audio" name="type" value="audio" checked>
                            <label for="audio">Audio Only (MP3)</label>
                        </div>
                        <div class="radio-item">
                            <input type="radio" id="video" name="type" value="video">
                            <label for="video">Video (MP4)</label>
                        </div>
                    </div>
                </div>
                
                <button type="submit">Download</button>
            </form>
            
            <div id="status" class="status"></div>
            
            <div class="downloads-section">
                <h2>📁 Downloaded Files</h2>
                <div id="downloadsList">
                    <p>Loading...</p>
                </div>
            </div>
        </div>

        <script>
            // Load downloads on page load
            window.onload = loadDownloads;

            // Handle form submission
            document.getElementById('downloadForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const url = document.getElementById('url').value;
                const type = document.querySelector('input[name="type"]:checked').value;
                const statusDiv = document.getElementById('status');
                
                statusDiv.style.display = 'block';
                statusDiv.className = 'status';
                statusDiv.textContent = 'Downloading... Please wait';
                
                try {
                    const response = await fetch('/download', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ url, type }),
                    });
                    
                    const result = await response.json();
                    
                    if (response.ok) {
                        statusDiv.className = 'status success';
                        statusDiv.textContent = result.message;
                        document.getElementById('url').value = '';
                        loadDownloads(); // Refresh the list
                    } else {
                        statusDiv.className = 'status error';
                        statusDiv.textContent = result.error;
                    }
                } catch (error) {
                    statusDiv.className = 'status error';
                    statusDiv.textContent = 'Network error: ' + error.message;
                }
            });

            // Load downloads list
            async function loadDownloads() {
                try {
                    const response = await fetch('/downloads');
                    const downloads = await response.json();
                    
                    const listDiv = document.getElementById('downloadsList');
                    
                    if (downloads.length === 0) {
                        listDiv.innerHTML = '<p>No downloads yet.</p>';
                        return;
                    }
                    
                    listDiv.innerHTML = downloads.map(download => 
                        \`<div class="download-item">
                            <div class="download-title">\${download.title}</div>
                            <div class="download-info">
                                Type: \${download.fileType.toUpperCase()} | 
                                Size: \${formatFileSize(download.fileSize)} | 
                                Date: \${new Date(download.downloadDate).toLocaleString()}
                                \${download.duration ? ' | Duration: ' + download.duration : ''}
                            </div>
                        </div>\`
                    ).join('');
                } catch (error) {
                    document.getElementById('downloadsList').innerHTML = 
                        '<p style="color: red;">Error loading downloads</p>';
                }
            }

            function formatFileSize(bytes) {
                if (!bytes) return 'Unknown';
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(1024));
                return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
            }
        </script>
    </body>
    </html>
    `);
});

// Download endpoint
app.post('/download', async (req, res) => {
    try {
        const { url, type } = req.body;

        // Validate YouTube URL
        if (!ytdl.validateURL(url)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        // Get video info
        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title.replace(/[^\w\s-]/g, '').trim();
        const duration = info.videoDetails.lengthSeconds;
        const thumbnail = info.videoDetails.thumbnails[0]?.url;

        // Format duration
        const formatDuration = (seconds) => {
            const hrs = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` 
                          : `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        // Set file extension and format
        const fileExt = type === 'audio' ? 'mp3' : 'mp4';
        const fileName = `${title}_${Date.now()}.${fileExt}`;
        const filePath = path.join(downloadsDir, fileName);

        // Download options
        const options = type === 'audio' 
            ? { quality: 'highestaudio', filter: 'audioonly' }
            : { quality: 'highest', filter: 'videoandaudio' };

        // Start download
        const stream = ytdl(url, options);
        const writeStream = fs.createWriteStream(filePath);

        stream.pipe(writeStream);

        // Handle download completion
        writeStream.on('finish', async () => {
            try {
                // Get file size
                const stats = fs.statSync(filePath);
                
                // Save to database
                const download = new Download({
                    title: info.videoDetails.title,
                    url: url,
                    fileName: fileName,
                    fileType: type,
                    filePath: filePath,
                    fileSize: stats.size,
                    duration: formatDuration(duration),
                    thumbnail: thumbnail
                });

                await download.save();

                res.json({
                    success: true,
                    message: `${type === 'audio' ? 'Audio' : 'Video'} downloaded successfully!`,
                    fileName: fileName,
                    title: info.videoDetails.title
                });
            } catch (error) {
                console.error('Database save error:', error);
                res.status(500).json({ error: 'Download completed but database save failed' });
            }
        });

        // Handle download errors
        stream.on('error', (error) => {
            console.error('Download error:', error);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath); // Clean up partial file
            }
            res.status(500).json({ error: 'Download failed: ' + error.message });
        });

        writeStream.on('error', (error) => {
            console.error('Write error:', error);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath); // Clean up partial file
            }
            res.status(500).json({ error: 'File write failed: ' + error.message });
        });

    } catch (error) {
        console.error('General error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// Get all downloads
app.get('/downloads', async (req, res) => {
    try {
        const downloads = await Download.find({})
            .sort({ downloadDate: -1 })
            .select('-filePath'); // Don't send file paths for security
        
        res.json(downloads);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get download by ID
app.get('/download/:id', async (req, res) => {
    try {
        const download = await Download.findById(req.params.id);
        if (!download) {
            return res.status(404).json({ error: 'Download not found' });
        }
        res.json(download);
    } catch (error) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete download
app.delete('/download/:id', async (req, res) => {
    try {
        const download = await Download.findById(req.params.id);
        if (!download) {
            return res.status(404).json({ error: 'Download not found' });
        }

        // Delete file from disk
        if (fs.existsSync(download.filePath)) {
            fs.unlinkSync(download.filePath);
        }

        // Delete from database
        await Download.findByIdAndDelete(req.params.id);
        
        res.json({ success: true, message: 'Download deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Delete failed' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error(error.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 YouTube Downloader Server running on http://localhost:${PORT}`);
    console.log(`📁 Downloads will be saved to: ${downloadsDir}`);
    console.log(`🗄️  MongoDB connection: mongodb://localhost:27017/youtube_downloader\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    await mongoose.connection.close();
    process.exit(0);
});