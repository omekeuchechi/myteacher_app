// routes/post.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Worker } = require('worker_threads');
const path = require('path');
const Pusher = require('pusher');
const authJs = require('../middlewares/auth');
const Post = require('../models/post');
const User = require('../models/user');
const NodeCache = require('node-cache');
const { Buffer } = require('buffer');

// Initialize cache
const postCache = new NodeCache({ stdTTL: 300 });

// Helper function to process base64 data
const processBase64Data = (base64String) => {
  if (!base64String) return null;
  
  try {
    // Remove data URL prefix if present
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 string');
    }
    
    const contentType = matches[1];
    const data = Buffer.from(matches[2], 'base64');
    
    // Extract file extension from content type
    const extension = contentType.split('/')[1] || 'bin';
    
    return {
      buffer: data,
      mimetype: contentType,
      originalname: `file-${Date.now()}.${extension}`
    };
  } catch (error) {
    console.error('Error processing base64 data:', error);
    return null;
  }
};

// Initialize Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// Worker thread for processing post creation
const createPostWorker = (postData, files = []) => {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./workers/postWorker.js', {
      workerData: { postData, files }
    });

    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
};

// Input validation middleware
const validatePostInput = (req, res, next) => {
  const { category, content } = req.body;
  if (!category || !content) {
    return res.status(400).json({ message: 'Category and content are required' });
  }
  next();
};

// Get all posts with pagination and filtering
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Build filter object
    const filter = {};
    
    // Add category filter if provided
    if (req.query.category) {
      filter.category = req.query.category;
    }
    
    // Add search query if provided
    if (req.query.search) {
      filter.$or = [
        { title: { $regex: req.query.search, $options: 'i' } },
        { content: { $regex: req.query.search, $options: 'i' } }
      ];
    }
    
    // Get total count for pagination
    const total = await Post.countDocuments(filter);
    
    // Get paginated posts
    const posts = await Post.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email avatar') // Populate author details
      .lean();
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;
    
    res.json({
      success: true,
      data: posts,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPreviousPage,
        nextPage: hasNextPage ? page + 1 : null,
        previousPage: hasPreviousPage ? page - 1 : null
      }
    });
    
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching posts',
      error: error.message
    });
  }
});

// Create post with base64 file uploads
router.post('/create', authJs, async (req, res) => {
  // Verify admin status
  const user = req.decoded;
  
  if (!user.isAdmin) {
    return res.status(403).json({ 
      success: false,
      message: 'Not authorized to create posts' 
    });
  }
  
  try {
    // Validate required fields
    if (!req.body.title || !req.body.content) {
      return res.status(400).json({
        success: false,
        message: 'Title and content are required'
      });
    }

    // Prepare post data
    const postData = {
      title: req.body.title,
      content: req.body.content,
      category: req.body.category || 'Uncategorized',
      createdBy: user.userId,
      tags: req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()) : [],
      featuredImage: null,
      images: []
    };
    
    // Process uploaded files
    const filesToProcess = [];
    
    // Process featured image if provided
    if (req.body.featuredImage) {
      const processedFile = processBase64Data(req.body.featuredImage);
      if (processedFile) {
        filesToProcess.push({
          file: processedFile,
          isFeatured: true
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid featured image format'
        });
      }
    }
    
    // Process additional images if provided
    if (req.body.images && Array.isArray(req.body.images)) {
      for (const img of req.body.images) {
        const processedFile = processBase64Data(img);
        if (processedFile) {
          filesToProcess.push({
            file: processedFile,
            isFeatured: false
          });
        }
      }
    }
    
    // Create post with all files using worker thread
    const result = await createPostWorker(postData, filesToProcess);
    
    res.status(result.success ? 201 : 500).json(result);
  } catch (error) {
    console.error('Error in post creation:', error);
    res.status(500).json({ 
      success: false,
      message: "Error creating post", 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get all posts with pagination and caching
router.get('/', authJs, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const cacheKey = `posts_${page}_${limit}`;

  try {
    // Try to get from cache first
    const cachedPosts = postCache.get(cacheKey);
    if (cachedPosts) {
      return res.status(200).json({
        message: "Posts retrieved from cache",
        posts: cachedPosts
      });
    }

    // If not in cache, query database
    const [posts, total] = await Promise.all([
      Post.find()
        .populate('createdBy', 'username avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Post.countDocuments()
    ]);

    if (!posts.length) {
      return res.status(404).json({ message: "No posts found" });
    }

    // Cache the result
    postCache.set(cacheKey, posts);

    res.status(200).json({
      message: "Posts retrieved successfully",
      posts,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalPosts: total
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ message: "Error fetching posts", error: error.message });
  }
});

// Like/Unlike post with Pusher
const updateLikeStatus = async (postId, userId, action) => {
  const [post, user] = await Promise.all([
    Post.findById(postId),
    User.findById(userId)
  ]);

  if (!post || !user) {
    throw new Error('Post or user not found');
  }

  const likeIndex = post.likes.findIndex(like => like.user.toString() === userId.toString());
  const hasLiked = likeIndex !== -1;
  
  if (action === 'like') {
    if (hasLiked) {
      throw new Error('You already liked this post');
    }
    post.likes.push({ user: userId });
  } else {
    if (!hasLiked) {
      throw new Error('You have not liked this post');
    }
    post.likes = post.likes.filter(like => like.user.toString() !== userId.toString());
  }

  await post.save();
  
  // Trigger Pusher event
  pusher.trigger(`post-${postId}`, 'like-updated', {
    postId,
    likesCount: post.likes.length,
    action
  });

  return { post };
};

// Like a post
router.patch('/:postId/like', authJs, async (req, res) => {
  try {
    const { post } = await updateLikeStatus(
      req.params.postId,
      req.decoded.userId,
      'like'
    );
    
    res.status(200).json({
      message: "Post liked successfully",
      likesCount: post.likes.length,
      isLiked: true
    });
  } catch (error) {
    res.status(400).json({
      message: error.message || 'Error liking post'
    });
  }
});

// Unlike a post
router.patch('/:postId/unlike', authJs, async (req, res) => {
  try {
    const { post } = await updateLikeStatus(
      req.params.postId,
      req.decoded.userId,
      'unlike'
    );
    
    res.status(200).json({
      message: "Post unliked successfully",
      likesCount: post.likes.length,
      isLiked: false
    });
  } catch (error) {
    res.status(400).json({
      message: error.message || 'Error unliking post'
    });
  }
});

// Get single post
router.get('/:postId', authJs, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId)
      .populate('createdBy', 'username avatar')
      .populate('comments')
      .lean();

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Increment view count
    await Post.findByIdAndUpdate(req.params.postId, { $inc: { viewCount: 1 } });

    res.status(200).json({
      message: "Post retrieved successfully",
      post
    });
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ message: "Error fetching post", error: error.message });
  }
});

