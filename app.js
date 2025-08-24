const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.set('strictQuery', true);
mongoose
  .connect('mongodb://127.0.0.1:27017/youtube_downloader', {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Download Schema
const downloadSchema = new mongoose.Schema({
  title: String,
  url: String,
  fileName: String,
  fileType: { type: String, enum: ['audio', 'video'] },
  downloadDate: { type: Date, default: Date.now },
  filePath: String,
  fileSize: Number
});

const Download = mongoose.model('Download', downloadSchema);

// Create downloads dir
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
app.use('/downloads', express.static(DOWNLOAD_DIR));

/**
 * DOWNLOAD endpoint (yt-dlp)
 */
app.post('/download', async (req, res) => {
  const { url, type } = req.body;
  console.log('Received URL:', url);

  if (!url || !type) return res.status(400).json({ error: 'url and type required' });

  try {
    const ext = type === 'audio' ? 'mp3' : 'mp4';
    const filename = `video_${Date.now()}.${ext}`;
    const filepath = path.join(DOWNLOAD_DIR, filename);

    // yt-dlp command
    const cmd =
      type === 'audio'
        ? `yt-dlp -x --audio-format mp3 -o "${filepath}" "${url}"`
        : `yt-dlp -f best -o "${filepath}" "${url}"`;

    exec(cmd, async (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp error:', stderr);
        return res.status(500).json({ error: 'Download failed', details: stderr });
      }

      try {
        const stats = fs.statSync(filepath);

        const newDownload = new Download({
          title: filename,
          url,
          fileName: filename,
          fileType: type,
          filePath: filepath,
          fileSize: stats.size
        });

        await newDownload.save();

        res.json({
          message: `${type} downloaded successfully`,
          link: `http://localhost:${PORT}/downloads/${filename}`
        });
      } catch (dbErr) {
        console.error('DB save error:', dbErr);
        res.status(500).json({ error: 'File saved but DB insert failed' });
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Download failed', details: err.message });
  }
});

// Get all downloads
app.get('/downloads-list', async (req, res) => {
  try {
    const downloads = await Download.find({}).sort({ downloadDate: -1 });
    res.json(downloads);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📂 Downloads folder: ${DOWNLOAD_DIR}`);
});
