const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const Assignment = require('../models/assignment');
const Certificate = require('../models/certificate');
const Lecture = require('../models/lecture');
const User = require('../models/user');
const mongoose = require('mongoose');
const sendEmail = require('../lib/sendEmail'); // Import the email utility
const { getAIScoreAndCorrection } = require('../utils/aiService'); // Import the AI service
const authJs = require('../middlewares/auth'); // Import the auth middleware
const CertificateService = require('../services/certificateService');

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

// Get certificate by ID
router.get('/:certificateId', authJs, async (req, res) => {
    try {
        // First, verify the user exists and has permission
        try {
            const user = await User.findById(req.user._id).select('_id email');
            if (!user) {
                console.error('User not found:', req.user._id);
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }
            console.log('Requested user found:', { id: user._id, email: user.email });
        } catch (error) {
            console.error('Error verifying user:', error);
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID format',
                error: error.message
            });
        }

        const certificate = await Certificate.findById(req.params.certificateId)
            .populate('user', 'name email')
            .populate('certScores.lecture', 'name description');

        if (!certificate) {
            return res.status(404).json({
                success: false,
                message: 'Certificate not found'
            });
        }

        // Check if the requesting user is the owner or an admin
        if (certificate.user._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view this certificate'
            });
        }

        // Verify and clean certScores
        const validScores = certificate.certScores.filter(score => {
            try {
                if (!score) return false;
                if (!score.lecture) {
                    console.warn('Score missing lecture:', score._id);
                    return false;
                }
                if (!score.lecture._id || typeof score.lecture._id.toString !== 'function') {
                    console.warn('Invalid lecture ID in score:', {
                        scoreId: score._id,
                        lecture: score.lecture
                    });
                    return false;
                }
                return true;
            } catch (error) {
                console.error('Error validating score:', error);
                return false;
            }
        });

        res.json({
            success: true,
            data: certificate
        });
    } catch (error) {
        console.error('Error fetching certificate:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// Get all certificates for the authenticated user
router.get('/user/:userId', authJs, async (req, res) => {
    try {
        console.log('=== New Certificate Request ===');
        console.log('Request params:', req.params);
        console.log('Authenticated user:', {
            id: req.user?._id,
            email: req.user?.email,
            isAdmin: req.user?.isAdmin
        });
        
        // Verify the requesting user is authorized
        if (!req.user || !req.user._id.toString() || !req.user.isAdmin || req.user._id.toString() !== req.decoded.id || req.user._id.toString() !== req.decoded.userId || req.user._id.toString() !== req.decoded._id ||  req.decoded.id !== req.decoded.userId || req.decoded.id !== req.decoded._id || req.decoded.userId !== req.decoded._id) {
            console.error('No valid user object in request');
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                error: 'No valid user session found'
            });
        }

        // Get the certificate document for the user
        console.log('Fetching certificate document...');
        const certificate = await Certificate.findOne({ user: req.params.userId })
            .populate({
                path: 'certScores.lecture',
                select: '_id name description',
                options: { lean: true }
            })
            .lean()
            .exec();
            
        console.log('Certificate document found:', !!certificate);

        if (!certificate) {
            return res.status(404).json({
                success: false,
                message: 'No certificates found for this user'
            });
        }

        // Process certScores to ensure unique lectures and format the response
        const uniqueCertificates = [];
        const lectureMap = new Map();

        // Sort by issuedAt in descending order (newest first)
        const sortedScores = [...certificate.certScores].sort((a, b) => 
            new Date(b.issuedAt || 0) - new Date(a.issuedAt || 0)
        );

        console.log(sortedScores);

        // Process scores, keeping only the most recent entry for each lecture
        for (const score of sortedScores) {
            console.log(score);
            const lectureId = score.lecture._id.toString();
            if (!lectureMap.has(lectureId)) {
                lectureMap.set(lectureId, true);
                
                uniqueCertificates.push({
                    _id: `cert-${lectureId}-${score._id}`,
                    lecture: score.lecture,
                    score: score.score,
                    grade: calculateGrade(score.score),
                    issuedAt: score.issuedAt || new Date(),
                    certificateIssued: score.certificateIssued || false,
                    downloadUrl: score.downloadUrl || null
                });
            }
        }

        res.json({
            success: true,
            data: uniqueCertificates
        });
    } catch (error) {
        console.error('Error fetching user certificates:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching certificates',
            error: error.message
        });
    }
});

// Helper function to calculate grade based on score
function calculateGrade(score) {
    if (score >= 90) return 'A+ (Distinction)';
    if (score >= 80) return 'A (Excellent)';
    if (score >= 70) return 'B+ (Very Good)';
    if (score >= 60) return 'B (Good)';
    if (score >= 50) return 'C (Satisfactory)';
    return 'D (Pass)';
}

// Download certificate as PDF
router.get('/download/:certificateId', authJs, async (req, res) => {
    try {
        const { certificateId } = req.params;
        const userId = req.decoded.id || req.decoded.userId || req.decoded._id || req.decoded;

        // Find the certificate
        const certificate = await Certificate.findOne({ user: userId })
            .populate('user', 'name email')
            .populate('certScores.lecture', 'name description');

        if (!certificate) {
            return res.status(404).json({
                success: false,
                message: 'Certificate not found'
            });
        }

        // Find the specific certificate score
        const certScore = certificate.certScores.find(
            cs => cs._id.toString() === certificateId
        );

        if (!certScore) {
            return res.status(404).json({
                success: false,
                message: 'Certificate score not found'
            });
        }

        // Generate the PDF
        const pdfBytes = await CertificateService.generateCertificate(
            certificate.user,
            certScore.lecture,
            certScore.score
        );

        // Set headers for file download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${certScore.lecture.name.replace(/\s+/g, '_')}_Certificate.pdf"`);
        
        // Send the PDF
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Error downloading certificate:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating certificate',
            error: error.message
        });
    }
});

module.exports = router;