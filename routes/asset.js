const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const authJs = require('../middlewares/auth');
const Asset = require('../models/asset');
const Lecture = require('../models/lecture');
const Busboy = require('busboy');
const archiver = require('archiver');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Upload assets to Cloudinary
router.post('/upload', authJs, async (req, res) => {
  const { lectureId } = req.query;
  let zipName = '';
  if (!lectureId) {
    return res.status(400).json({ message: 'lectureId is required as a query parameter' });
  }

  const files = [];
  const busboy = Busboy({ headers: req.headers });
  let hasFile = false;
  let errorOccurred = false;

  busboy.on('field', (fieldname, val) => {
    if (fieldname === 'zipName') {
      zipName = val;
    }
  });

  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
    hasFile = true;
    const fileChunks = [];
    file.on('data', (data) => fileChunks.push(data));
    file.on('end', () => {
      let realFilename = filename;
      if (filename && typeof filename === 'object' && filename.filename) {
        realFilename = filename.filename;
      }
      files.push({
        buffer: Buffer.concat(fileChunks),
        filename: realFilename,
        mimetype: mimetype || 'application/octet-stream',
        originalname: realFilename
      });
    });
  });

  busboy.on('finish', async () => {
    if (errorOccurred) {
      return res.status(500).json({ message: 'One or more files failed to upload.' });
    }
    if (!hasFile) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    try {
      if (files.length === 1) {
        // Single file upload
        const file = files[0];
        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { 
              resource_type: 'auto',
              folder: `lectures/${lectureId}`,
              public_id: file.filename.split('.')[0]
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );

          const bufferStream = new Readable();
          bufferStream.push(file.buffer);
          bufferStream.push(null);
          bufferStream.pipe(uploadStream);
        });

        const asset = new Asset({
          name: file.filename,
          mimeType: file.mimetype,
          url: result.secure_url,
          publicId: result.public_id,
          format: result.format,
          uploadedBy: req.decoded.userId,
          lectureId: lectureId
        });
        await asset.save();
        res.json(asset);
      } else {
        // Multiple files: create a zip archive
        if (!zipName) {
          return res.status(400).json({ message: 'zipName is required as a form field' });
        }

        const archive = archiver('zip', { zlib: { level: 9 } });
        const chunks = [];
        
        archive.on('data', (chunk) => chunks.push(chunk));
        archive.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            const result = await new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  resource_type: 'raw',
                  folder: `lectures/${lectureId}`,
                  public_id: zipName.endsWith('.zip') ? zipName.replace('.zip', '') : zipName
                },
                (error, result) => {
                  if (error) reject(error);
                  else resolve(result);
                }
              );

              const bufferStream = new Readable();
              bufferStream.push(buffer);
              bufferStream.push(null);
              bufferStream.pipe(uploadStream);
            });

            const asset = new Asset({
              name: zipName.endsWith('.zip') ? zipName : zipName + '.zip',
              mimeType: 'application/zip',
              url: result.secure_url,
              publicId: result.public_id,
              format: 'zip',
              uploadedBy: req.decoded.userId,
              lectureId: lectureId
            });
            await asset.save();
            res.json(asset);
          } catch (error) {
            console.error('Zip upload failed:', error);
            res.status(500).json({ message: 'Zip upload failed', error: error.message });
          }
        });

        for (const f of files) {
          if (typeof f.filename === 'string' && f.filename.trim() !== '') {
            archive.append(f.buffer, { name: f.filename });
          } else {
            console.warn('Skipping file with invalid filename:', f);
          }
        }

        archive.finalize();
      }
    } catch (error) {
      console.error('Upload failed:', error);
      res.status(500).json({ message: 'Upload failed', error: error.message });
    }
  });

  busboy.on('error', (err) => {
    console.error('Busboy error:', err);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  });

  req.pipe(busboy);
});

// List assets (auth required, filtered by user's enrolled lectures)
router.get('/list', authJs, async (req, res) => {
  try {
    const lectures = await Lecture.find({ studentsEnrolled: req.decoded.userId }).select('_id');
    const lectureIds = lectures.map(l => l._id);
    const assets = await Asset.find({ lectureId: { $in: lectureIds } }).populate('uploadedBy', 'name email');
    res.json(assets);
  } catch (error) {
    res.status(500).json({ message: 'List failed', error: error.message });
  }
});

// Admin: Get all assets
router.get('/all', authJs, async (req, res) => {
  try {
    if (!req.decoded.isAdmin) {
      return res.status(403).json({ message: 'Forbidden: Admins only' });
    }
    const assets = await Asset.find().populate('uploadedBy', 'name email');
    res.json(assets);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch all assets', error: error.message });
  }
});

// Delete asset (any admin)
router.delete('/:id', authJs, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });

    if (!req.decoded.isAdmin) {
      return res.status(403).json({ message: 'Forbidden: Only admins can delete assets.' });
    }

    // Delete from Cloudinary
    try {
      await cloudinary.uploader.destroy(asset.publicId, {
        resource_type: asset.format === 'zip' ? 'raw' : 'image'
      });
    } catch (err) {
      console.error('Error deleting from Cloudinary:', err);
      // Continue with database deletion even if Cloudinary deletion fails
    }

    // Delete from DB
    await asset.deleteOne();
    res.json({ message: 'Asset deleted successfully.' });
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ message: 'Delete failed', error: error.message });
  }
});

// Download asset (returns URL - actual download handled by client)
router.get('/download/:id', authJs, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }

    // Check if user has access to the lecture this asset belongs to
    const hasAccess = await Lecture.findOne({
      _id: asset.lectureId,
      studentsEnrolled: req.decoded.userId
    });

    if (!hasAccess && !req.decoded.isAdmin) {
      return res.status(403).json({ message: 'You do not have permission to download this asset' });
    }

    // Return the asset URL - client can handle the download
    res.json({ 
      url: asset.url,
      name: asset.name,
      mimeType: asset.mimeType
    });
  } catch (error) {
    console.error('Download failed:', error);
    res.status(500).json({ 
      message: 'Download failed', 
      error: error.message
    });
  }
});

module.exports = router;