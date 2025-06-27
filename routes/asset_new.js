const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const authJs = require('../middlewares/auth');
const Asset = require('../models/asset');
const Course = require('../models/course');
const sendEmail = require('../lib/sendEmail');
const Lecture = require('../models/lecture');
const { cloudinary } = require('../config/cloudinary');
const Busboy = require('busboy');
const archiver = require('archiver');

// Upload assets to Cloudinary (supports multiple files via multipart/form-data)
// Client must send: POST /upload?lectureId=... (multipart/form-data with files)
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
    file.on('end', async () => {
      try {
        let realFilename = filename;
        if (filename && typeof filename === 'object' && filename.filename) {
          realFilename = filename.filename;
        }
        
        // Upload to Cloudinary
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'auto',
            folder: `myteacher_app/lectures/${lectureId}`,
            public_id: `${Date.now()}-${realFilename}`,
            overwrite: false,
            tags: [`lecture-${lectureId}`, `user-${req.decoded.userId}`]
          },
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              errorOccurred = true;
              return;
            }
            files.push({
              url: result.secure_url,
              public_id: result.public_id,
              format: result.format,
              resource_type: result.resource_type,
              original_filename: realFilename,
              mimetype: result.format ? `application/${result.format}` : mimetype,
              size: result.bytes
            });
          }
        );

        // Pipe the file buffer to Cloudinary
        const buffer = Buffer.concat(fileChunks);
        uploadStream.end(buffer);
        
      } catch (error) {
        console.error('Error processing file:', error);
        errorOccurred = true;
      }
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
      // Wait a moment for all Cloudinary uploads to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (files.length === 0) {
        return res.status(400).json({ message: 'No valid files were processed' });
      }

      // Save file references to database
      const savedAssets = [];
      for (const file of files) {
        const asset = new Asset({
          name: file.original_filename || `file-${Date.now()}`,
          mimeType: file.mimetype,
          cloudinaryId: file.public_id,
          url: file.url,
          format: file.format,
          resourceType: file.resource_type,
          size: file.size,
          uploadedBy: req.decoded.userId,
          lectureId: lectureId,
          tags: [`lecture-${lectureId}`, `user-${req.decoded.userId}`],
          metadata: {
            originalName: file.original_filename,
            uploadDate: new Date().toISOString(),
            resourceType: file.resource_type
          }
        });

        await asset.save();
        savedAssets.push(asset);
      }

      // If we have multiple files and a zip name was provided, create a zip
      if (savedAssets.length > 1 && zipName) {
        try {
          const archive = archiver('zip');
          const zipFileName = `${zipName || 'assets'}-${Date.now()}.zip`;
          const zipFileId = `lecture-${lectureId}/zips/${zipFileName}`;
          
          // Create a promise to handle the zip upload
          const zipUpload = new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                resource_type: 'raw',
                folder: `myteacher_app/lectures/${lectureId}/zips`,
                public_id: zipFileId,
                tags: [`lecture-${lectureId}`, 'zip-archive']
              },
              (error, result) => {
                if (error) {
                  console.error('Error uploading zip to Cloudinary:', error);
                  return reject(error);
                }
                resolve(result);
              }
            );
            
            archive.pipe(uploadStream);
            
            // Add each file to the zip
            savedAssets.forEach(asset => {
              archive.append(asset.url, { name: `${asset.name}.${asset.format}` });
            });
            
            archive.finalize();
          });
          
          // Wait for zip upload to complete
          const zipResult = await zipUpload;
          
          // Create an asset entry for the zip file
          const zipAsset = new Asset({
            name: zipName,
            mimeType: 'application/zip',
            cloudinaryId: zipResult.public_id,
            url: zipResult.secure_url,
            format: 'zip',
            resourceType: 'raw',
            size: zipResult.bytes,
            uploadedBy: req.decoded.userId,
            lectureId: lectureId,
            tags: [`lecture-${lectureId}`, 'zip-archive'],
            metadata: {
              originalName: zipName,
              uploadDate: new Date().toISOString(),
              resourceType: 'zip',
              contains: savedAssets.length + ' files'
            }
          });
          
          await zipAsset.save();
          savedAssets.push(zipAsset);
          
        } catch (zipError) {
          console.error('Error creating zip archive:', zipError);
          // Continue with the individual file uploads even if zip fails
        }
      }

      // Send success response
      res.status(201).json({
        success: true,
        message: `Successfully uploaded ${savedAssets.length} file(s)`,
        assets: savedAssets.map(asset => ({
          id: asset._id,
          name: asset.name,
          url: asset.url,
          format: asset.format,
          size: asset.size,
          uploadedAt: asset.createdAt
        }))
      });

    } catch (error) {
      console.error('Error saving asset to database:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error processing upload',
        error: error.message 
      });
    }
  });

  // Handle busboy errors
  busboy.on('error', (error) => {
    console.error('Busboy error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        message: 'Error processing file upload',
        error: error.message 
      });
    }
  });

  // Pipe the request to busboy
  req.pipe(busboy);
});

