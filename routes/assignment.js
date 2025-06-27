const express = require('express');
const router = express.Router();
const authJs = require('../middlewares/auth');
const Assignment = require('../models/assignment');
const Lecture = require('../models/lecture');
const User = require('../models/user');
const cron = require('node-cron');
const sendEmail = require('../lib/sendEmail');
const PastAssignment = require('../models/past_assignment');
const cloudinary = require('cloudinary').v2;
const path = require('path');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create a new assignment for a lecture
router.post('/lectures/:lectureId/assignments', authJs, async (req, res) => {
    try {
        const { assignmentName, assignmentDescription, template, submitType, expiringDate } = req.body;
        const { lectureId } = req.params;
        const userId = req.decoded.id || req.decoded.userId || req.decoded._id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User ID not found in token'
            });
        }

        // Fetch the user creating the assignment
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Check if the user is authorized to create an assignment for this lecture
        const lecture = await Lecture.findOne({
            _id: lectureId,
            lecturesListed: { $in: [userId] }
        }).populate('studentsEnrolled', 'email name').populate('lecturesListed', 'email');

        if (!lecture) {
            return res.status(403).json({ 
                success: false,
                message: 'You are not authorized to create an assignment for this lecture or lecture does not exist' 
            });
        }

        // Create assignment
        const assignment = new Assignment({
            assignmentName,
            assignmentDescription,
            template,
            submitType,
            expiringDate: new Date(expiringDate),
            createdBy: userId,
            targetBatch: lectureId
        });

        await assignment.save();

        // Send email to admin
        const adminEmail = lecture.lecturesListed.map(admin => admin.email);
        const adminEmailContent = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); overflow: hidden;">
                <!-- Header with accent color -->
                <div style="background: #4a6fa5; padding: 20px; text-align: center;">
                    <h2 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">🎯 New Assignment Created</h2>
                </div>
                
                <!-- Email Body -->
                <div style="padding: 30px;">
                    <p style="font-size: 16px; color: #333; margin-bottom: 20px;">Hello Admin,</p>
                    
                    <div style="background: #f8f9fa; border-left: 4px solid #4a6fa5; padding: 15px; margin-bottom: 25px; border-radius: 0 4px 4px 0;">
                        <p style="font-size: 18px; color: #2c3e50; margin: 0 0 10px 0; font-weight: 600;">${assignmentName}</p>
                        <p style="color: #555; margin: 5px 0;">${assignmentDescription}</p>
                    </div>
                    
                    <div style="margin: 25px 0;">
                        <div style="display: flex; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
                            <span style="font-weight: 600; color: #555; min-width: 150px;">Created By:</span>
                            <span style="color: #333;">${user.name}</span>
                        </div>
                        <div style="display: flex; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">
                            <span style="font-weight: 600; color: #555; min-width: 150px;">Target Batch:</span>
                            <span style="color: #333;">${lecture.title}</span>
                        </div>
                        <div style="display: flex; margin-bottom: 10px;">
                            <span style="font-weight: 600; color: #555; min-width: 150px;">Due Date:</span>
                            <span style="color: #d35400;">${new Date(expiringDate).toLocaleString()}</span>
                        </div>
                    </div>
                    
                    <div style="background: #e8f4fc; padding: 15px; border-radius: 6px; text-align: center;">
                        <p style="margin: 0; font-size: 15px; color: #1a5276; font-weight: 500;">
                            🎓 ${lecture.studentsEnrolled.length} students have been notified about this assignment
                        </p>
                    </div>
                </div>
                
                <!-- Footer -->
                <div style="background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #777; border-top: 1px solid #eee;">
                    <p style="margin: 5px 0;">This is an automated notification. Please do not reply to this email.</p>
                </div>
            </div>
        `;

        // Send email to students
        const studentEmails = lecture.studentsEnrolled.map(student => student.email);
        const studentEmailContent = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #4a6fa5; margin-top: 0;">📚 New Assignment Alert!</h2>
                <p>Hello Student,</p>
                <p>You have a new assignment in <strong>${lecture.title}</strong>:</p>
                
                <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
                    <h3 style="margin-top: 0; color: #2c3e50;">${assignmentName}</h3>
                    <p>${assignmentDescription}</p>
                    <p><strong>📅 Due Date:</strong> ${new Date(expiringDate).toLocaleString()}</p>
                    <p><strong>📝 Submission Type:</strong> ${submitType}</p>
                </div>
                
                <p>Please make sure to submit your assignment before the due date to avoid any penalties.</p>
                
                <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #7f8c8d;">
                    <p>This is an automated message. Please do not reply to this email.</p>
                </div>
            </div>
        `;

        // --- TEMPORARY DEBUGGING LOG ---
        if (process.env.STAG !== 'PRODUCTION') {
            console.log('--- DEBUGGING EMAIL RECIPIENTS ---');
            console.log('Admin Email Recipient:', adminEmail);
            console.log('Student Email Recipients:', studentEmails);
            console.log('------------------------------------');
        }
        // --- END TEMPORARY DEBUGGING LOG ---

        // Send emails conditionally
        const emailPromises = [];
        adminEmail.forEach(email => {
            if (email && email.trim()) {
                emailPromises.push(sendEmail(email.trim(), `New Assignment Created: ${assignmentName}`, adminEmailContent));
            }
        });

        studentEmails.forEach(email => {
            if (email && email.trim()) {
                emailPromises.push(sendEmail(email.trim(), `New Assignment: ${assignmentName}`, studentEmailContent));
            }
        });

        if (emailPromises.length > 0) {
            if (process.env.STAG !== 'PRODUCTION') {
                console.log(`Sending ${emailPromises.length} assignment emails.`);
            }
            await Promise.all(emailPromises);
        }

        res.status(201).json({
            success: true,
            message: 'Assignment created and notifications sent successfully',
            data: assignment
        });

    } catch (error) {
        console.error('Error creating assignment:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating assignment',
            error: error.message
        });
    }
});

