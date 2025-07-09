const express = require('express');
const router = express.Router();
const Video = require('../models/video');
const User = require('../models/user');
const authJs = require('../middlewares/auth');
const pusher = require('../services/pusherService');

// Middleware to parse JSON request bodies
router.use(express.json());

// Create a new video
router.post('/create', authJs, async (req, res) => {
  try {
    const isAdmin = req.decoded && req.decoded.isAdmin;
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized, admin only' });
    }
    const { lecture, videoLink, description } = req.body;
    const createdBy = req.user?._id || req.user?.id || req.user;
    const video = new Video({ lecture, videoLink, description, createdBy });
    await video.save();
    
    // Populate the video with lecture and createdBy details for the real-time update
    const populatedVideo = await Video.findById(video._id)
      .populate('lecture')
      .populate('createdBy');
      
    // Trigger Pusher event with minimal data
    const pusherPayload = {
      video: {
        _id: populatedVideo._id,
        lecture: populatedVideo.lecture?._id || populatedVideo.lecture,
        videoLink: populatedVideo.videoLink,
        description: populatedVideo.description,
        createdBy: populatedVideo.createdBy?._id || populatedVideo.createdBy,
        createdAt: populatedVideo.createdAt
      },
      message: 'New video has been added!'
    };
    
    pusher.trigger('videos', 'created', pusherPayload)
      .catch(error => console.error('Pusher error:', error));
    
    res.status(201).json({ success: true, video: populatedVideo });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Get all videos
router.get('/', authJs, async (req, res) => {
  try {
    const userId = req.decoded && req.decoded.userId;
    // const isAdmin = req.decoded && req.decoded.isAdmin;
    if (!userId) {
      return res.status(403).json({ success: false, message: 'user not found' });
    }
    const videos = await Video.find().populate('lecture').populate('createdBy');
    // Don't trigger Pusher event for fetching all videos as it could be large
    // Instead, let clients fetch the data via the API
    res.status(200).json({ success: true, videos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update a video
router.patch('/:id', authJs, async (req, res) => {
  try {
    const isAdmin = req.decoded && req.decoded.isAdmin;
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized, admin only' });
    }
    const { videoLink, description } = req.body;
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { videoLink, description },
      { new: true, runValidators: true }
    );
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    // Trigger update with minimal data
    const updatePayload = {
      video: {
        _id: video._id,
        videoLink: video.videoLink,
        description: video.description,
        updatedAt: video.updatedAt
      }
    };
    pusher.trigger('video', 'updated', updatePayload)
      .catch(error => console.error('Pusher error:', error));
    res.status(200).json({ success: true, video });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Delete a video
router.delete('/:id', authJs, async (req, res) => {
  try {
    const isAdmin = req.decoded && req.decoded.isAdmin;
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized, admin only' });
    }
    const video = await Video.findByIdAndDelete(req.params.id);
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    // Only send the video ID for delete events
    pusher.trigger('video', 'deleted', { videoId: video._id })
      .catch(error => console.error('Pusher error:', error));
    res.status(200).json({ success: true, message: 'Video deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add a comment to a video
router.post('/:id/comment', authJs, async (req, res) => {
  try {
    const { text } = req.body;
    const user = req.user?._id || req.user?.id || req.user;
    if (!text) return res.status(400).json({ success: false, message: 'Comment text is required' });
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    const comment = { user, text, createdAt: new Date(), edited: false };
    video.comment.push(comment);
    await video.save();
    // Trigger comment created with minimal data
    const commentPayload = {
      videoId: video._id,
      comment: {
        _id: comment._id,
        user: comment.user,
        text: comment.text,
        createdAt: comment.createdAt,
        edited: comment.edited
      }
    };
    pusher.trigger('video', 'comment_created', commentPayload)
      .catch(error => console.error('Pusher error:', error));
    res.status(201).json({ success: true, video });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Reply to a comment on a video
router.post('/:id/reply', authJs, async (req, res) => {
  try {
    const { commentId, text } = req.body;
    const user = req.user?._id || req.user?.id || req.user;
    if (!commentId || !text) return res.status(400).json({ success: false, message: 'commentId and text are required' });
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    // Ensure the comment exists
    const commentExists = video.comment.id(commentId) || video.comment.some(c => c._id.toString() === commentId);
    if (!commentExists) return res.status(404).json({ success: false, message: 'Comment not found' });
    const reply = { commentId, user, text, createdAt: new Date(), edited: false };
    video.replyComment.push(reply);
    await video.save();
    // Trigger reply created with minimal data
    const replyPayload = {
      videoId: video._id,
      reply: {
        _id: reply._id,
        commentId: reply.commentId,
        user: reply.user,
        text: reply.text,
        createdAt: reply.createdAt,
        edited: reply.edited
      }
    };
    pusher.trigger('video', 'reply_created', replyPayload)
      .catch(error => console.error('Pusher error:', error));
    res.status(201).json({ success: true, video });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Edit a comment (only once)
router.patch('/:videoId/comment/:commentId', authJs, async (req, res) => {
  try {
    const { text } = req.body;
    const user = req.user?._id || req.user?.id || req.user;
    const video = await Video.findById(req.params.videoId);
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    const comment = video.comment.id(req.params.commentId) || video.comment.find(c => c._id.toString() === req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });
    if (comment.user.toString() !== user.toString()) return res.status(403).json({ success: false, message: 'Unauthorized' });
    if (comment.edited) return res.status(403).json({ success: false, message: 'Comment can only be edited once' });
    comment.text = text;
    comment.edited = true;
    await video.save();
    // Trigger comment edited with minimal data
    pusher.trigger('video', 'comment_edited', { 
      videoId: video._id, 
      commentId: comment._id,
      text: comment.text,
      edited: comment.edited
    }).catch(error => console.error('Pusher error:', error));
    res.status(200).json({ success: true, video });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Edit a reply (only once)
router.patch('/:videoId/reply/:replyId', authJs, async (req, res) => {
  try {
    const { text } = req.body;
    const user = req.user?._id || req.user?.id || req.user;
    const video = await Video.findById(req.params.videoId);
    if (!video) return res.status(404).json({ success: false, message: 'Video not found' });
    const reply = video.replyComment.id(req.params.replyId) || video.replyComment.find(r => r._id.toString() === req.params.replyId);
    if (!reply) return res.status(404).json({ success: false, message: 'Reply not found' });
    if (reply.user.toString() !== user.toString()) return res.status(403).json({ success: false, message: 'Unauthorized' });
    if (reply.edited) return res.status(403).json({ success: false, message: 'Reply can only be edited once' });
    reply.text = text;
    reply.edited = true;
    await video.save();
    // Trigger reply edited with minimal data
    pusher.trigger('video', 'reply_edited', { 
      videoId: video._id, 
      replyId: reply._id,
      text: reply.text,
      edited: reply.edited
    }).catch(error => console.error('Pusher error:', error));
    res.status(200).json({ success: true, video });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Get multiple users by their IDs
router.get('/users', authJs, async (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) {
      return res.status(400).json({ success: false, message: 'User IDs are required' });
    }
    
    const userIds = ids.split(',');
    const users = await User.find({ _id: { $in: userIds } }).select('-password');
    
    res.status(200).json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get a single user by ID
router.get('/user/:userId', authJs, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }
    
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
