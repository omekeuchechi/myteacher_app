const express = require('express');
const router = express.Router();
const Lecture = require('../models/lecture');
const Asset = require('../models/asset');
const Video = require('../models/video');
const isInstructor = require('../middlewares/isInstructor');
const pusher = require('../services/pusherService');
const authJs = require('../middlewares/auth');
const User = require('../models/user');
 
// Get count of lectures listed by instructor
const getLecturesCount = async (instructorId) => {
  return await Lecture.countDocuments({ lecturesListed: instructorId });
};

router.get('/lectures/count', authJs, async (req, res) => {
  try {
    const userId = req.decoded._id || req.decoded.userId;
    const isAdmin = req.decoded.isAdmin;
    
    if (!isAdmin) {
      return res.status(401).json({ message: "Unauthorized, admin only" });
    }
    
    if (!userId) {
      return res.status(401).json({ message: "Invalid token: user id missing" });
    }
    const count = await getLecturesCount(userId);
    
    // Trigger Pusher event
    pusher.trigger(`instructor-${userId}`, 'lectures-count-updated', {
      count
    });
    
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Error counting lectures", error: error.message });
  }
});

// get and count all the asset the user have upload
const getAssetsCount = async (instructorId) => {
  return await Asset.countDocuments({ uploadedBy: instructorId });
};

router.get('/assets/count', authJs, async (req, res) => {
  try {
    const userId = req.decoded._id || req.decoded.userId;
    const isAdmin = req.decoded.isAdmin;


    if (!isAdmin) {
      return res.status(401).json({ message: "Unauthorized, admin only" });
    }

    if (!userId) {
      return res.status(401).json({ message: "Invalid token: user id missing" });
    }
    const count = await getAssetsCount(userId);
    
    // Trigger Pusher event
    pusher.trigger(`instructor-${userId}`, 'assets-count-updated', {
      count
    });
    
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Error counting assets", error: error.message });
  }
});


// get and count all the video the user have upload

const getVideosCount = async (instructorId) => {
  return await Video.countDocuments({ uploadedBy: instructorId });
};

router.get('/videos/count', authJs, async (req, res) => {
  try {

    const userId = req.decoded._id || req.decoded.userId;
    const isAdmin = req.decoded.isAdmin;
    
    if (!isAdmin) {
      return res.status(401).json({ message: "Unauthorized, admin only" });
    }
    
    if (!userId) {
      return res.status(401).json({ message: "Invalid token: user id missing" });
    }    
    const count = await getVideosCount(userId);
    
    // Trigger Pusher event
    pusher.trigger(`instructor-${userId}`, 'videos-count-updated', {
      count
    });
    
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Error counting videos", error: error.message });
  }
});

// Helper function to refresh all counts for an instructor
const refreshAllCounts = async (instructorId) => {
  try {
    const [lecturesCount, assetsCount, videosCount] = await Promise.all([
      getLecturesCount(instructorId),
      getAssetsCount(instructorId),
      getVideosCount(instructorId)
    ]);

    pusher.trigger(`instructor-${instructorId}`, 'all-counts-updated', {
      lecturesCount,
      assetsCount,
      videosCount
    });
  } catch (error) {
    console.error('Error refreshing counts:', error);
  }
};


// api to fetch all the instructor lectures if the userid matched in lecturesListed: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

router.get('/view-lectures', authJs, async (req, res) => {
  try {
    const userId = req.decoded._id || req.decoded.userId;
    const isAdmin = req.decoded.isAdmin;
    
    if (!isAdmin) {
      return res.status(401).json({ message: "Unauthorized, admin only" });
    }
    
    if (!userId) {
      return res.status(401).json({ message: "Invalid token: user id missing" });
    }
    const lectures = await Lecture.find({ lecturesListed: userId });
    res.json(lectures);
  } catch (error) {
    res.status(500).json({ message: "Error fetching lectures", error: error.message });
  }
});


// get all user name by _id
// In your backend route
router.post('/particular-students', authJs, async (req, res) => {
  try {
    const isAdmin = req.decoded.isAdmin;
    
    if (!isAdmin) {
      return res.status(401).json({ message: "Unauthorized, admin only" });
    }

    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds)) {
      return res.status(400).json({ message: "Invalid studentIds" });
    }

    const students = await User.find({ _id: { $in: studentIds } }, 'name email');
    res.json({ students });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching students' });
  }
});

module.exports = { router, refreshAllCounts };