// Update an assignment submission
router.patch('/:assignmentId/update-submission', authJs, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { submission, files, submissionId } = req.body;
        const userId = req.decoded.id || req.decoded.userId || req.decoded._id;

        const assignment = await Assignment.findById(assignmentId);

        if (!assignment) {
            return res.status(404).json({ success: false, message: 'Assignment not found' });
        }

        if (assignment.status === 'expired' || new Date(assignment.expiringDate) < new Date()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Submission date has reached already. Assignment is expired.' 
            });
        }

        // Find the specific submission
        const submissionToUpdate = assignment.submissions.id(submissionId);
        if (!submissionToUpdate) {
            return res.status(404).json({ success: false, message: 'Submission not found' });
        }

        // Check if the submission belongs to the current user
        if (submissionToUpdate.student.toString() !== userId.toString()) {
            return res.status(403).json({ success: false, message: 'Unauthorized to update this submission' });
        }

        // Check if submission can still be updated
        const submissionDate = new Date(submissionToUpdate.submittedAt);
        const now = new Date();
        const submissionExpiry = new Date(submissionDate);
        submissionExpiry.setDate(submissionDate.getDate() + 1); // 24 hours after submission

        // If it's the last day of the assignment, don't allow updates
        if (new Date(assignment.expiringDate).setHours(0, 0, 0, 0) === now.setHours(0, 0, 0, 0)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot update submission on the last day of the assignment' 
            });
        }

        // Check if update period has expired
        if (now > submissionExpiry) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot update submission after 24 hours of initial submission' 
            });
        }

        // Handle file updates if any
        let uploadedFiles = [];
        let cloudinaryPublicIds = [];

        if ((assignment.submitType === 'file' || assignment.submitType === 'both') && files && Array.isArray(files)) {
            // Delete old files first
            if (submissionToUpdate.cloudinaryPublicIds) {
                try {
                    await cloudinary.uploader.destroy(submissionToUpdate.cloudinaryPublicIds);
                } catch (error) {
                    console.error('Error deleting old files:', error);
                }
            }

            // Upload new files
            if (!files.every(file => file.startsWith('data:'))) {
                return res.status(400).json({ success: false, message: 'Invalid file format. Expected base64 data URLs.' });
            }

            try {
                for (const file of files) {
                    const uploadedFile = await cloudinary.uploader.upload(file, {
                        folder: `assignments/${assignmentId}/${userId}/${Date.now()}`,
                        resource_type: 'auto'
                    });
                    uploadedFiles.push(uploadedFile.secure_url);
                    cloudinaryPublicIds.push(uploadedFile.public_id);
                }
            } catch (uploadError) {
                console.error('Cloudinary upload error:', uploadError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Failed to upload files', 
                    error: uploadError.message 
                });
            }
        }

        // Update the submission
        submissionToUpdate.submission = submission || submissionToUpdate.submission;
        if (uploadedFiles.length > 0) {
            submissionToUpdate.files = uploadedFiles;
            submissionToUpdate.cloudinaryPublicIds = cloudinaryPublicIds;
        }
        submissionToUpdate.updatedAt = new Date();

        // Save the assignment
        await assignment.save();

        // Update the corresponding PastAssignment
        const pastAssignment = await PastAssignment.findOne({
            assignmentName: assignment.assignmentName,
            student: userId,
            'submissions._id': submissionId
        });

        if (pastAssignment) {
            const pastSubmission = pastAssignment.submissions.id(submissionId);
            if (pastSubmission) {
                pastSubmission.submission = submission || pastSubmission.submission;
                if (uploadedFiles.length > 0) {
                    pastSubmission.files = uploadedFiles;
                    pastSubmission.cloudinaryPublicIds = cloudinaryPublicIds;
                }
                pastSubmission.updatedAt = new Date();
                await pastAssignment.save();
            }
        }

        res.status(200).json({
            success: true,
            message: 'Assignment submission updated successfully',
            data: {
                ...submissionToUpdate.toObject(),
                updatedAt: new Date()
            }
        });

    } catch (error) {
        console.error('Error updating assignment submission:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating assignment submission',
            error: error.message
        });
    }
});

