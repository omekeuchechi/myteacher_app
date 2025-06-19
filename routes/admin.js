const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authJs = require('../middlewares/auth');
const isSuperAdmin = require('../middlewares/isSuperAdmin');
const Pusher = require('pusher');
const User = require('../models/user');
const Course = require('../models/course');
const Enrollment = require('../models/enrollment');
const Transaction = require('../models/transaction');
const Message = require('../models/contactMessage');
const Asset = require('../models/asset');
// const Blog = require('../models/blog');

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

// Utility function to fetch all stats in parallel
async function getDashboardStats() {
  const [
    users,
    enrollments,
    transactions,
    messages,
    assets,
    // blogs
  ] = await Promise.all([
    User.countDocuments(),
    Enrollment.countDocuments(),
    Transaction.countDocuments(),
    Message.countDocuments(),
    Asset.countDocuments(),
    // Blog.countDocuments()
  ]);

  return { users, enrollments, transactions, messages, assets };
}

// Utility function to push stats update via Pusher
async function pushDashboardStats() {
  const stats = await getDashboardStats();
  pusher.trigger('admin-dashboard', 'stats-updated', stats);
}

// Dashboard stats route
router.get('/dashboard-stats', authJs, async (req, res) => {
  try {
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching dashboard stats', error: error.message });
  }
});

// api for adding course like this


// Add a new course (admin only)
router.post('/courses', authJs, async (req, res) => {
  const isAdmin = req.decoded && req.decoded.isAdmin;
  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin only" });
  }

  try {
    const { course, courseDescription, price, durationWeeks, courseIntructor, courseImage } = req.body;
    if (!course || !price || !durationWeeks) {
      return res.status(400).json({ message: "Course name, price, and durationWeeks are required" });
    }

    const newCourse = new Course({
      course,
      courseDescription,
      price,
      durationWeeks,
      courseIntructor,
      courseImage
    });

    const savedCourse = await newCourse.save();
    await pushDashboardStats();

    res.status(201).json({ message: "Course created successfully", course: savedCourse });
  } catch (error) {
    res.status(500).json({ message: "Error creating course", error: error.message });
  }
});

// Update a course (admin only)
router.patch('/courses/:id', authJs, async (req, res) => {
  const isAdmin = req.decoded && req.decoded.isAdmin;
  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin only" });
  }

  try {
    const courseId = req.params.id;
    const updateData = req.body;

    const updatedCourse = await Course.findByIdAndUpdate(courseId, updateData, { new: true });
    if (!updatedCourse) {
      return res.status(404).json({ message: "Course not found" });
    }

    await pushDashboardStats();

    res.json({ message: "Course updated successfully", course: updatedCourse });
  } catch (error) {
    res.status(500).json({ message: "Error updating course", error: error.message });
  }
});

// Delete a course (admin only)
router.delete('/courses/:id', authJs, async (req, res) => {
  const isAdmin = req.decoded && req.decoded.isAdmin;
  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin only" });
  }

  try {
    const courseId = req.params.id;
    const deletedCourse = await Course.findByIdAndDelete(courseId);
    if (!deletedCourse) {
      return res.status(404).json({ message: "Course not found" });
    }

    await pushDashboardStats();

    res.json({ message: "Course deleted successfully", course: deletedCourse });
  } catch (error) {
    res.status(500).json({ message: "Error deleting course", error: error.message });
  }
});

// Fetch all courses (public or admin only, remove authJs if public)
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    res.json({ courses });
  } catch (error) {
    res.status(500).json({ message: "Error fetching courses", error: error.message });
  }
});

// Fetch a single course by ID (public or admin only, remove authJs if public)
router.get('/courses/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.json({ course });
  } catch (error) {
    res.status(500).json({ message: "Error fetching course", error: error.message });
  }
});


// fetching all admins
router.get('/admins', authJs, async (req, res) => {
  const isAdmin = req.decoded && req.decoded.isAdmin;
  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin only" });
  }

  try {
    const admins = await User.find({ isAdmin: true }).select('-password');
    res.json({ admins });
  } catch (error) {
    res.status(500).json({ message: "Error fetching admins", error: error.message });
  }
});

