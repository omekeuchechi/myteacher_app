const express = require('express');
const router = express.Router();
const authJs = require('../middlewares/auth');
const Course = require('../models/course');
const Enrollment = require('../models/enrollment');
const User = require('../models/user');
const Lecture = require('../models/lecture');
const isSuperAdmin = require('../middlewares/isSuperAdmin');
const sendEmail = require('../lib/sendEmail');
const { createZoomMeeting } = require('../lib/zoom');

// GET /api/v1/lecture/lectures
router.get('/lectures', authJs, async (req, res) => {
  try {
    const lectures = await Lecture.find().populate('lecturesListed studentsEnrolled');
    res.json({ lectures });
  } catch (error) {
    res.status(500).json({ message: "Error fetching lectures", error: error.message });
  }
});

// GET /api/v1/lecture/admins
router.get('/admins', authJs, async (req, res) => {
  try {
    const admins = await User.find({ isAdmin: true }, '_id name email');
    res.json({ admins });
  } catch (error) {
    res.status(500).json({ message: "Error fetching admins", error: error.message });
  }
});

/**
 * @route   GET /userSpecificLecture
 * @desc    Fetch all non-expired lectures that the current user is enrolled in
 * @access  Protected (requires authJs middleware)
 */
router.get('/userSpecificLecture', authJs, async (req, res) => {
  try {
    const userId = req.decoded.userId;
    if (!userId) {
      return res.status(401).json({ message: "Invalid token: user id missing" });
    }

    // Find non-expired lectures where the user is in studentsEnrolled array
    const currentDate = new Date();
    const lectures = await Lecture.find({ 
      studentsEnrolled: userId,
      expiringDate: { $gt: currentDate } // Only include lectures that haven't expired
    }).populate('lecturesListed studentsEnrolled');

    res.json({ lectures });
    console.log(`User ${userId} fetched their active lectures`);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user-specific lectures", error: error.message });
  }
});

// Admin creates a lecture batch
router.post('/create-lecture-batch', authJs, isSuperAdmin, async (req, res) => {
  const isAdmin = req.decoded && req.decoded.isAdmin;
  const isUserSuperAdmin = req.decoded.isSuperAdmin;
  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin only" });
  }

  if (!isUserSuperAdmin) {
    return res.status(403).json({ message: "Unauthorized, super admin only" });
  }

  try {
    const {
      courseId,
      startTime,
      platform,
      zoomLink, // keep for non-Zoom platforms
      topics,
      adminIds, // Expecting an array of admin User IDs
      jitsiPassword,
      isVerified,
      verificationToken
    } = req.body;

    // Validate startTime is in future
    const startDate = new Date(startTime);
    const now = new Date();
    if (startDate <= now) {
      return res.status(400).json({ 
        success: false,
        message: "Start time must be in the future"
      });
    }

    // Get course info
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // If platform is Zoom, create a Zoom meeting using Server-to-Server OAuth
    let finalZoomLink = zoomLink;
    if (platform && platform.toLowerCase() === 'zoom') {
      const zoomMeeting = await createZoomMeeting(course.course, startTime);
      finalZoomLink = zoomMeeting.join_url;
    }

    // Calculate expiringDate using durationWeeks
    const durationWeeks = course.durationWeeks || 1; // Default to 1 week if not specified
    const start = new Date(startTime);
    const expiringDate = new Date(start.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    // Find all enrollments for this course
    const enrollments = await Enrollment.find({ courseId });

    // Get all unique userIds from enrollments
    const studentIds = [...new Set(enrollments.map(e => e.userId.toString()))];

    // Check all admins exist and are admins
    const admins = await User.find({ _id: { $in: adminIds } });
    if (admins.length !== adminIds.length || admins.some(a => !a.isAdmin)) {
      return res.status(400).json({ message: "One or more assigned admins not found or not an admin" });
    }

    // Create lecture batch
    const lecture = new Lecture({
      title: course.course,
      courseId,
      startTime: new Date(startTime), // Ensure startTime is a Date object
      platform,
      zoomLink: finalZoomLink,
      topics,
      jitsiPassword,
      isVerified,
      verificationToken,
      expiringDate,
      lecturesListed: adminIds,
      studentsEnrolled: studentIds
    });

    const savedLecture = await lecture.save();

    // Send email to each assigned admin
    for (const admin of admins) {
      await sendEmail({
        to: admin.email,
        subject: 'You have been assigned to a new lecture batch',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">New Lecture Batch Assignment</h2>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
                <p style="font-size: 16px;">Hello ${admin.name},</p>
                <p>You have been assigned as an admin to the lecture batch:</p>
                
                <h3 style="color: #3498db; margin: 15px 0;">${course.course}</h3>
                
                <div style="margin: 20px 0;">
                    <p><strong>Start Time:</strong> ${new Date(startTime).toLocaleString()}</p>
                    <p><strong>Platform:</strong> ${platform}</p>
                    ${finalZoomLink ? `<p><strong>Join Link:</strong> <a href="${finalZoomLink}">Click here to join</a></p>` : ''}
                </div>
            </div>
            
            <p style="text-align: center; color: #7f8c8d;">
                Please prepare your materials and be ready for the session.<br>
                <a href="${process.env.CLIENT_URL}" style="color: #3498db; text-decoration: none;">Access MyTeacher Dashboard</a>
            </p>
        </div>
        `
      });
    }

    // Send email to each student
    const students = await User.find({ _id: { $in: studentIds } });
    for (const student of students) {
      await sendEmail({
        to: student.email,
        subject: 'You have been added to a new lecture batch',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Lecture Enrollment Notification</h2>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
                <p style="font-size: 16px;">Hello ${student.name},</p>
                <p>You have been enrolled in a new lecture batch:</p>
                
                <h3 style="color: #3498db; margin: 15px 0;">${course.course}</h3>
                
                <div style="margin: 20px 0;">
                    <p><strong>Start Time:</strong> ${new Date(startTime).toLocaleString()}</p>
                    <p><strong>Platform:</strong> ${platform}</p>
                    ${finalZoomLink ? `<p><strong>Join Link:</strong> <a href="${finalZoomLink}">Click here to join</a></p>` : ''}
                </div>
            </div>
            
            <p style="text-align: center; color: #7f8c8d;">
                We look forward to seeing you in class!<br>
                <a href="${process.env.CLIENT_URL}" style="color: #3498db; text-decoration: none;">Visit MyTeacher</a>
            </p>
        </div>
        `
      });
    }

    res.status(201).json({ message: "Lecture batch created", lecture: savedLecture, studentsAdded: students.length });
  } catch (error) {
    console.error("Error creating lecture batch:", error);
    res.status(500).json({ message: "Error creating lecture batch", error: error.message });
  }
});

