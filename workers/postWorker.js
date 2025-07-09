// workers/postWorker.js
const { parentPort, workerData } = require('worker_threads');
const { Readable } = require('stream');
const mongoose = require('mongoose');
const Post = require('../models/post');
const cloudinary = require('cloudinary').v2;

// Configure mongoose to use the parent process's connection if available
if (mongoose.connection.readyState === 0) {
  mongoose.connect(process.env.DATABASE_CONN, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
    maxPoolSize: 10,
  });
}

// Handle connection events
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error in worker:', err);
  process.exit(1);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected in worker');
});

// Set mongoose options
mongoose.set('bufferCommands', true);
mongoose.set('bufferTimeoutMS', 30000);

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Uploads a single file to Cloudinary
 * @param {Object} file - File object with buffer and mimetype
 * @param {boolean} isFeatured - Whether this is a featured image
 * @returns {Promise<Object>} Upload result
 */
async function uploadFile(file, isFeatured = false) {
  return new Promise((resolve, reject) => {
    try {
      const folder = isFeatured ? 'posts/featured' : 'posts/images';
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          transformation: [
            { width: 1200, crop: 'limit' },
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) return reject(error);
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            isFeatured
          });
        }
      );

      // Create a readable stream from the buffer
      const bufferStream = new Readable();
      bufferStream.push(file.buffer);
      bufferStream.push(null);
      
      // Pipe the buffer stream to Cloudinary
      bufferStream.pipe(uploadStream);
    } catch (error) {
      console.error('Error preparing file upload:', error);
      reject(error);
    }
  });
}

/**
 * Uploads multiple files in parallel with concurrency control
 * @param {Array} files - Array of files to upload
 * @returns {Promise<Array>} Array of upload results
 */
async function uploadImages(files) {
  const MAX_CONCURRENT_UPLOADS = 3;
  const results = [];
  const queue = [...files];
  
  while (queue.length > 0) {
    const currentBatch = queue.splice(0, MAX_CONCURRENT_UPLOADS);
    const uploadPromises = currentBatch.map(({ file, isFeatured }) => 
      uploadFile(file, isFeatured).catch(error => {
        console.error(`Error uploading ${isFeatured ? 'featured' : ''} image:`, error.message);
        return null; // Continue with other uploads even if one fails
      })
    );
    
    const batchResults = await Promise.all(uploadPromises);
    results.push(...batchResults.filter(Boolean));
  }
  
  return results;
}

/**
 * Creates a new post with uploaded files
 */
async function createPost() {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { postData, files = [] } = workerData;
    
    // Upload images if any
    let uploadedFiles = [];
    if (files.length > 0) {
      try {
        uploadedFiles = await uploadImages(files);
      } catch (uploadError) {
        console.error('Error uploading files:', uploadError);
        throw new Error('Failed to upload one or more files');
      }
      
      // Process uploaded files
      uploadedFiles.forEach(file => {
        const fileData = {
          url: file.url,
          publicId: file.publicId,
          width: file.width,
          height: file.height,
          format: file.format
        };
        
        if (file.isFeatured) {
          postData.featuredImage = fileData;
        } else {
          if (!postData.images) {
            postData.images = [];
          }
          postData.images.push(fileData);
        }
      });
    }
    
    // Create and save the post with transaction
    const post = new Post(postData);
    const savedPost = await post.save({ session });
    
    // Commit the transaction
    await session.commitTransaction();
    
    // Send success response
    parentPort.postMessage({
      success: true,
      post: savedPost.toObject()
    });
    
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();
    
    console.error('Post creation failed:', error);
    
    // Cleanup uploaded files if post creation fails
    if (uploadedFiles && uploadedFiles.length > 0) {
      try {
        await Promise.all(
          uploadedFiles.map(file => 
            cloudinary.uploader.destroy(file.publicId)
              .catch(e => console.error('Error cleaning up file:', e))
          )
        );
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
    }
    
    parentPort.postMessage({ 
      success: false,
      error: 'Failed to create post',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    session.endSession();
  }
}

// Start the post creation process
createPost().catch(error => {
  console.error('Unhandled error in worker:', error);
  process.exit(1);
});