// Get assets for a specific lecture
router.get('/lecture/:lectureId', authJs, async (req, res) => {
  try {
    const { lectureId } = req.params;
    const { skip = 0, limit = 10, sort = 'createdAt:-1' } = req.query;
    
    const [sortField, sortOrder] = sort.split(':');
    const sortOptions = { [sortField]: sortOrder === 'asc' ? 1 : -1 };
    
    const assets = await Asset.findByLecture(lectureId, { 
      skip: parseInt(skip), 
      limit: parseInt(limit),
      sort: sortOptions
    });
    
    res.json({
      success: true,
      data: assets,
      pagination: {
        skip: parseInt(skip),
        limit: parseInt(limit),
        total: await Asset.countDocuments({ lectureId })
      }
    });
    
  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching assets',
      error: error.message 
    });
  }
});

// Get a single asset by ID
router.get('/:id', authJs, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate('uploadedBy', 'name email')
      .populate('lectureId', 'name');
      
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
    console.error('Error fetching asset:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching asset',
      error: error.message 
    });
  }
});

// Delete an asset by ID
router.delete('/:id', authJs, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);
    
    if (!asset) {
      return res.status(404).json({ 
        success: false, 
        message: 'Asset not found' 
      });
    }
    
    // Check if the user has permission to delete this asset
    if (asset.uploadedBy.toString() !== req.decoded.userId && !req.decoded.isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to delete this asset' 
      });
    }
    
    // Delete from Cloudinary
    await cloudinary.uploader.destroy(asset.cloudinaryId, {
      resource_type: asset.resourceType,
      invalidate: true
    });
    
    // Delete from database
    await Asset.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Asset deleted successfully',
      assetId: req.params.id
    });
    
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting asset',
      error: error.message 
    });
  }
});

// Search assets
router.get('/search', authJs, async (req, res) => {
  try {
    const { q: query, skip = 0, limit = 10, sort = 'createdAt:-1' } = req.query;
    
    if (!query) {
      return res.status(400).json({ 
        success: false, 
        message: 'Search query is required' 
      });
    }
    
    const [sortField, sortOrder] = sort.split(':');
    const sortOptions = { [sortField]: sortOrder === 'asc' ? 1 : -1 };
    
    const assets = await Asset.search(query, { 
      skip: parseInt(skip), 
      limit: parseInt(limit),
      sort: sortOptions
    });
    
    res.json({
      success: true,
      query,
      data: assets,
      pagination: {
        skip: parseInt(skip),
        limit: parseInt(limit),
        total: await Asset.countDocuments({
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { 'tags': { $regex: query, $options: 'i' } }
          ]
        })
      }
    });
    
  } catch (error) {
    console.error('Error searching assets:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error searching assets',
      error: error.message 
    });
  }
});

module.exports = router;