// Get assignments for the logged-in user (student)
router.get('/my-assignments', authJs, async (req, res) => {
    try {
        const userId = req.decoded.id || req.decoded.userId || req.decoded._id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User ID not found in token'
            });
        }
        
        const assignments = await Assignment.find({
            'targetBatch': { 
                $in: await Lecture.find({ studentsEnrolled: userId }).distinct('_id') 
            },
            'status': 'active',
            'expiringDate': { $gt: new Date() }
        })
        .populate('createdBy', 'name email')
        .populate('targetBatch', 'title')
        .sort({ expiringDate: 1 });

        res.status(200).json({
            success: true,
            count: assignments.length,
            data: assignments
        });
    } catch (error) {
        console.error('Error fetching user assignments:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching assignments',
            error: error.message
        });
    }
});

// Get assignments created by the logged-in user (admin/teacher)
router.get('/my-created-assignments', authJs, async (req, res) => {
    try {
        const userId = req.decoded.id || req.decoded.userId || req.decoded._id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User ID not found in token'
            });
        }
        
        const assignments = await Assignment.find({ createdBy: userId })
            .populate('targetBatch', 'title')
            .populate('submissions.student', 'name email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: assignments.length,
            data: assignments
        });
    } catch (error) {
        console.error('Error fetching admin assignments:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching assignments',
            error: error.message
        });
    }
});

// Get all lectures where user is listed in lecturesListed
router.get('/my-listed-lectures', authJs, async (req, res) => {
    try {
        const userId = req.decoded.id || req.decoded.userId || req.decoded._id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User ID not found in token'
            });
        }
        
        const lectures = await Lecture.find({ 
            lecturesListed: userId,
            expiringDate: { $gt: new Date() } // Only return non-expired lectures
        })
        .populate('courseId', 'title')
        .populate('lecturesListed', 'name email')
        .sort({ startTime: 1 });

        res.status(200).json({
            success: true,
            count: lectures.length,
            data: lectures
        });
    } catch (error) {
        console.error('Error fetching listed lectures:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching listed lectures',
            error: error.message
        });
    }
});

// Task scheduler to delete expired assignments (runs daily at midnight)
cron.schedule('0 0 * * *', async () => {
    try {
        const fourDaysAgo = new Date();
        fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
        
        // Find and delete assignments that expired 4 or more days ago
        const result = await Assignment.deleteMany({
            expiringDate: { $lte: fourDaysAgo },
            status: 'active'
        });
        
        console.log(`[${new Date().toISOString()}] Deleted ${result.deletedCount} expired assignments`);
    } catch (error) {
        console.error('Error in assignment cleanup job:', error);
    }
});

