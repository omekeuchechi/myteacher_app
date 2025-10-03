const express = require('express');
const router = express.Router();
const multer = require('multer');
const authJs = require('../middlewares/auth');
const InstructorApplication = require('../models/instructorApplication');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /pdf|doc|docx/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
  }
}).single('resume');

// Middleware to handle file upload
const handleFileUpload = (req, res, next) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading
      return res.status(400).json({ success: false, message: err.message });
    } else if (err) {
      // An unknown error occurred
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
};

// Submit new instructor application
router.post('/create', handleFileUpload, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      message,
      linkedin,
      jobPosition,
      preferredStartDate,
      location
    } = req.body;

    // Parse location if it's a string
    const locationData = typeof location === 'string' ? JSON.parse(location) : location;

    // Create new application
    const application = new InstructorApplication({
      name,
      email,
      phone,
      message,
      linkedin: linkedin || undefined,
      jobPosition,
      preferredStartDate,
      location: locationData,
      status: 'pending',
      appliedAt: new Date()
    });

    // Handle file upload if exists
    if (req.file) {
      application.resume = {
        data: req.file.buffer,
        contentType: req.file.mimetype,
        fileName: req.file.originalname
      };
    }

    await application.save();

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: {
        applicationId: application._id
      }
    });
  } catch (error) {
    console.error('Error submitting application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit application',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all applications (protected route, add authentication middleware as needed)
router.get('/', authJs, async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};

    const isAdmin = req.decoded && req.decoded.isAdmin;
    if (!isAdmin) {
        return res.status(403).json({ message: "Unauthorized, admin only" });
    }
    
    if (status) {
      query.status = status;
    }

    const applications = await InstructorApplication.find(query)
      .sort({ appliedAt: -1 })
      .select('-resume.data'); // Don't include file data in list view

    res.json({
      success: true,
      count: applications.length,
      data: applications
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch applications',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all applications (public route)
router.get('/list', async (req, res) => {
  try {
    const applications = await InstructorApplication.find()
      .sort({ appliedAt: -1 })
      .select('-resume.data'); // Don't include file data in list view

    if (!applications) {
      return res.status(404).json({
        success: false,
        message: 'No applications found'
      });
    }

    res.json({
      success: true,
      count: applications.length,
      data: applications
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch applications',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get single application by ID
router.get('/get/:id', authJs, async (req, res) => {
  try {
    const application = await InstructorApplication.findById(req.params.id);

    const isAdmin = req.decoded && req.decoded.isAdmin;
    if (!isAdmin) {
        return res.status(403).json({ message: "Unauthorized, admin only" });
    }
    
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    res.json({
      success: true,
      data: application
    });
  } catch (error) {
    console.error('Error fetching application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch application',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update application status (protected route)
router.patch('/:id/status', authJs, async (req, res) => {
  try {
    const { status, notes } = req.body;

    const isAdmin = req.decoded && req.decoded.isAdmin;
    if (!isAdmin) {
        return res.status(403).json({ message: "Unauthorized, admin only" });
    }
    
    if (!['pending', 'reviewed', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    const updateData = {
      status,
      reviewedAt: new Date()
    };

    if (notes) {
      updateData.notes = notes;
    }

    const application = await InstructorApplication.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    res.json({
      success: true,
      message: 'Application status updated',
      data: application
    });
  } catch (error) {
    console.error('Error updating application status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update application status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Download resume
router.get('/:id/resume', async (req, res) => {
  try {
    const application = await InstructorApplication.findById(req.params.id);
    
    if (!application || !application.resume || !application.resume.data) {
      return res.status(404).json({
        success: false,
        message: 'Resume not found'
      });
    }

    res.set({
      'Content-Type': application.resume.contentType,
      'Content-Disposition': `attachment; filename="${application.resume.fileName || 'resume'}"`
    });

    res.send(application.resume.data);
  } catch (error) {
    console.error('Error downloading resume:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download resume',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
