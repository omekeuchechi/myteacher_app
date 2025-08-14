const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const authJs = require('../middlewares/auth');
const OnsiteAsset = require('../models/onsite_asset');
const Busboy = require('busboy');
const User = require('../models/user'); // Assuming User model is defined in this file

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Upload asset to Cloudinary
router.post('/upload', authJs, async (req, res) => {
  const { lectureId } = req.query;
  if (!lectureId) {
    return res.status(400).json({ 
      success: false,
      message: 'lectureId is required as a query parameter' 
    });
  }

  const files = [];
  const busboy = Busboy({ headers: req.headers });
  let hasFile = false;
  let errorOccurred = false;

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
      return res.status(500).json({ 
        success: false,
        message: 'File upload failed.' 
      });
    }
    
    if (!hasFile) {
      return res.status(400).json({ 
        success: false,
        message: 'No files uploaded' 
      });
    }

    try {
      const file = files[0];
      
      // Upload to Cloudinary
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { 
            resource_type: 'auto',
            folder: `onsite-lectures/${lectureId}`,
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

      // Save to database
      const asset = new OnsiteAsset({
        name: file.filename,
        mimeType: file.mimetype,
        webViewLink: result.secure_url,
        webContentLink: result.secure_url,
        uploadedBy: req.decoded.userId,
        lectureId: lectureId
      });
      
      await asset.save();
      
      res.json({
        success: true,
        message: 'Asset uploaded successfully',
        data: asset
      });
      
    } catch (error) {
      console.error('Upload failed:', error);
      res.status(500).json({ 
        success: false,
        message: 'Upload failed', 
        error: error.message 
      });
    }
  });

  busboy.on('error', (err) => {
    console.error('Busboy error:', err);
    errorOccurred = true;
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        message: 'Upload failed', 
        error: err.message 
      });
    }
  });

  req.pipe(busboy);
});

// List assets for a specific lecture
router.get('/list/:lectureId', authJs, async (req, res) => {
  try {
    const { lectureId } = req.params;
    
    // Get user details to check course and onSite status
    const user = await User.findById(req.decoded.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Get all assets for the lecture
    let assets = await OnsiteAsset.find({ lectureId })
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 });
    
    // If user is not admin, filter by user's course and onSite status
    if (!user.isAdmin && !user.isSuperAdmin) {
      // Get all users who are in the same course and are onSite
      const usersInSameCourse = await User.find({
        userCourse: user.userCourse,
        onSite: true
      }).select('_id');
      
      const userIds = usersInSameCourse.map(u => u._id);
      
      // Filter assets to only include those uploaded by users in the same course who are onSite
      assets = assets.filter(asset => 
        userIds.some(id => id.equals(asset.uploadedBy))
      );
    }
    
    res.json({
      success: true,
      data: assets
    });
    
  } catch (error) {
    console.error('List failed:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to list assets', 
      error: error.message 
    });
  }
});

// Get asset details
router.get('/:assetId', authJs, async (req, res) => {
  try {
    const asset = await OnsiteAsset.findById(req.params.assetId)
      .populate('uploadedBy', 'name email')
      .populate('lectureId', 'title');
      
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }
    
    res.json({
      success: true,
      data: asset
    });
    
  } catch (error) {
    console.error('Fetch failed:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch asset', 
      error: error.message 
    });
  }
});

// Delete asset
router.delete('/:assetId', authJs, async (req, res) => {
  try {
    const asset = await OnsiteAsset.findById(req.params.assetId);
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }
    
    // Check if user is the uploader or an admin
    if (asset.uploadedBy.toString() !== req.decoded.userId && !req.decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this asset'
      });
    }
    
    // Delete from Cloudinary
    try {
      const publicId = asset.webViewLink.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(`onsite-lectures/${asset.lectureId}/${publicId}`);
    } catch (cloudinaryError) {
      console.error('Cloudinary delete error (proceeding with DB deletion):', cloudinaryError);
    }
    
    // Delete from database
    await asset.deleteOne();
    
    res.json({
      success: true,
      message: 'Asset deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete failed:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete asset', 
      error: error.message 
    });
  }
});

// Download asset (returns URL - actual download handled by client)
router.get('/download/:assetId', authJs, async (req, res) => {
  try {
    const asset = await OnsiteAsset.findById(req.params.assetId);
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }
    
    // Check if user has access to the lecture this asset belongs to
    // Note: You might want to add additional access control logic here
    
    res.json({
      success: true,
      data: {
        url: asset.webContentLink,
        name: asset.name,
        mimeType: asset.mimeType
      }
    });
    
  } catch (error) {
    console.error('Download failed:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to process download', 
      error: error.message 
    });
  }
});

module.exports = router;
