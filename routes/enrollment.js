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

// Fetch all admin users for select input
// router.get('/admins', authJs, async (req, res) => {
//   try {
//     const admins = await User.find({ isAdmin: true }, '_id name email');
//     res.json({ admins });
//   } catch (error) {
//     res.status(500).json({ message: "Error fetching admins", error: error.message });
//   }
// });

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
      adminIds,
      jitsiPassword,
      isVerified,
      verificationToken
    } = req.body;
    
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
    const durationWeeks = course.durationWeeks || 1;
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
      startTime: new Date(startTime),
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
        html: `<p>Hello ${admin.name},<br>You have been assigned as an admin to the lecture batch: <b>${course.course}</b> starting at ${new Date(startTime).toLocaleString()}.</p>`
      });
    }

    // Send email to each student
    const students = await User.find({ _id: { $in: studentIds } });
    for (const student of students) {
      await sendEmail({
        to: student.email,
        subject: 'You have been added to a lecture batch',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Lecture Enrollment</h2>
          
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
    console.error(error);
    res.status(500).json({ message: "Error creating lecture batch", error: error.message });
  }
});

// Fetch all lectures
// router.get('/lectures', authJs, async (req, res) => {
//   try {
//     const lectures = await Lecture.find().populate('lecturesListed studentsEnrolled');
//     res.json({ lectures });
//   } catch (error) {
//     res.status(500).json({ message: "Error fetching lectures", error: error.message });
//   }
// });

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
  const isAdmin = req.decoded && req.decoded.isAdmin;
  const isUserSuperAdmin = req.decoded.isSuperAdmin;
  if (!isAdmin) {
    return res.status(403).json({ message: "Unauthorized, admin only" });
  }

  if (!isUserSuperAdmin) {
    return res.status(403).json({ message: "Unauthorized, super admin only" });
  }

  try {
    const { lectureId } = req.params;
    const {
      startTime,
      platform,
      zoomLink,
      topics,
      lecturesListed, // <-- Accept an array of admin IDs
      jitsiPassword,
      isVerified,
      verificationToken
    } = req.body;

    // Find the lecture
    const lecture = await Lecture.findById(lectureId);
    if (!lecture) {
      return res.status(404).json({ message: "Lecture not found" });
    }

    // If lecturesListed is provided, validate all admin IDs
    if (lecturesListed) {
      const admins = await User.find({ _id: { $in: lecturesListed } });
      if (admins.length !== lecturesListed.length || admins.some(a => !a.isAdmin)) {
        return res.status(400).json({ message: "One or more assigned admins not found or not an admin" });
      }
      lecture.lecturesListed = lecturesListed;
    }

    // Update other fields if provided
    if (startTime) lecture.startTime = startTime;
    if (platform) lecture.platform = platform;
    if (zoomLink) lecture.zoomLink = zoomLink;
    if (topics) lecture.topics = topics;
    if (jitsiPassword !== undefined) lecture.jitsiPassword = jitsiPassword;
    if (isVerified !== undefined) lecture.isVerified = isVerified;
    if (verificationToken !== undefined) lecture.verificationToken = verificationToken;

    await lecture.save();

    res.json({ message: "Lecture batch updated", lecture });
  } catch (error) {
    res.status(500).json({ message: "Error updating lecture batch", error: error.message });
  }
});

router.get('/start-meeting/:lectureId', authJs, async (req, res) => {
  try {
    const { lectureId } = req.params;
    const lecture = await Lecture.findById(lectureId);
    if (!lecture) {
      return res.status(404).json({ message: "Lecture not found" });
    }
    if (!lecture.zoomLink) {
      return res.status(400).json({ message: "No Zoom meeting link for this lecture" });
    }

    // Only allow assigned admins or enrolled students
    const userId = req.decoded._id;
    const isAdmin = lecture.lecturesListed.map(id => id.toString()).includes(userId);
    const isStudent = lecture.studentsEnrolled.map(id => id.toString()).includes(userId);

    if (!isAdmin && !isStudent) {
      return res.status(403).json({ message: "You are not allowed to join this meeting" });
    }

    res.json({ joinUrl: lecture.zoomLink });
  } catch (error) {
    res.status(500).json({ message: "Error starting meeting", error: error.message });
  }
});


// list all the enrollments
router.get('/list', authJs, async (req, res) => {
  try {
    const enrollments = await Enrollment.find()
      .populate({
        path: 'userId', 
        select: 'name email avatar',
        model: 'User'
      })
      .populate({
        path: 'courseId',
        select: 'course',
        model: 'Course'
      });
    res.json({ enrollments });
  } catch (error) {
    res.status(500).json({ 
      message: "Error fetching enrollments", 
      error: error.message 
    });
  }
});

// admin delete enrollment
router.delete('/delete/:enrollmentId', authJs, isSuperAdmin, async (req, res) => {
  try {
    const { enrollmentId } = req.params;
    const enrollment = await Enrollment.findByIdAndDelete(enrollmentId);
    if (!enrollment) {
      return res.status(404).json({ message: "Enrollment not found" });
    }
    res.json({ message: "Enrollment deleted" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting enrollment", error: error.message });
  }
});

// --- AUTO-ENROLL NEW STUDENTS FOR 5 DAYS AFTER LECTURE CREATION ---
// --  TASK TO RUN EVERY 10 SECONDS --

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

setInterval(async () => {
  try {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - FIVE_DAYS_MS);

    // Find lectures created within the last 5 days
    const lectures = await Lecture.find({ createdAt: { $gte: fiveDaysAgo, $lte: now } });

    for (const lecture of lectures) {
      // Calculate the start date for enrollment query (lecture.createdAt - 5 days)
      const enrollmentStartDate = new Date(lecture.createdAt.getTime() - FIVE_DAYS_MS);

      // Find all enrollments for this course with enrolledAt between (lecture.createdAt - 5 days) and now
      const enrollments = await Enrollment.find({
        courseId: lecture.courseId,
        enrolledAt: { $gte: enrollmentStartDate, $lte: now }
      });

      // Get unique student IDs not already enrolled
      const newStudentIds = enrollments
        .map(e => e.userId.toString())
        .filter(id => !lecture.studentsEnrolled.map(s => s.toString()).includes(id));

      if (newStudentIds.length > 0) {
        // Add new students to the lecture
        lecture.studentsEnrolled.push(...newStudentIds);
        await lecture.save();

        // Send email to each new student
        const students = await User.find({ _id: { $in: newStudentIds } });
        for (const student of students) {
          await sendEmail({
            to: student.email,
            subject: 'You have been added to a lecture batch',
            html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Lecture Enrollment</h2>
              
              <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
                <p style="font-size: 16px;">Hello ${student.name},</p>
                <p>You have been enrolled in a new lecture batch:</p>
                <h3 style="color: #3498db; margin: 15px 0;">${lecture.title}</h3>
                
                <div style="margin: 20px 0;">
                  <p><strong>Start Time:</strong> ${new Date(lecture.startTime).toLocaleString()}</p>
                  <p><strong>Platform:</strong> ${lecture.platform}</p>
                  ${lecture.zoomLink ? `<p><strong>Join Link:</strong> <a href="${lecture.zoomLink}">Click here to join</a></p>` : ''}
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
      }
    }
  } catch (err) {
    console.error('Error in lecture auto-enroll job:', err.message);
  }
}, 10 * 1000); // Runs every 10 seconds

module.exports = router;
