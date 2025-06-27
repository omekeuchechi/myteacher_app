const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const Assignment = require('../models/assignment');
const Certificate = require('../models/certificate');
const Lecture = require('../models/lecture');
const sendEmail = require('../lib/sendEmail'); // Import the email utility
const { getAIScoreAndCorrection } = require('../utils/aiService'); // Import the AI service
const authJs = require('../middlewares/auth'); // Import the auth middleware

// The core grading logic, now returns details of graded submissions
const gradeSubmissions = async () => {
    console.log('Starting automatic grading process...');
    console.log('Running task: Grading submissions...');
    const gradedDetails = [];
    try {
        // Find assignments with ungraded submissions and populate student details
        const assignmentsToGrade = await Assignment.find({ 'submissions.graded': false })
            .populate('submissions.student', 'name email'); // Populate name and email

        for (const assignment of assignmentsToGrade) {
            let needsSave = false;
            for (const sub of assignment.submissions) {
                // Ensure student is populated and submission is not graded
                if (sub.student && !sub.graded) {
                    // Call the real AI service
                    const { score, correction } = await getAIScoreAndCorrection(sub.submission);
                    
                    sub.score = score;
                    sub.graded = true;
                    sub.correction = correction; // Save the correction text
                    needsSave = true;

                    // Update the student's certificate score
                    await Certificate.updateScore(sub.student._id, assignment.targetBatch, score);

                    // Store details for email notification
                    console.log(`Sending grading email to: ${sub.student.email}`);
                    gradedDetails.push({
                        studentName: sub.student.name,
                        studentEmail: sub.student.email,
                        assignmentTitle: assignment.assignmentName,
                        score,
                        correction
                    });
                }
            }
            if (needsSave) {
                await assignment.save();
            }
        }
        console.log(`Finished grading. Graded ${gradedDetails.length} submission(s).`);
        console.log('🎁.');
        // Send email notifications for all graded submissions
        for (const details of gradedDetails) {
            const assignmentTitle = details.assignmentTitle || 'the assignment';
            const subject = `Your submission for "${assignmentTitle}" has been graded!`;
            const html = `
                <h1>Hi ${details.studentName},</h1>
                <p>Great news! Your submission for the assignment "<strong>${assignmentTitle}</strong>" has been graded by our AI assistant.</p>
                <h2>Your Score: ${details.score} / 100</h2>
                <h3>Feedback and Corrections:</h3>
                <p style="white-space: pre-wrap; background-color: #f4f4f4; padding: 15px; border-radius: 5px;">${details.correction}</p>
                <p>Keep up the great work!</p>
                <p>Best regards,<br>MyTeacher App</p>
            `;
            console.log(`Sending grading email to: ${details.studentEmail}`);
            try {
                await sendEmail(details.studentEmail, subject, html);
            } catch (emailError) {
                console.error(`Failed to send email to ${details.studentEmail}:`, emailError);
            }
        }
        console.log('✔ Automatic grading process completed successfully.');
        return gradedDetails;
    } catch (error) {
        console.error('Error during grading:', error);
        return []; // Return empty array on error
    }
};



// Schedule the task to run every 2 minutes
cron.schedule('*/2 * * * *', () => {
    // This is the automatic, silent run. We call gradeSubmissions but don't need to do anything with the results here.
    gradeSubmissions().catch(error => console.error('Error in scheduled cron job:', error));
});