// for deleting a particular api
router.delete('/admins/:id', authJs, async (req, res) => {
  const isAdmin = req.decoded && req.decoded.isAdmin;
  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin only" });
  }

  try {
    const adminId = req.params.id;
    const deletedAdmin = await User.findByIdAndDelete(adminId);
    if (!deletedAdmin) {
      return res.status(404).json({ message: "Admin not found" });
    }
    res.json({ message: "Admin deleted successfully", admin: deletedAdmin });
  } catch (error) {
    res.status(500).json({ message: "Error deleting admin", error: error.message });
  }
});

// api for suspending of admin
router.patch('/admins/suspend/:id', authJs, async (req, res) => {
  const isAdmin = req.decoded && req.decoded.isAdmin;
  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin only" });
  }

  try {
    const adminId = req.params.id;
    const updatedAdmin = await User.findByIdAndUpdate(adminId, { isSuspended: true }, { new: true });
    if (!updatedAdmin) {
      return res.status(404).json({ message: "Admin not found" });
    }
    res.json({ message: "Admin suspended successfully", admin: updatedAdmin });
  } catch (error) {
    res.status(500).json({ message: "Error suspending admin", error: error.message });
  }
});

// api for unsuspending of admin
router.patch('/admins/unsuspend/:id', authJs, async (req, res) => {
  try {
    // Verify admin privileges
    if (!req.decoded?.isAdmin) {
      return res.status(403).json({ 
        success: false,
        message: "Admin privileges required"
      });
    }

    // Validate ID format
    const adminId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid admin ID format"
      });
    }

    // Find and verify admin exists
    const admin = await User.findOne({ 
      _id: adminId,
      isAdmin: true 
    });
    
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin user not found"
      });
    }

    // Only proceed if admin is actually suspended
    if (!admin.isSuspended) {
      return res.status(400).json({
        success: false,
        message: "Admin is not currently suspended"
      });
    }

    const updatedAdmin = await User.findByIdAndUpdate(
      adminId,
      { isSuspended: false },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: "Admin unsuspended successfully",
      admin: updatedAdmin
    });
  } catch (error) {
    console.error('Error unsuspending admin:', error);
    res.status(500).json({
      success: false,
      message: "Error unsuspending admin",
      error: error.message
    });
  }
});

// this is to update to isSuperAdmin === true only isSuperAdmin can do this
router.patch('/make-super-admin/:userId', authJs, async (req, res) => {
  try {
    // Verify admin privileges
    if (!req.decoded?.isAdmin) {
      return res.status(403).json({ 
        success: false,
        message: "Admin privileges required"
      });
    }

    // Validate user ID
    const userId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid user ID format"
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "User not found"
      });
    }

    if (user.isSuperAdmin) {
      return res.status(400).json({ 
        success: false,
        message: "User is already a super admin"
      });
    }

    // Update user status directly
    user.isSuperAdmin = true;
    user.isAdmin = true;
    
    // Ensure required fields are set
    if (!user.userCourse) {
      user.userCourse = "default-course"; // Set a default value if required
    }

    const updatedUser = await user.save();

    // Trigger Pusher event
    pusher.trigger('user', 'made_super_admin', { user: updatedUser });

    return res.status(200).json({
      success: true,
      message: "User made super admin successfully",
      user: updatedUser
    });
  } catch (error) {
    console.error('Error making user super admin:', error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

// api for fetching super admin users
router.get('/super-admins', authJs, async (req, res) => {
  if (!req.decoded) {
    return res.status(401).json({ 
      success: false,
      message: "Authentication required" 
    });
  }
  
  if (!req.decoded.isAdmin) {
    return res.status(403).json({ 
      success: false,
      message: "Admin privileges required" 
    });
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const superAdminsQuery = User.find({ 
      isSuperAdmin: true 
    })
      .select('-password -__v')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const countQuery = User.countDocuments({ isSuperAdmin: true });

    const [superAdmins, total] = await Promise.all([
      superAdminsQuery.exec(),
      countQuery.exec()
    ]);

    res.json({
      success: true,
      data: {
        superAdmins,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      }
    });
  } catch (error) {
    console.error('Error fetching super admins:', error);
    res.status(500).json({ 
      success: false,
      message: "Error fetching super admins", 
      error: error.message 
    });
  }
});

// Export the pushDashboardStats function for use in other routes (e.g., user.js)
module.exports = { router, pushDashboardStats };