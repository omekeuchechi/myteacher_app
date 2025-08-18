const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const authJs = require('../middlewares/auth');
const OnsiteAsset = require('../models/onsite_asset');
const Busboy = require('busboy');
const User = require('../models/user');
const Course = require('../models/course');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Upload asset to Cloudinary
router.post('/upload', authJs, async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) {
    return res.status(400).json({ 
      success: false,
      message: 'courseId is required as a query parameter' 
    });
  }

  try {
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
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
        
        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { 
              resource_type: 'auto',
              folder: `courses/${courseId}`,
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

        const asset = new OnsiteAsset({
          name: file.filename,
          mimeType: file.mimetype,
          driveFileId: result.public_id,
          webViewLink: result.secure_url,
          webContentLink: result.secure_url,
          uploadedBy: req.decoded.userId,
          courseId: courseId,
          courseName: course.name
        });
        
        await asset.save();
        
        const savedAsset = await OnsiteAsset.findById(asset._id)
          .populate('uploadedBy', 'name email')
          .populate('courseId', 'name');
        
        res.json({
          success: true,
          message: 'Asset uploaded successfully',
          data: savedAsset
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
    
  } catch (error) {
    console.error('Error in upload:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing upload',
      error: error.message
    });
  }
});

// List assets for a specific course
router.get('/list/:courseId', authJs, async (req, res) => {
  try {
    const { courseId } = req.params;
    
    const user = await User.findById(req.decoded.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (!user.isAdmin && !user.isSuperAdmin && user.userCourse.toString() !== courseId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access these assets'
      });
    }
    
    const assets = await OnsiteAsset.find({ courseId })
      .populate('uploadedBy', 'name email')
      .populate('courseId', 'name')
      .sort({ createdAt: -1 });
    
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
      .populate('courseId', 'name');
      
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }
    
    const user = await User.findById(req.decoded.userId);
    if (!user.isAdmin && !user.isSuperAdmin && user.userCourse.toString() !== asset.courseId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this asset'
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
    
    const user = await User.findById(req.decoded.userId);
    if (asset.uploadedBy.toString() !== req.decoded.userId && !user.isAdmin && !user.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this asset'
      });
    }
    
    try {
      await cloudinary.uploader.destroy(asset.driveFileId);
    } catch (cloudinaryError) {
      console.error('Cloudinary delete error (proceeding with DB deletion):', cloudinaryError);
    }
    
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
    
    const user = await User.findById(req.decoded.userId);
    if (!user.isAdmin && !user.isSuperAdmin && user.userCourse.toString() !== asset.courseId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to download this asset'
      });
    }
    
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
