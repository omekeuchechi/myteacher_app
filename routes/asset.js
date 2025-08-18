const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const authJs = require('../middlewares/auth');
const Asset = require('../models/asset');
const Lecture = require('../models/lecture');
const Busboy = require('busboy');
const archiver = require('archiver');
const mongoose = require('mongoose'); // Import mongoose

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Utility function to handle Cloudinary uploads
const uploadToCloudinary = (buffer, options) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(error);
        } else {
          console.log('Cloudinary upload successful:', {
            public_id: result.public_id,
            secure_url: result.secure_url,
            format: result.format
          });
          resolve(result);
        }
      }
    );

    const bufferStream = new Readable();
    bufferStream.push(buffer);
    bufferStream.push(null);
    bufferStream.pipe(uploadStream);
  });
};

// Upload assets to Cloudinary
router.post('/upload', authJs, async (req, res) => {
  const { lectureId } = req.query;
  let zipName = '';
  
  if (!lectureId) {
    return res.status(400).json({ 
      success: false,
      message: 'lectureId is required as a query parameter' 
    });
  }

  // Verify lecture exists and user has access
  try {
    const lecture = await Lecture.findById(lectureId);
    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found'
      });
    }

    // Check if user is the instructor or admin
    const isInstructor = lecture.instructor && lecture.instructor.toString() === req.decoded.userId;
    const isAdmin = req.decoded.isAdmin;
    
    if (!isInstructor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to upload to this lecture',
        error: 'Access denied: Not authorized'
      });
    }
  } catch (error) {
    console.error('Error verifying lecture access:', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying lecture access',
      error: error.message
    });
  }

  const busboy = Busboy({ headers: req.headers });
  const files = [];
  let hasFile = false;
  let errorOccurred = false;

  busboy.on('field', (fieldname, val) => {
    if (fieldname === 'zipName' && val) {
      zipName = val.trim();
    }
  });

  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
    hasFile = true;
    const fileChunks = [];
    
    file.on('data', (data) => fileChunks.push(data));
    
    file.on('end', () => {
      if (fileChunks.length === 0) {
        console.warn('Empty file received:', filename);
        return;
      }
      
      const buffer = Buffer.concat(fileChunks);
      files.push({
        buffer,
        filename: (filename && typeof filename === 'object' ? filename.filename : filename) || 'unnamed_file',
        mimetype: mimetype || 'application/octet-stream'
      });
    });
    
    file.on('error', (err) => {
      console.error('File processing error:', err);
      errorOccurred = true;
      res.status(500).json({
        success: false,
        message: 'Error processing file',
        error: err.message
      });
    });
  });

  busboy.on('error', (err) => {
    console.error('Busboy error:', err);
    errorOccurred = true;
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'File upload failed',
        error: err.message
      });
    }
  });

  busboy.on('finish', async () => {
    if (errorOccurred) return;
    
    if (!hasFile || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files were uploaded'
      });
    }

    try {
      if (files.length === 1) {
        // Single file upload
        const file = files[0];
        
        try {
          const result = await uploadToCloudinary(file.buffer, {
            resource_type: 'auto',
            folder: `lectures/${lectureId}`,
            public_id: file.filename.split('.')[0],
            overwrite: false,
            unique_filename: true
          });

          const asset = new Asset({
            name: file.filename,
            mimeType: file.mimetype,
            webContentLink: result.secure_url,
            webViewLink: result.secure_url.replace('/upload/', '/upload/fl_attachment/'),
            driveFileId: result.public_id,
            uploadedBy: req.decoded.userId,
            lectureId: lectureId
          });
          
          await asset.save();
          
          res.json({
            success: true,
            message: 'File uploaded successfully',
            asset: {
              id: asset._id,
              name: asset.name,
              mimeType: asset.mimeType,
              url: asset.webContentLink,
              createdAt: asset.createdAt
            }
          });
          
        } catch (uploadError) {
          console.error('Upload failed:', uploadError);
          res.status(500).json({
            success: false,
            message: 'File upload failed',
            error: uploadError.message
          });
        }
        
      } else {
        // Multiple files: create a zip archive
        if (!zipName) {
          return res.status(400).json({
            success: false,
            message: 'zipName is required when uploading multiple files'
          });
        }

        const archive = archiver('zip', { 
          zlib: { level: 9 },
          forceLocalTime: true,
          store: false
        });
        
        const chunks = [];
        
        archive.on('warning', (err) => {
          if (err.code === 'ENOENT') {
            console.warn('Archive warning:', err);
          } else {
            throw err;
          }
        });

        archive.on('error', (err) => {
          console.error('Archive error:', err);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              message: 'Error creating zip archive',
              error: err.message
            });
          }
        });

        archive.on('data', (chunk) => chunks.push(chunk));
        
        archive.on('end', async () => {
          try {
            const buffer = Buffer.concat(chunks);
            
            if (buffer.length === 0) {
              throw new Error('Created zip file is empty');
            }
            
            const finalZipName = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`;
            
            const result = await uploadToCloudinary(buffer, {
              resource_type: 'raw',
              folder: `lectures/${lectureId}`,
              public_id: finalZipName.replace(/\.zip$/i, ''),
              overwrite: false,
              unique_filename: true
            });

            const asset = new Asset({
              name: finalZipName,
              mimeType: 'application/zip',
              webContentLink: result.secure_url,
              webViewLink: result.secure_url.replace('/upload/', '/upload/fl_attachment/'),
              driveFileId: result.public_id,
              uploadedBy: req.decoded.userId,
              lectureId: lectureId
            });
            
            await asset.save();
            
            res.json({
              success: true,
              message: 'Files zipped and uploaded successfully',
              asset: {
                id: asset._id,
                name: asset.name,
                mimeType: asset.mimeType,
                url: asset.webContentLink,
                createdAt: asset.createdAt,
                fileCount: files.length
              }
            });
            
          } catch (error) {
            console.error('Zip upload failed:', error);
            if (!res.headersSent) {
              res.status(500).json({
                success: false,
                message: 'Failed to upload zip file',
                error: error.message
              });
            }
          }
        });

        // Add files to archive
        for (const file of files) {
          if (file.buffer && file.buffer.length > 0) {
            archive.append(file.buffer, { name: file.filename });
          } else {
            console.warn('Skipping empty file:', file.filename);
          }
        }

        await archive.finalize();
      }
    } catch (error) {
      console.error('Upload processing failed:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error processing upload',
          error: error.message
        });
      }
    }
  });

  req.pipe(busboy);
});

// Download asset
router.get('/download/:id', authJs, async (req, res) => {
  const { id } = req.params;
  console.log(`Download request for asset ID: ${id}`);
  
  try {
    const asset = await Asset.findById(id);
    
    if (!asset) {
      console.log('Asset not found');
      return res.status(404).json({
        success: false,
        message: 'Asset not found',
        error: 'The requested file could not be found'
      });
    }

    // Check if user has access to the lecture
    const lecture = await Lecture.findOne({
      _id: asset.lectureId,
      $or: [
        { studentsEnrolled: req.decoded.userId },
        { instructor: req.decoded.userId }
      ]
    });

    if (!lecture && !req.decoded.isAdmin) {
      console.log('Access denied - User not enrolled and not admin');
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        error: 'You do not have permission to download this file'
      });
    }

    // Generate download URL
    let downloadUrl = asset.webContentLink;
    
    if (!downloadUrl && asset.driveFileId) {
      downloadUrl = cloudinary.url(asset.driveFileId, {
        secure: true,
        resource_type: asset.mimeType === 'application/zip' ? 'raw' : 'auto',
        type: 'upload',
        flags: 'attachment',
        sign_url: true
      });
      console.log('Generated Cloudinary download URL');
    }
    
    if (!downloadUrl) {
      console.error('No valid download URL available');
      return res.status(410).json({
        success: false,
        message: 'File not available',
        error: 'This file is no longer available for download',
        code: 'FILE_UNAVAILABLE'
      });
    }

    // Stream the file from Cloudinary
    console.log(`Initiating download from: ${downloadUrl}`);
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
      throw new Error(`Cloudinary responded with status ${response.status}`);
    }
    
    // Get the content type and content length from the response
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');
    
    // Set response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', contentLength);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(asset.name)}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Handle the response body as a stream
    const reader = response.body.getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    
    res.end();
    
  } catch (error) {
    console.error('Download failed:', error);
    
    if (!res.headersSent) {
      // If headers are already sent, we can't send JSON
      if (res.headersSent) {
        console.error('Headers already sent, cannot send error response');
        return;
      }
      
      // If we've started streaming, end the response
      if (res.writableEnded) {
        console.error('Response already ended, cannot send error response');
        return;
      }
      
      // Clear any partial response
      if (res.headersSent) {
        res.end();
        return;
      }
      
      // Send error response
      res.status(500).json({
        success: false,
        message: 'Download failed',
        error: error.message,
        code: 'DOWNLOAD_FAILED'
      });
    }
  }
});

// List all assets (admin only)
router.get('/all', authJs, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        error: 'Admin privileges required to list all assets'
      });
    }

    const assets = await Asset.find()
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'name email')
      .populate('lectureId', 'title');
    
    res.json({
      success: true,
      count: assets.length,
      data: assets.map(asset => ({
        id: asset._id,
        name: asset.name,
        mimeType: asset.mimeType,
        url: asset.webContentLink,
        downloadUrl: asset.webViewLink,
        size: asset.size,
        lecture: asset.lectureId,
        uploadedBy: asset.uploadedBy,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt
      }))
    });
    
  } catch (error) {
    console.error('Error listing all assets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list all assets',
      error: error.message
    });
  }
});

// Delete asset
router.delete('/asset-delete/:id', authJs, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID parameter
    if (!id || id === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Asset ID is required',
        error: 'No asset ID provided'
      });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid asset ID format',
        error: 'The provided ID is not a valid MongoDB ObjectId'
      });
    }

    const asset = await Asset.findById(id);
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found',
        error: 'No asset found with the provided ID'
      });
    }

    // Verify user is the uploader, instructor, or admin
    const isUploader = asset.uploadedBy && asset.uploadedBy.toString() === req.decoded.userId;
    const isAdmin = req.decoded.isAdmin;
    
    let isInstructor = false;
    if (!isAdmin && asset.lectureId) {
      const lecture = await Lecture.findOne({
        _id: asset.lectureId,
        instructor: req.decoded.userId
      });
      isInstructor = !!lecture;
    }

    if (!isUploader && !isInstructor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        error: 'You do not have permission to delete this file'
      });
    }

    // Delete from Cloudinary if driveFileId exists
    if (asset.driveFileId) {
      try {
        await cloudinary.uploader.destroy(asset.driveFileId, {
          resource_type: asset.mimeType === 'application/zip' ? 'raw' : 'image',
          invalidate: true
        });
        console.log(`Deleted from Cloudinary: ${asset.driveFileId}`);
      } catch (cloudinaryError) {
        console.error('Error deleting from Cloudinary:', cloudinaryError);
        // Continue with database deletion even if Cloudinary deletion fails
      }
    }

    // Delete from database
    await asset.deleteOne();
    
    res.json({
      success: true,
      message: 'Asset deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete failed:', error);
    const statusCode = error.name === 'CastError' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      message: 'Failed to delete asset',
      error: error.name === 'CastError' ? 'Invalid asset ID format' : error.message
    });
  }
});


// Get a single asset by ID
router.get('/:id', authJs, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID parameter
    if (!id || id === 'undefined') {
      return res.status(400).json({
        success: false,
        message: 'Asset ID is required',
        error: 'No asset ID provided'
      });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid asset ID format',
        error: 'The provided ID is not a valid MongoDB ObjectId'
      });
    }

    const asset = await Asset.findById(id)
      .populate('uploadedBy', 'name email')
      .populate('lectureId', 'title');
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found',
        error: 'No asset found with the provided ID'
      });
    }

    // Check if user has access to this asset
    const isOwner = asset.uploadedBy && asset.uploadedBy._id.toString() === req.decoded.userId;
    const isAdmin = req.decoded.isAdmin;
    let hasLectureAccess = false;

    if (!isOwner && !isAdmin && asset.lectureId) {
      // Check if user is enrolled in the lecture or is the instructor
      const lecture = await Lecture.findOne({
        _id: asset.lectureId,
        $or: [
          { studentsEnrolled: req.decoded.userId },
          { instructor: req.decoded.userId }
        ]
      });
      hasLectureAccess = !!lecture;
    }

    if (!isOwner && !isAdmin && !hasLectureAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        error: 'You do not have permission to access this asset'
      });
    }

    // Format the response
    const response = {
      success: true,
      data: {
        id: asset._id,
        name: asset.name,
        mimeType: asset.mimeType,
        url: asset.webContentLink,
        downloadUrl: asset.webViewLink,
        size: asset.size,
        lecture: asset.lectureId,
        uploadedBy: asset.uploadedBy,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt
      }
    };

    res.json(response);
    
  } catch (error) {
    console.error('Error fetching asset:', error);
    const statusCode = error.name === 'CastError' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      message: 'Failed to fetch asset',
      error: error.name === 'CastError' ? 'Invalid asset ID format' : error.message
    });
  }
});

// List assets for a lecture
router.get('/list/lecture/:lectureId', authJs, async (req, res) => {
  try {
    const { lectureId } = req.params;
    
    // Verify user has access to the lecture
    const lecture = await Lecture.findOne({
      _id: lectureId,
      $or: [
        { studentsEnrolled: req.decoded.userId },
        { instructor: req.decoded.userId }
      ]
    });

    if (!lecture && !req.decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        error: 'You do not have permission to view these files'
      });
    }

    const assets = await Asset.find({ lectureId })
      .sort({ createdAt: -1 })
      .populate('uploadedBy', 'name email');
    
    res.json({
      success: true,
      count: assets.length,
      data: assets.map(asset => ({
        id: asset._id,
        name: asset.name,
        mimeType: asset.mimeType,
        url: asset.webContentLink,
        downloadUrl: asset.webViewLink,
        size: asset.size,
        uploadedBy: asset.uploadedBy,
        createdAt: asset.createdAt
      }))
    });
    
  } catch (error) {
    console.error('Error listing assets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list assets',
      error: error.message
    });
  }
});

/**
 * @route GET /api/assets/my-batch-assets
 * @description Get all assets for the batches the current user is enrolled in
 * @access Private (requires authentication)
 */
router.get('/my-batch-assets', authJs, async (req, res) => {
  try {
    console.log('Request received at /assets/my-batch-assets');
    console.log('Authenticated user:', req.decoded);
    
    if (!req.decoded || !req.decoded.userId) {
      console.error('No user ID found in request');
      return res.status(400).json({
        success: false,
        message: 'User ID not found in request',
        error: 'Authentication required'
      });
    }

    const userId = req.decoded.userId;
    console.log('Fetching lectures for user ID:', userId);

    // 1. Find all lectures where the user is enrolled
    const lectures = await Lecture.find({
      studentsEnrolled: { $in: [new mongoose.Types.ObjectId(userId)] }
    }).select('_id');

    console.log('Found lectures:', lectures);

    if (!lectures || lectures.length === 0) {
      console.log('No lectures found for user');
      return res.json({
        success: true,
        count: 0,
        data: []
      });
    }

    const lectureIds = lectures.map(lecture => lecture._id);
    console.log('Lecture IDs:', lectureIds);

    // 2. Find all assets linked to these lectures
    const assets = await Asset.find({
      lectureId: { $in: lectureIds }
    })
    .populate('lectureId', 'title')
    .populate('uploadedBy', 'name')
    .sort({ createdAt: -1 });

    console.log('Found assets:', assets.length);

    // 3. Format the response
    const formattedAssets = assets.map(asset => ({
      id: asset._id,
      name: asset.name,
      mimeType: asset.mimeType,
      url: asset.webContentLink,
      downloadUrl: asset.webViewLink,
      size: asset.size,
      lecture: {
        id: asset.lectureId?._id,
        title: asset.lectureId?.title
      },
      uploadedBy: asset.uploadedBy?.name || 'Unknown',
      createdAt: asset.createdAt
    }));

    res.json({
      success: true,
      count: formattedAssets.length,
      data: formattedAssets
    });

  } catch (error) {
    console.error('Error in /assets/my-batch-assets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch batch assets',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

module.exports = router;