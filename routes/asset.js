const express = require('express');
const router = express.Router();
// multer removed
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const authJs = require('../middlewares/auth');
const Asset = require('../models/asset');
const Course = require('../models/course');
const sendEmail = require('../lib/sendEmail');
const Lecture = require('../models/lecture');


// Multer removed: handle raw stream upload

// Google Drive setup
const KEYFILEPATH = path.join(__dirname, '../config/google-service-account.json'); // path to your service account key
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});
const drive = google.drive({ version: 'v3', auth });

// Your Google Drive folder ID (shared with service account)
const DRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID;

// Upload assets to Google Drive (auth required, supports folders, zips, and multiple files via multipart/form-data)
// Client must send: POST /upload?lectureId=... (multipart/form-data with files)
const Busboy = require('busboy');
const archiver = require('archiver');
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
        mimetype
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
        const fileMetadata = {
          name: file.filename,
          parents: [DRIVE_FOLDER_ID],
        };
        const media = {
          mimeType: file.mimetype,
          body: file.buffer,
        };

        const driveFile = await drive.files.create({
          resource: fileMetadata,
          media: media,
          fields: 'id, name, mimeType, webViewLink, webContentLink',
        });

        const asset = new Asset({
          name: driveFile.data.name,
          mimeType: driveFile.data.mimeType,
          driveFileId: driveFile.data.id,
          webViewLink: driveFile.data.webViewLink,
          webContentLink: driveFile.data.webContentLink,
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
        const { PassThrough } = require('stream');
        const zipStream = new PassThrough();
        archive.pipe(zipStream);

        for (const f of files) {
          if (typeof f.filename === 'string' && f.filename.trim() !== '') {
            archive.append(f.buffer, { name: f.filename });
          } else {
            console.warn('Skipping file with invalid filename:', f);
          }
        }

        archive.finalize();

        const fileMetadata = {
          name: zipName.endsWith('.zip') ? zipName : zipName + '.zip',
          parents: [DRIVE_FOLDER_ID],
        };
        const media = {
          mimeType: 'application/zip',
          body: zipStream,
        };

        const driveUploadPromise = drive.files.create({
          resource: fileMetadata,
          media: media,
          fields: 'id, name, mimeType, webViewLink, webContentLink',
        });

        archive.on('error', (err) => {
          errorOccurred = true;
          console.error('Archiver error:', err);
          return res.status(500).json({ message: 'Archiver error', error: err.message });
        });

        archive.on('end', async () => {
          try {
            const driveFile = await driveUploadPromise;
            const asset = new Asset({
              name: driveFile.data.name,
              mimeType: driveFile.data.mimeType,
              driveFileId: driveFile.data.id,
              webViewLink: driveFile.data.webViewLink,
              webContentLink: driveFile.data.webContentLink,
              uploadedBy: req.decoded.userId,
              lectureId: lectureId
            });
            await asset.save();
            res.json(asset);
          } catch (error) {
            errorOccurred = true;
            console.error('Upload failed:', error);
            return res.status(500).json({ message: 'Upload failed', error: error.message });
          }
        });
      }
    } catch (error) {
      errorOccurred = true;
      console.error('Upload failed:', error);
      return res.status(500).json({ message: 'Upload failed', error: error.message });
    }
  });

  busboy.on('error', (err) => {
    res.status(500).json({ message: 'Upload failed', error: err.message });
  });

  req.pipe(busboy);
});



// List assets (auth required, filtered by user's enrolled lectures)
router.get('/list', authJs, async (req, res) => {
  try {
    // Find lectures where user is enrolled
    // console.log('User ID:', req.decoded.userId);
    const lectures = await Lecture.find({ studentsEnrolled: req.decoded.userId }).select('_id');
    // console.log('User lectures:', lectures);
    const lectureIds = lectures.map(l => l._id);
    // Find assets for these lectures
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

    // Delete from Google Drive
    try {
      await drive.files.delete({ fileId: asset.driveFileId });
    } catch (err) {
      // If file not found on Drive, ignore
      if (err.code !== 404) {
        return res.status(500).json({ message: 'Failed to delete from Google Drive', error: err.message });
      }
    }
    // Delete from DB
    await asset.deleteOne();
    res.json({ message: 'Asset deleted successfully.' });
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ message: 'Delete failed', error: error.message, stack: error.stack });
  }
});

// Download asset from Google Drive (auth required)
router.get('/download/:id', authJs, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });

    const file = await drive.files.get(
      { fileId: asset.driveFileId, alt: 'media' },
      { responseType: 'stream' }
    );
    res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"`);
    file.data.pipe(res);
  } catch (error) {
    res.status(500).json({ message: 'Download failed', error: error.message });
  }
});

module.exports = router;