// Manual trigger for grading with email notifications
router.post('/grade-now', async (req, res) => {
    try {
        const gradedSubmissions = await gradeSubmissions();

        if (gradedSubmissions.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'Grading process triggered, but no new submissions were found to grade.'
            });
        }

        // Send email notifications
        for (const details of gradedSubmissions) {
            const subject = `Your submission for "${details.assignmentTitle}" has been graded!`;
            const html = `
                <h1>Hi ${details.studentName},</h1>
                <p>Great news! Your submission for the assignment "<strong>${details.assignmentTitle}</strong>" has been graded by our AI assistant.</p>
                <h2>Your Score: ${details.score} / 100</h2>
                <h3>Feedback and Corrections:</h3>
                <p style="white-space: pre-wrap; background-color: #f4f4f4; padding: 15px; border-radius: 5px;">${details.correction}</p>
                <p>Keep up the great work!</p>
                <p>Best regards,<br>MyTeacher App</p>
            `;
            console.log(`Sending grading email to: ${details.studentEmail}`);
            await sendEmail(details.studentEmail, subject, html);
        }

        res.status(200).json({
            success: true,
            message: `Grading process completed successfully. Graded and notified ${gradedSubmissions.length} student(s).`,
            gradedCount: gradedSubmissions.length,
            notifiedStudents: gradedSubmissions.map(s => s.studentName)
        });

    } catch (error) {
        console.error('Failed to trigger manual grading process:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to trigger grading process due to an internal error.'
        });
    }
});

// --- New Admin and Student API Endpoints ---

/**
 * @route   GET /api/certificates/admin/submissions
 * @desc    Fetch all submissions for lectures managed by the authenticated admin
 * @access  Private (Admin)
 */
router.get('/admin/submissions', authJs, async (req, res) => {
    try {
        const adminId = req.decoded.id || req.decoded.userId || req.decoded._id || req.decoded; // Get admin ID from authenticated token

        // 1. Find all lectures where the admin is listed
        const adminLectures = await Lecture.find({ lecturesListed: adminId }).select('_id');
        if (!adminLectures.length) {
            return res.status(200).json({
                message: 'Admin does not manage any lectures.',
                submissions: []
            });
        }
        const lectureIds = adminLectures.map(l => l._id);

        // 2. Find all assignments for those lectures and populate submissions
        const assignments = await Assignment.find({ targetBatch: { $in: lectureIds } })
            .populate('submissions.student', 'name email')
            .populate('targetBatch', 'title')
            .sort({ createdAt: -1 });

        // 3. Flatten the submissions for easier frontend consumption
        const allSubmissions = assignments.flatMap(assignment =>
            assignment.submissions.map(sub => ({
                assignmentId: assignment._id,
                assignmentName: assignment.assignmentName,
                batchName: assignment.targetBatch.title,
                studentId: sub.student?._id,
                studentName: sub.student?.name,
                studentEmail: sub.student?.email,
                submissionText: sub.submission,
                fileUrl: sub.fileUrl,
                submittedAt: sub.submittedAt,
                graded: sub.graded,
                score: sub.score
            }))
        );

        res.json({
            success: true,
            count: allSubmissions.length,
            submissions: allSubmissions
        });

    } catch (error) {
        console.error('Error fetching admin submissions:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

/**
 * @route   GET /api/certificates/student/results
 * @desc    Fetch the authenticated student's certificate and all their graded submissions
 * @access  Private (Student)
 */
router.get('/student/results', authJs, async (req, res) => {
    try {
        const studentId = req.decoded.id || req.decoded.userId || req.decoded._id || req.decoded; // Get student ID from authenticated token

        // 1. Fetch the student's certificate
        const certificate = await Certificate.findOne({ student: studentId })
            .populate('student', 'name email');

        // 2. Fetch all assignments the student has submitted to
        const assignments = await Assignment.find({ 'submissions.student': studentId })
            .select('assignmentName targetBatch submissions.$'); // Project only the relevant submission

        // Extract and format the submission details
        const submissionDetails = assignments.map(a => {
            const sub = a.submissions[0];
            return {
                assignmentName: a.assignmentName,
                score: sub.score,
                graded: sub.graded,
                correction: sub.correction,
                submittedAt: sub.submittedAt
            };
        });

        res.json({
            success: true,
            certificate,
            results: submissionDetails
        });

    } catch (error) {
        console.error('Error fetching student results:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

module.exports = router;