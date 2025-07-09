const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cloudinary = require('../config/cloudinary');
const auth = require('../middlewares/auth');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
});

// Upload endpoint for TinyMCE
router.post('/upload-image', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No file uploaded' 
      });
    }

    // Convert buffer to base64
    const base64Data = req.file.buffer.toString('base64');
    const dataUri = `data:${req.file.mimetype};base64,${base64Data}`;

    // Get postId from the request body or generate a temporary one if not provided
    const postId = req.body.postId || `temp-${Date.now()}`;
    const publicId = `AdminPost/${postId}/${Date.now()}`;

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: `AdminPost/${postId}`,
      public_id: publicId,
      resource_type: 'auto',
      overwrite: true,
      transformation: [
        { quality: 'auto:good' }, // Optimize image quality
        { fetch_format: 'auto' }  // Auto-optimize format
      ]
    });

    // Return the URL to TinyMCE
    res.json({
      location: result.secure_url
    });

  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error uploading image',
      error: error.message 
    });
  }
});

module.exports = router;