const express = require('express');
const router = express.Router();
const multer = require('multer');
const authJs = require('../middlewares/auth');
const InstructorApplication = require('../models/instructorApplication');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sendEmail = require('../lib/sendEmail');
// Simple NIN validation function
function isValidNIN(nin) {
  // NIN should be 11 digits
  const ninRegex = /^\d{11}$/;
  return ninRegex.test(nin);
}

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
      nin,
      message,
      linkedin,
      jobPosition,
      preferredStartDate,
      location
    } = req.body;

    // Parse location if it's a string
    const locationData = typeof location === 'string' ? JSON.parse(location) : location;

    // NIN validation 
    const isNinValid = isValidNIN(nin);
    if (!isNinValid) {
      return res.status(400).json({ success: false, message: 'Invalid NIN' });
    }

    // Create new application
    const application = new InstructorApplication({
      name,
      email,
      phone,
      nin,
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
    sendEmail({
      to: email,
      subject: 'Thank you for your application',
      html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);">
        <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://myteacher.institute/assets/Untitled-1-DN2sZebx.png" alt="MyTeacher App Logo" style="max-width: 200px; height: auto; margin-bottom: 20px;">
            <h1 style="color: #2c3e50; margin-bottom: 25px; font-size: 28px;">Hi ${name},</h1>
        </div>
        
        <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px; line-height: 1.6; color: #495057;">
            <p style="margin-bottom: 15px; font-size: 16px;">Thank you for submitting your application to become an instructor on MyTeacher App. We're excited to review your qualifications and experience.</p>
            
            <p style="margin-bottom: 15px; font-size: 16px;">Our team will carefully evaluate your application, and you can expect to hear back from us within 5-7 business days. We appreciate your patience during this process.</p>
            
            <p style="margin-bottom: 15px; font-size: 16px;">In the meantime, feel free to explore our platform and get familiar with our teaching resources and community guidelines.</p>
        </div>
        
        <div style="text-align: center; color: #6c757d; font-size: 14px; border-top: 1px solid #e9ecef; padding-top: 20px;">
            <p style="margin: 5px 0;">Best regards,</p>
            <p style="margin: 5px 0; font-weight: 600; color: #2c3e50;">The MyTeacher App Team</p>
            <p style="margin: 5px 0;">
                <a href="https://myteacher.institute" style="color: #3498db; text-decoration: none;">Visit Our Website</a> | 
                <a href="mailto:myteacheronlineclass1@gmail.com" style="color: #3498db; text-decoration: none; margin-left: 10px;">Contact Support</a>
            </p>
            <p style="margin: 15px 0 0; font-size: 12px; color: #adb5bd;">
                © ${new Date().getFullYear()} MyTeacher Institute. All rights reserved.
            </p>
        </div>
    </div>
      `
    });

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

    if (status === 'accepted') {
      // Send email notification to the applicant
    sendEmail({
      to: application.email,
      subject: 'Congratulations! Your Instructor Application Has Been Accepted',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://myteacher.institute/assets/Untitled-1-DN2sZebx.png" alt="MyTeacher App" style="max-width: 200px; height: auto; margin-bottom: 20px;">
            <h1 style="color: #2c3e50; margin-bottom: 25px; font-size: 28px;">Hi ${application.name},</h1>
          </div>
          
          <div style="background-color: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px; line-height: 1.6; color: #495057;">
            <p style="margin-bottom: 15px; font-size: 16px;">🎉 <strong>Great news!</strong> Your application to become an instructor on MyTeacher App has been accepted. We're thrilled to welcome you to our team of talented educators!</p>

            <div style="margin-bottom: 15px; font-size: 16px;">
              <p style="margin-bottom: 15px; font-size: 16px;">Copy this passcode below and paste it in an iNput called "pass Code" to grant access to create your instructor account</p>
              <p style="margin-bottom: 15px; font-size: 16px; color: blue;">${req.params.id}</p>
            </div>
            
            <p style="margin-bottom: 15px; font-size: 16px;">To get started, please follow these simple steps:</p>
            <ol style="margin-left: 20px; margin-bottom: 20px; padding-left: 15px;">
              <li style="margin-bottom: 10px;">Visit <a href="https://myteacher.institute/instructorAuth" style="color: #3498db; text-decoration: none; font-weight: 500;">myteacher.institute/instructorAuth</a> to create your instructor account</li>
              <li style="margin-bottom: 10px;">Complete your profile setup</li>
              <li>Start creating and publishing your courses</li>
            </ol>

            <p style="margin-bottom: 15px; font-size: 16px;">If you already have an account, simply log in to access your instructor dashboard.</p>
          </div>
          
          <div style="text-align: center; margin-bottom: 20px;">
            <a href="https://myteacher.institute/login" style="display: inline-block; background-color: #3498db; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: 500; margin: 10px 0;">Go to Dashboard</a>
          </div>

          <div style="text-align: center; color: #6c757d; font-size: 14px; border-top: 1px solid #e9ecef; padding-top: 20px;">
            <p style="margin: 5px 0;">Need help? We're here for you!</p>
            <p style="margin: 5px 0; color: #2c3e50;">
              <a href="mailto:myteacheronlineclass1@gmail.com" style="color: #3498db; text-decoration: none; margin: 0 10px;">Email Support</a>
              <span>|</span>
              <a href="https://myteacher.institute/help" style="color: #3498db; text-decoration: none; margin: 0 10px;">Help Center</a>
            </p>
            <p style="margin: 15px 0 0; font-size: 12px; color: #adb5bd;">
              © ${new Date().getFullYear()} MyTeacher Institute. All rights reserved.
            </p>
          </div>
        </div>
      `
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


// for deleting
router.delete('/deleteApplication/:id', authJs, async (req, res) => {
  try {
    const application = await InstructorApplication.findByIdAndDelete(req.params.id);
    
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    res.json({
      success: true,
      message: 'Application deleted successfully',
      data: application
    });
  } catch (error) {
    console.error('Error deleting application:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete application',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
