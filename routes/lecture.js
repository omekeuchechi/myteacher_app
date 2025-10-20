const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authJs = require('../middlewares/auth');
const Course = require('../models/course');
const Enrollment = require('../models/enrollment');
const User = require('../models/user');
const Lecture = require('../models/lecture');
const isSuperAdmin = require('../middlewares/isSuperAdmin');
const isInstructor = require('../middlewares/isInstructor');
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

    const currentDate = new Date();
    const twoHoursAgo = new Date(currentDate.getTime() - (2 * 60 * 60 * 1000));
    const oneWeekFromNow = new Date(currentDate.getTime() + (7 * 24 * 60 * 60 * 1000));
    const minDurationHours = 2; // Minimum 2 hours duration
    
    console.log(`Fetching lectures for user ${userId} at ${currentDate}`);
    console.log(`Looking for lectures between: ${twoHoursAgo} and ${oneWeekFromNow}`);

    // Find lectures where:
    // 1. User is enrolled
    // 2. Lecture hasn't expired (expiringDate > now)
    // 3. Lecture starts within the next week
    // 4. Lecture has at least 2 hours duration
    const lectures = await Lecture.aggregate([
      {
        $match: {
          studentsEnrolled: new mongoose.Types.ObjectId(userId),
          expiringDate: { $gt: currentDate },
          startTime: { 
            $gt: twoHoursAgo,
            $lt: oneWeekFromNow // Don't show lectures starting more than a week from now
          },
          $expr: {
            // Ensure lecture duration is at least 2 hours
            $gte: [
              { $dateDiff: { startDate: "$startTime", endDate: "$expiringDate", unit: "hour" } },
              minDurationHours
            ]
          }
        }
      },
      {
        $sort: { startTime: 1 }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'lecturesListed',
          foreignField: '_id',
          as: 'lecturesListed'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'studentsEnrolled',
          foreignField: '_id',
          as: 'studentsEnrolled'
        }
      }
    ]);

    // Add debug logging for each lecture
    console.log(`Found ${lectures.length} active lectures:`);
    lectures.forEach(lecture => {
      const durationHours = (new Date(lecture.expiringDate) - new Date(lecture.startTime)) / (1000 * 60 * 60);
      console.log(`- ${lecture.title} (ID: ${lecture._id})`);
      console.log(`  Start: ${lecture.startTime}, Expires: ${lecture.expiringDate}`);
      console.log(`  Duration: ${durationHours.toFixed(1)} hours`);
      console.log(`  Current time: ${currentDate}`);
      console.log(`  Is expired: ${lecture.expiringDate <= currentDate ? 'YES' : 'NO'}`);
      console.log(`  Is upcoming: ${lecture.startTime > currentDate ? 'YES' : 'NO'}`);
    });
    
    res.json({ lectures });
  } catch (error) {
    console.error('Error in userSpecificLecture:', error);
    res.status(500).json({ 
      message: "Error fetching user-specific lectures", 
      error: error.message 
    });
  }
});

// api for user to logout from the lecture batch studentsEnrolled: studentIds, using patch
router.patch('/logout/:lectureId', authJs, async (req, res) => {
  try {
    const { lectureId } = req.params;
    const userId = req.decoded.userId;
    const lecture = await Lecture.findById(lectureId);
    if (!lecture) {
      return res.status(404).json({ message: "Lecture not found" });
    }
    const studentIds = lecture.studentsEnrolled;
    const index = studentIds.indexOf(userId);
    if (index > -1) {
      studentIds.splice(index, 1);
    }
    await lecture.save();
    res.json({ message: "User logged out from lecture batch" });
  } catch (error) {
    res.status(500).json({ message: "Error logging out from lecture batch", error: error.message });
  }
});


// Admin creates a lecture batch
router.post('/create-lecture-batch', authJs,  async (req, res) => {
  const isAdmin = req.decoded && req.decoded.isAdmin;

  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin or instructor only" });
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
      studentsEnrolled: studentIds,
      createdBy: req.decoded.userId  // Track who created the batch
    });

    const savedLecture = await lecture.save();

    // Get the admin who created this batch
    const creatingAdmin = await User.findById(req.decoded.userId);
    
    if (creatingAdmin) {
      // Send email only to the admin who created the batch
      await sendEmail({
        to: creatingAdmin.email,
        subject: 'Lecture Batch Created Successfully',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Lecture Batch Created</h2>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <p style="font-size: 16px;">Hello ${creatingAdmin.name},</p>
            <p>You have successfully created a new lecture batch:</p>
            <h3 style="color: #3498db; margin: 15px 0;">${course.course}</h3>
            
            <div style="margin: 20px 0;">
              <p><strong>Start Time:</strong> ${new Date(startTime).toLocaleString()}</p>
              <p><strong>Platform:</strong> ${platform}</p>
              <p><strong>Total Students Enrolled:</strong> ${studentIds.length}</p>
              <p><strong>Assigned Admins:</strong> ${admins.map(a => a.name).join(', ')}</p>
              ${finalZoomLink ? `<p><strong>Join Link:</strong> <a href="${finalZoomLink}">Click here to join</a></p>` : ''}
            </div>
          </div>
          
          <p style="text-align: center; color: #7f8c8d;">
            You can manage this batch from your admin dashboard.<br>
            <a href="${process.env.CLIENT_URL}/admin/lectures" style="color: #3498db; text-decoration: none;">Go to Admin Dashboard</a>
          </p>
        </div>
        `
      });
    }

    res.status(201).json({ 
      message: "Lecture batch created successfully", 
      lecture: savedLecture,
      studentsEnrolled: studentIds.length,
      adminsNotified: creatingAdmin ? 1 : 0
    });
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
router.patch('/update-lecture/:lectureId', authJs, async (req, res) => {
  const isAdmin = req.decoded && req.decoded.isAdmin;

  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin only" });
  }

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

/**
 * @route   DELETE /:id
 * @desc    Delete a lecture by ID
 * @access  Protected (requires authJs middleware)
 */
router.delete('/:id', authJs, async (req, res) => {
  try {
    const lecture = await Lecture.findByIdAndDelete(req.params.id);
    
    if (!lecture) {
      return res.status(404).json({ 
        success: false,
        message: 'Lecture not found' 
      });
    }
    
    // If there's a linked batch, update or delete it as needed
    if (lecture.linkedBatch) {
      await UpcomingLectureBatch.findOneAndDelete({ linkedLecture: lecture._id });
    }

    res.json({ 
      success: true,
      message: 'Lecture deleted successfully' 
    });
    
  } catch (error) {
    console.error('Error deleting lecture:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error deleting lecture',
      error: error.message 
    });
  }
});

module.exports = router;