// Submit an assignment
router.post('/:assignmentId/submit', authJs, async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { submission, files } = req.body; // files is expected to be an array of base64 strings
        const userId = req.decoded.id || req.decoded.userId || req.decoded._id;

        const assignment = await Assignment.findById(assignmentId);

        if (!assignment) {
            return res.status(404).json({ success: false, message: 'Assignment not found' });
        }

        if (assignment.status === 'expired' || new Date(assignment.expiringDate) < new Date()) {
            assignment.status = 'expired';
            await assignment.save();
            return res.status(400).json({ success: false, message: 'Assignment has expired' });
        }

        const lecture = await Lecture.findById(assignment.targetBatch);
        if (!lecture.studentsEnrolled.includes(userId)) {
            return res.status(403).json({ success: false, message: 'You are not enrolled in the course for this assignment' });
        }

        const existingSubmission = assignment.submissions.find(sub => sub.student.toString() === userId.toString());
        if (existingSubmission) {
            return res.status(400).json({ success: false, message: 'You have already submitted this assignment' });
        }

        let uploadedFiles = [];
        let cloudinaryPublicIds = [];

        // Handle file uploads
        if ((assignment.submitType === 'file' || assignment.submitType === 'both') && files && Array.isArray(files)) {
            if (!files.every(file => file.startsWith('data:'))) {
                return res.status(400).json({ success: false, message: 'Invalid file format. Expected base64 data URLs.' });
            }

            try {
                for (const file of files) {
                    const uploadedFile = await cloudinary.uploader.upload(file, {
                        folder: `assignments/${assignmentId}/${userId}/${Date.now()}`,
                        resource_type: 'auto'
                    });
                    uploadedFiles.push(uploadedFile.secure_url);
                    cloudinaryPublicIds.push(uploadedFile.public_id);
                }
            } catch (uploadError) {
                console.error('Cloudinary upload error:', uploadError);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Failed to upload files', 
                    error: uploadError.message 
                });
            }
        }

        // Validation checks
        if (assignment.submitType === 'text' && !submission) {
            return res.status(400).json({ success: false, message: 'Text submission is required' });
        }
        if (assignment.submitType === 'file' && !uploadedFiles.length) {
            return res.status(400).json({ success: false, message: 'File submission is required' });
        }
        if (assignment.submitType === 'both' && (!submission && !uploadedFiles.length)) {
            return res.status(400).json({ success: false, message: 'Either text or files must be submitted' });
        }

        const newSubmission = {
            student: userId,
            submission: submission || '',
            files: uploadedFiles,
            cloudinaryPublicIds,
            submittedAt: new Date()
        };

        assignment.submissions.push(newSubmission);
        await assignment.save();

        const pastAssignment = new PastAssignment({
            assignmentName: assignment.assignmentName,
            assignmentDescription: assignment.assignmentDescription,
            student: userId,
            submission: submission || '',
            files: uploadedFiles,
            cloudinaryPublicIds,
            submittedAt: newSubmission.submittedAt
        });
        await pastAssignment.save();

        res.status(201).json({
            success: true,
            message: 'Assignment submitted successfully',
            data: newSubmission
        });

    } catch (error) {
        console.error('Error submitting assignment:', error);
        res.status(500).json({
            success: false,
            message: 'Error submitting assignment',
            error: error.message
        });
    }
});

// Task scheduler to delete old assignment files from Cloudinary (runs on the 1st and 15th of every month at 1 AM)
cron.schedule('0 1 1,15 * *', async () => {
    try {
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

        const assignmentsToClean = await PastAssignment.find({
            submittedAt: { $lte: twoWeeksAgo },
            cloudinaryPublicId: { $exists: true, $ne: null, $ne: '' }
        });

        if (assignmentsToClean.length === 0) {
            console.log(`[${new Date().toISOString()}] No old assignment files to clean up from Cloudinary.`);
            return;
        }

        console.log(`[${new Date().toISOString()}] Found ${assignmentsToClean.length} old assignment files to clean up.`);

        for (const pastAssignment of assignmentsToClean) {
            try {
                await cloudinary.uploader.destroy(pastAssignment.cloudinaryPublicId);

                await Assignment.updateOne(
                    { "submissions.cloudinaryPublicId": pastAssignment.cloudinaryPublicId },
                    { $set: { "submissions.$.fileUrl": "", "submissions.$.cloudinaryPublicId": "" } }
                );
                
                pastAssignment.fileUrl = undefined;
                pastAssignment.cloudinaryPublicId = undefined;
                await pastAssignment.save();

                console.log(`[${new Date().toISOString()}] Deleted file ${pastAssignment.cloudinaryPublicId} from Cloudinary.`);

            } catch (cleanupError) {
                console.error(`[${new Date().toISOString()}] Error cleaning up file ${pastAssignment.cloudinaryPublicId}:`, cleanupError);
            }
        }
    } catch (error) {
        console.error('Error in Cloudinary cleanup job:', error);
    }
});

// Get all submitted assignments for lectures managed by the admin
router.get('/assignments/submitted', authJs, async (req, res) => {
    try {
        const userId = req.decoded.id || req.decoded.userId || req.decoded._id;

        // Find all lectures managed by the user
        const managedLectures = await Lecture.find({ lecturesListed: userId }).select('_id title expiringDate');

        if (!managedLectures || managedLectures.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'You are not managing any lectures.',
                data: []
            });
        }

        const managedLectureIds = managedLectures.map(lecture => lecture._id);

        // Find all assignments for those lectures that have submissions
        const assignmentsWithSubmissions = await Assignment.find({
            targetBatch: { $in: managedLectureIds },
            'submissions.0': { $exists: true } // Check if submissions array is not empty
        })
        .populate({
            path: 'targetBatch',
            select: 'title expiringDate'
        })
        .populate({
            path: 'submissions.student',
            select: 'name email'
        })
        .sort({ 'targetBatch.expiringDate': -1, 'createdAt': -1 }); // Sort by lecture expiry date (most recent first), then by assignment creation

        res.status(200).json({
            success: true,
            count: assignmentsWithSubmissions.length,
            data: assignmentsWithSubmissions
        });

    } catch (error) {
        console.error('Error fetching submitted assignments:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching submitted assignments',
            error: error.message
        });
    }
});

module.exports = router;