// Update post
router.patch('/:postId', authJs, async (req, res) => {
  const { postId } = req.params;
  const { category, content, tags } = req.body;
  const { userId, isAdmin } = req.decoded;

  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      const post = await Post.findById(postId);
      if (!post) {
        return res.status(404).json({ message: "Post not found" });
      }

      // Check if user is admin or the post creator
      if (!isAdmin && post.createdBy.toString() !== userId) {
        return res.status(403).json({ message: "Not authorized to edit this post" });
      }

      // Update post fields
      if (category) post.category = category;
      if (content) post.content = content;
      if (tags) post.tags = tags.split(',').map(tag => tag.trim());

      // Handle new image uploads
      if (req.files && req.files.length > 0) {
        // Delete old images from Cloudinary if they exist
        if (post.images && post.images.length > 0) {
          const deletePromises = post.images.map(image => 
            cloudinary.uploader.destroy(image.publicId)
          );
          await Promise.all(deletePromises);
        }

        // Upload new images
        const uploadPromises = req.files.map(file => 
          cloudinary.uploader.upload(file.path, {
            folder: 'posts',
            width: 1200,
            height: 630,
            crop: 'limit',
            quality: 'auto'
          })
        );

        const results = await Promise.all(uploadPromises);
        post.images = results.map(result => ({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format
        }));
      }

      const updatedPost = await post.save();
      
      // Invalidate cache
      postCache.keys().forEach(key => {
        if (key.startsWith('posts_')) {
          postCache.del(key);
        }
      });

      // Trigger Pusher event
      pusher.trigger(`post-${postId}`, 'post-updated', {
        message: 'Post updated',
        post: updatedPost
      });

      res.status(200).json({
        message: "Post updated successfully",
        post: updatedPost
      });
    } catch (error) {
      console.error('Error updating post:', error);
      res.status(500).json({ message: "Error updating post", error: error.message });
    }
  });
});

// Delete post
router.delete('/:postId', authJs, async (req, res) => {
  const { postId } = req.params;
  const { userId, isAdmin } = req.decoded;

  try {
    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // Check if user is admin or the post creator
    if (!isAdmin && post.createdBy.toString() !== userId) {
      return res.status(403).json({ message: "Not authorized to delete this post" });
    }

    // Delete images from Cloudinary
    if (post.images && post.images.length > 0) {
      const deletePromises = post.images.map(image => 
        cloudinary.uploader.destroy(image.publicId)
      );
      await Promise.all(deletePromises);
    }

    await Post.findByIdAndDelete(postId);
    
    // Invalidate cache
    postCache.keys().forEach(key => {
      if (key.startsWith('posts_')) {
        postCache.del(key);
      }
    });

    // Trigger Pusher event
    pusher.trigger('posts', 'post-deleted', {
      message: 'Post deleted',
      postId
    });

    res.status(200).json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error('Error deleting post:', error);
    res.status(500).json({ message: "Error deleting post", error: error.message });
  }
});

module.exports = router;