// Fetch a specific lecture by ID
router.get('/lectures/:lectureId', authJs, async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.lectureId).populate('lecturesListed studentsEnrolled');
    if (!lecture) {
      return res.status(404).json({ message: "Lecture not found" });
    }
    res.json({ lecture });
  } catch (error) {
    res.status(500).json({ message: "Error fetching lecture", error: error.message });
  }
});

// Admin updates a lecture batch
router.patch('/update-lecture/:lectureId', authJs, isSuperAdmin, async (req, res) => {
  // Authorization checks (isAdmin, isSuperAdmin) are already handled by the middlewares
  try {
    const { lectureId } = req.params;
    const updateData = req.body;

    // Validate startTime is in future if being updated
    if (updateData.startTime) {
      const startDate = new Date(updateData.startTime);
      const now = new Date();
      if (startDate <= now) {
        return res.status(400).json({ 
          success: false,
          message: "Start time must be in the future"
        });
      }
    }

    // If lecturesListed is provided, validate admin IDs
    if (updateData.lecturesListed) {
      const admins = await User.find({ _id: { $in: updateData.lecturesListed } });
      if (admins.length !== updateData.lecturesListed.length || admins.some(a => !a.isAdmin)) {
        return res.status(400).json({ message: "One or more assigned admins not found or not an admin" });
      }
    }

    const lecture = await Lecture.findByIdAndUpdate(lectureId, updateData, { new: true });
    if (!lecture) {
      return res.status(404).json({ message: "Lecture not found" });
    }

    res.json({ message: "Lecture batch updated", lecture });
  } catch (error) {
    res.status(500).json({ message: "Error updating lecture batch", error: error.message });
  }
});

// GET route to get a meeting join URL (for students and assigned admins)
router.get('/start-meeting/:lectureId', authJs, async (req, res) => {
  try {
    const { lectureId } = req.params;
    const lecture = await Lecture.findById(lectureId).populate('lecturesListed');
    if (!lecture) {
      return res.status(404).json({ message: "Lecture not found" });
    }
    if (!lecture.zoomLink) {
      return res.status(400).json({ message: "No meeting link available for this lecture." });
    }

    const userId = req.decoded.userId; // Assuming authJs populates req.decoded.userId
    const isAssignedAdmin = lecture.lecturesListed.some(admin => admin._id.toString() === userId);
    const isEnrolledStudent = lecture.studentsEnrolled.map(id => id.toString()).includes(userId);

    if (!isAssignedAdmin && !isEnrolledStudent) {
      return res.status(403).json({ message: "You are not authorized to join this meeting." });
    }

    res.json({ joinUrl: lecture.zoomLink });
  } catch (error) {
    res.status(500).json({ message: "Error retrieving meeting link", error: error.message });
  }
});

// Get all lectures for a specific user
router.get('/user/:userId', authJs, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Find all lectures where the user is either a student or an admin
    const currentDate = new Date();
    const lectures = await Lecture.find({
      $or: [
        { studentsEnrolled: userId },
        { lecturesListed: userId }
      ],
      expiringDate: { $gt: currentDate } // Only include non-expired lectures
    })
    .populate('lecturesListed', 'name email') // Populate admin details
    .populate('studentsEnrolled', 'name email') // Populate student details
    .populate('courseId', 'course description'); // Populate course details
    
    res.json({ 
      success: true, 
      count: lectures.length,
      lectures 
    });
    
  } catch (error) {
    console.error('Error fetching user lectures:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching user lectures',
      error: error.message 
    });
  }
});

module.exports = router;
