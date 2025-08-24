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
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// Download Schema + Model
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

// Homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Download endpoint
app.post('/download', async (req, res) => {
  try {
    const { url, type } = req.body;
    if (!url || !type) {
      return res.status(400).json({ error: 'Missing url or type' });
    }

    console.log('REQUEST /download url=', url, 'type=', type);

    // Get video info
    let ytInfo;
    try {
      ytInfo = await play.video_info(url);
    } catch (err) {
      console.error('video_info error:', err.message);
      return res.status(400).json({ error: 'Unable to fetch video info. Check URL.' });
    }

    const vd = ytInfo.video_details;
    const rawTitle = vd.title || 'video';
    const title = rawTitle.replace(/[^\w\s-]/g, '').trim() || 'video';
    const durationSec = vd.durationInSec || 0;
    const durationRaw = vd.durationRaw || null;
    const thumbnail = vd.thumbnails?.[0]?.url || null;

    const fileExt = type === 'audio' ? 'mp3' : 'mp4';
    const fileName = `${title}_${Date.now()}.${fileExt}`;
    const filePath = path.join(downloadsDir, fileName);

    // Stream
    let streamInfo;
    try {
      streamInfo = await play.stream(url, { quality: type === 'audio' ? 1 : 2 });
    } catch (err) {
      console.warn('play.stream failed, trying stream_from_info:', err.message);
      try {
        streamInfo = await play.stream_from_info(ytInfo);
      } catch (fromInfoErr) {
        console.error('Both stream attempts failed:', fromInfoErr.message);
        return res.status(500).json({ error: 'Failed to get media stream' });
      }
    }

    const stream = streamInfo.stream || streamInfo;
    if (!stream) {
      return res.status(500).json({ error: 'Invalid stream' });
    }

    // Pipe stream to file
    const writeStream = fs.createWriteStream(filePath);
    stream.pipe(writeStream);

    writeStream.on('finish', async () => {
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

        res.json({
          success: true,
          message: `${type} downloaded successfully`,
          fileName,
          title: rawTitle
        });
      } catch (dbErr) {
        console.error('DB save error:', dbErr);
        res.status(500).json({ error: 'Download complete but DB save failed' });
      }
    });

    writeStream.on('error', (err) => {
      console.error('Write error:', err);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.status(500).json({ error: 'File write failed' });
    });
  } catch (err) {
    console.error('General error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
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

// Routes for DB
app.get('/downloads', async (req, res) => {
  const downloads = await Download.find({}).sort({ downloadDate: -1 }).select('-filePath');
  res.json(downloads);
});

app.get('/download/:id', async (req, res) => {
  const download = await Download.findById(req.params.id);
  if (!download) return res.status(404).json({ error: 'Download not found' });
  res.json(download);
});

app.delete('/download/:id', async (req, res) => {
  const download = await Download.findById(req.params.id);
  if (!download) return res.status(404).json({ error: 'Download not found' });

  if (fs.existsSync(download.filePath)) {
    fs.unlinkSync(download.filePath);
  }

  await Download.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Download deleted successfully' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
  console.log(`📂 Downloads dir: ${downloadsDir}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await mongoose.connection.close();
  process.exit(0);
});
