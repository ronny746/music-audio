const express = require('express');
const mongoose = require('mongoose');
const play = require('play-dl');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// MongoDB Connection
mongoose.set('strictQuery', true);
mongoose
  .connect('mongodb://127.0.0.1:27017/youtube_downloader', {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => console.log('MongoDB connected successfully'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
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
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Homepage (static HTML served inline)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) {
      res.status(500).send('Failed to load UI');
    }
  });
});

// Download endpoint using play-dl
app.post('/download', async (req, res) => {
  try {
    const { url, type } = req.body;
    if (!url || !type) return res.status(400).json({ error: 'Missing url or type' });

    // Validate YouTube URL (play-dl helper)
    if (!play.yt_validate(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Get video info
    const ytInfo = await play.video_info(url);
    const vd = ytInfo.video_details || {};
    const rawTitle = (vd.title || 'video').toString();
    const title = rawTitle.replace(/[^\w\s-]/g, '').trim() || 'video';
    const durationSec = vd.durationInSec || vd.duration || 0;
    const durationRaw = vd.durationRaw || null;
    const thumbnail = vd.thumbnails && vd.thumbnails[0] ? vd.thumbnails[0].url : null;

    const fileExt = type === 'audio' ? 'mp3' : 'mp4';
    const fileName = `${title}_${Date.now()}.${fileExt}`;
    const filePath = path.join(downloadsDir, fileName);

    // Prepare stream
    const quality = type === 'audio' ? 1 : 2; // play-dl quality hint
    const streamInfo = await play.stream(url, { quality });
    const stream = streamInfo.stream;

    // Pipe stream -> file
    const writeStream = fs.createWriteStream(filePath);

    // Errors from upstream stream
    let streamErrored = false;
    stream.on('error', (err) => {
      streamErrored = true;
      console.error('Stream error:', err);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      if (!res.headersSent) res.status(500).json({ error: 'Stream error: ' + err.message });
    });

    writeStream.on('error', (err) => {
      console.error('Write error:', err);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      if (!res.headersSent) res.status(500).json({ error: 'File write failed: ' + err.message });
    });

    writeStream.on('finish', async () => {
      if (streamErrored) return;
      try {
        const stats = fs.statSync(filePath);
        const download = new Download({
          title: rawTitle,
          url,
          fileName,
          fileType: type,
          filePath,
          fileSize: stats.size,
          duration: durationRaw || secondsToHms(durationSec),
          thumbnail
        });
        await download.save();

        if (!res.headersSent) {
          res.json({
            success: true,
            message: `${type === 'audio' ? 'Audio' : 'Video'} downloaded successfully!`,
            fileName,
            title: rawTitle
          });
        }
      } catch (err) {
        console.error('DB save error:', err);
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
        if (!res.headersSent) res.status(500).json({ error: 'Download complete but DB save failed' });
      }
    });

    // Start piping
    stream.pipe(writeStream);

  } catch (err) {
    console.error('General error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// Helpers
function secondsToHms(seconds) {
  seconds = Number(seconds) || 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// Get all downloads
app.get('/downloads', async (req, res) => {
  try {
    const downloads = await Download.find({}).sort({ downloadDate: -1 }).select('-filePath');
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
    if (!download) return res.status(404).json({ error: 'Download not found' });
    res.json(download);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete download (file + db)
app.delete('/download/:id', async (req, res) => {
  try {
    const download = await Download.findById(req.params.id);
    if (!download) return res.status(404).json({ error: 'Download not found' });

    if (fs.existsSync(download.filePath)) {
      fs.unlinkSync(download.filePath);
    }

    await Download.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Download deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error(error.stack);
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 YouTube Downloader Server running on http://localhost:${PORT}`);
  console.log(`📁 Downloads will be saved to: ${downloadsDir}`);
  console.log(`🗄️  MongoDB connection: mongodb://127.0.0.1:27017/youtube_downloader\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  try { await mongoose.connection.close(); } catch (_) {}
  process.exit(0);
});
