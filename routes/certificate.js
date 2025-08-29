const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const Assignment = require('../models/assignment');
const Certificate = require('../models/certificate');
const Lecture = require('../models/lecture');
const User = require('../models/user');
const mongoose = require('mongoose');
const sendEmail = require('../lib/sendEmail');
const { getAIScoreAndCorrection } = require('../utils/aiService');
const authJs = require('../middlewares/auth');
const CertificateService = require('../services/certificateService');

// Apply authentication middleware to all certificate routes
router.use(authJs);

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
                    const certUpdate = await Certificate.updateScore(
                        sub.student._id, 
                        assignment.targetBatch, 
                        score,
                        {
                            assignmentId: assignment._id,
                            assignmentName: assignment.assignmentName,
                            submittedAt: sub.submittedAt || new Date()
                        }
                    );

                    gradedDetails.push({
                        studentName: sub.student.name,
                        studentEmail: sub.student.email,
                        assignmentTitle: assignment.assignmentName,
                        score,
                        correction,
                        certificateUpdated: !!certUpdate,
                        lectureId: assignment.targetBatch,
                        timestamp: new Date()
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
                await sendEmail({
                    to: details.studentEmail,
                    subject: subject,
                    html: html
                });
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

// Get certificate results for a student
router.get('/student/results', authJs, async (req, res) => {
    try {
        // The auth middleware has already verified the user
        const user = req.user || req.decoded;
        
        if (!user || !user.id) {
            console.error('No valid user object in request');
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                error: 'No valid user session found'
            });
        }
        
        const userId = user.id;
        
        console.log(`Fetching certificates for user ${userId}...`);
        
        // Find all certificates for the user with timeout handling
        let certificates;
        try {
            certificates = await Certificate.find({ user: userId })
                .populate({
                    path: 'certScores.lecture',
                    select: 'name description _id',
                    model: 'Lecture'
                })
                .populate('user', 'name email') // Populate user details
                .maxTimeMS(10000) // 10 second timeout
                .lean();
                
            console.log(`Found ${certificates ? certificates.length : 0} certificates for user ${userId}`);
                
            if (!certificates || certificates.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: 'No certificate results found',
                    data: {
                        user: {
                            id: user.id,
                            name: user.name,
                            email: user.email
                        },
                        certificates: []
                    }
                });
            }
        } catch (dbError) {
            console.error('Database error in /student/results:', dbError);
            if (dbError.name === 'MongooseServerSelectionError' || dbError.name === 'MongooseError') {
                return res.status(503).json({
                    success: false,
                    message: 'Service temporarily unavailable',
                    error: 'Database connection error. Please try again later.'
                });
            }
            throw dbError; // Re-throw other errors to be caught by the outer catch
        }
        
        // Extract user details from the first certificate or use the authenticated user
        const userDetails = certificates[0]?.user || {
            _id: user.id,
            name: user.name,
            email: user.email
        };

        // Process and format the results
        const formattedCertificates = certificates.map(cert => {
            return {
                certificateId: cert._id,
                userId: cert.user?._id || cert.user,
                certScores: (cert.certScores || []).map(score => ({
                    _id: score._id, // Add the score's own ID
                    lecture: {
                        id: score.lecture?._id,
                        name: score.lecture?.name,
                        description: score.lecture?.description
                    },
                    score: score.score,
                    grade: score.grade,
                    dateAwarded: score.dateAwarded,
                    // Construct the full download URL
                    downloadUrl: `${process.env.BASE_URL}/certificates/download/${score._id}`
                })).filter(score => score.lecture && score.lecture.id), // Filter out any invalid lecture entries
                createdAt: cert.createdAt,
                updatedAt: cert.updatedAt
            };
        });

        // Prepare the response
        const response = {
            success: true,
            message: 'Certificate results retrieved successfully',
            data: {
                user: {
                    id: userDetails._id,
                    name: userDetails.name,
                    email: userDetails.email
                },
                certificates: formattedCertificates
            }
        };

        console.log(`Sending response for user ${userDetails._id} with ${formattedCertificates.length} certificates`);
        res.status(200).json(response);
        
    } catch (error) {
        console.error('Error fetching student results:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching certificate results',
            error: error.message
        });
    }
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
            await sendEmail({
                to: details.studentEmail,
                subject: subject,
                html: html
            });

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
router.get('/user/:userId', async (req, res) => {
    try {
        console.log('=== New Certificate Request ===');
        console.log('Request params:', req.params);
        
        // Get the authenticated user from the decoded token
        const authenticatedUser = req.decoded;
        const requestedUserId = req.params.userId;
        
        console.log('Authenticated user:', {
            id: authenticatedUser?.id || authenticatedUser?._id,
            email: authenticatedUser?.email,
            isAdmin: authenticatedUser?.isAdmin
        });
        
        // Verify the requesting user is authorized
        if (!authenticatedUser || (!authenticatedUser.id && !authenticatedUser._id)) {
            console.error('No valid user object in request');
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                error: 'No valid user session found'
            });
        }
        
        // Check if the authenticated user is either an admin or requesting their own data
        const authUserId = authenticatedUser.id || authenticatedUser._id;
        const isAdmin = authenticatedUser.isAdmin === true;
        const isOwnData = authUserId.toString() === requestedUserId;
        
        if (!isAdmin && !isOwnData) {
            console.error('Unauthorized access attempt');
            return res.status(403).json({
                success: false,
                message: 'Unauthorized',
                error: 'You do not have permission to access this resource'
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
            
            // Skip if lecture is null or undefined
            if (!score) {
                console.warn('Skipping score with missing lecture:', score._id);
                continue;
            }

            const lectureId = score.lecture._id ? score.lecture._id.toString() : null;
            
            if (lectureId && !lectureMap.has(lectureId)) {
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

// Download certificate as PDF for a specific score
router.get('/download/:scoreId', async (req, res) => {
    try {
        const { scoreId } = req.params;

        // Add a check for malformed IDs ending in '-undefined'
        if (scoreId && scoreId.endsWith('-undefined')) {
            console.error('Malformed scoreId received, likely from a client-side error:', scoreId);
            return res.status(400).json({
                success: false,
                message: 'The request contained a malformed ID, suggesting a client-side error where a value was undefined.',
                receivedId: scoreId
            });
        }


        // Add a check for malformed IDs ending in '-undefined'
        if (scoreId && scoreId.endsWith('-undefined')) {
            console.error('Malformed scoreId received, likely from a client-side error:', scoreId);
            return res.status(400).json({
                success: false,
                message: 'The request contained a malformed ID, suggesting a client-side error where a value was undefined.',
                receivedId: scoreId
            });
        }

        const authenticatedUser = req.decoded;
        
        if (!authenticatedUser || (!authenticatedUser.id && !authenticatedUser._id)) {
            console.error('No valid user object in request');
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                error: 'No valid user session found'
            });
        }

        if (!scoreId) {
            return res.status(400).json({
                success: false,
                message: 'Score ID is required'
            });
        }

        let certScore;
        let certificate;

        // Check if the scoreId is in the format 'score-userIndex-scoreIndex'
        const scoreMatch = scoreId.match(/^score-(\d+)-(\d+)$/);
        
        if (scoreMatch) {
            // Handle the score-X-Y format
            const [_, userIndex, scoreIndex] = scoreMatch;
            
            // Find the user's certificate
            const userId = authenticatedUser.id || authenticatedUser._id;
            certificate = await Certificate.findOne({ user: userId })
                .populate({
                    path: 'user',
                    select: 'name email'
                })
                .populate({
                    path: 'certScores.lecture',
                    select: 'title description',  // Changed from 'name' to 'title'
                    // Ensure we're not getting null lectures
                    match: { _id: { $exists: true } }
                });

            if (!certificate || !certificate.certScores || certificate.certScores.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No certificate scores found for user'
                });
            }

            // Filter out any null lectures that didn't match the population
            certificate.certScores = certificate.certScores.filter(score => score.lecture);
            
            if (certificate.certScores.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No valid lecture data found for certificate'
                });
            }

            // Get the score at the specified index
            const scoreIdx = parseInt(scoreIndex, 10);
            if (scoreIdx >= certificate.certScores.length) {
                return res.status(404).json({
                    success: false,
                    message: 'Certificate score not found at the specified index'
                });
            }
            
            certScore = certificate.certScores[scoreIdx];
            
            // If we still don't have complete lecture data, try to handle it
            if (certScore.lecture && !certScore.lecture.name) {
                console.log('Handling lecture data with custom structure:', certScore.lecture);
                // If lecture is just an ID string, try to fetch it
                if (typeof certScore.lecture === 'string') {
                    const Lecture = require('../models/lecture');
                    const lecture = await Lecture.findById(certScore.lecture).select('title description');
                    if (lecture) {
                        certScore.lecture = {
                            name: lecture.title || `Lecture ${scoreIndex}`,
                            description: lecture.description || 'No description available',
                            _id: lecture._id.toString()
                        };
                    }
                } 
                // If lecture is an object but missing name, use title or default
                else if (certScore.lecture) {
                    certScore.lecture.name = certScore.lecture.name || 
                                          certScore.lecture.title || 
                                          `Lecture ${scoreIndex}`;
                    certScore.lecture.description = certScore.lecture.description || 'No description available';
                }
            }
        } else {
            // Handle the case where scoreId is a MongoDB ObjectId
            certificate = await Certificate.findOne({
                'certScores._id': scoreId
            }).populate('user', 'name email')
              .populate('certScores.lecture', 'name description');

            if (!certificate) {
                return res.status(404).json({
                    success: false,
                    message: 'Certificate not found for the given score'
                });
            }

            // Find the specific certificate score using Mongoose's id() helper
            certScore = certificate.certScores.id(scoreId);
        }

        if (!certScore) {
            return res.status(404).json({
                success: false,
                message: 'Certificate score not found'
            });
        }

        // Check if we have the necessary data
        if (!certScore.lecture) {
            console.error('No lecture data found in certScore:', certScore);
            return res.status(404).json({
                success: false,
                message: 'Lecture data not found for this certificate',
                debug: {
                    certScoreId: certScore._id,
                    hasLecture: !!certScore.lecture,
                    lectureId: certScore.lecture?._id || certScore.lecture
                }
            });
        }

        // Debug log to see the lecture data
        console.log('Lecture data before PDF generation:', {
            lecture: certScore.lecture,
            hasName: !!certScore.lecture?.name,
            lectureId: certScore.lecture._id || certScore.lecture,
            lectureRaw: JSON.stringify(certScore.lecture)
        });

        try {
            // Ensure we have the lecture title
            if (!certScore.lecture.title && certScore.lecture._id) {
                console.log('Lecture title is missing, trying to populate it...');
                const Lecture = require('../models/lecture');
                const lecture = await Lecture.findById(certScore.lecture._id).select('title description');
                if (lecture) {
                    certScore.lecture = lecture;
                    console.log('Successfully populated lecture:', lecture);
                }
            }

            // Generate the PDF
            const pdfBytes = await CertificateService.generateCertificate(
                certificate.user,
                certScore.lecture,
                certScore.score
            );

            // Create a safe filename
            const lectureName = certScore.lecture.name || 'certificate';
            const safeFilename = `${lectureName.replace(/[^\w\s]/gi, '')}_Certificate`.replace(/\s+/g, '_');
            
            // Set headers for file download
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.pdf"`);
            
            // Send the PDF
            res.send(Buffer.from(pdfBytes));
        } catch (genError) {
            console.error('Error generating certificate PDF:', genError);
            throw new Error('Failed to generate certificate PDF');
        }
    } catch (error) {
        console.error('Error downloading certificate:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating certificate',
            error: error.message
        });
    }
});

// Helper function to check database connection and collections
async function checkDatabase() {
    try {
        console.log('=== DATABASE STATUS ===');
        console.log('Mongoose connection state:', mongoose.connection.readyState);
        
        // Get database instance
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('No database connection');
        }
        
        // List all collections
        const collections = await db.listCollections().toArray();
        console.log('Available collections:', collections.map(c => c.name));
        
        // Check if users collection exists
        const usersCollection = collections.find(c => c.name === 'users' || c.name === 'Users');
        if (!usersCollection) {
            throw new Error('Users collection not found in database');
        }
        
        return true;
    } catch (error) {
        console.error('Database check failed:', error);
        return false;
    }
}

// Download total score certificate as PDF
router.get('/download-total-certificate/:userId', authJs, async (req, res) => {
    try {
        console.log('=== Certificate Download Request ===');
        console.log('Query params:', req.query);
        
        // Check database connection first
        const dbOk = await checkDatabase();
        if (!dbOk) {
            return res.status(500).json({
                success: false,
                message: 'Database connection error',
                error: 'Failed to connect to database'
            });
        }
        
        // Try to get user ID from query parameter first, then from auth
        let userId = req.params.userId;
        let user;
        
        if (userId) {
            console.log('=== USER LOOKUP ===');
            console.log('Looking for user with ID:', userId);
            
            try {
                // Try direct database query as a last resort
                const db = mongoose.connection.db;
                const usersCollection = db.collection('users') || db.collection('Users');
                user = await usersCollection.findOne({
                    $or: [
                        { _id: new mongoose.Types.ObjectId(userId) },
                        { _id: userId },
                        { email: userId }
                    ]
                });
                
                console.log('User lookup result:', user ? 'Found' : 'Not found');
                if (user) {
                    console.log('User found:', {
                        _id: user._id,
                        email: user.email,
                        name: user.name
                    });
                }
            } catch (dbError) {
                console.error('Database error during user lookup:', dbError);
                return res.status(500).json({
                    success: false,
                    message: 'Database error',
                    error: dbError.message
                });
            }
        } 
        
        // If not found via query param or no query param, try auth
        if (!user) {
            console.log('Trying to get user from auth...');
            userId = req.user?._id || req.decoded?._id || req.decoded?.id || req.decoded;
            console.log('Resolved userId from auth:', userId);
            
            if (!userId) {
                console.error('No user ID found in request');
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized: No user ID found in request',
                    requestInfo: {
                        hasUser: !!req.user,
                        hasDecoded: !!req.decoded,
                        userKeys: req.user ? Object.keys(req.user) : [],
                        decodedKeys: req.decoded ? Object.keys(req.decoded) : []
                    }
                });
            }
            
            user = await User.findById(userId);
        }
        
        console.log('User lookup result:', user ? 'Found' : 'Not found');
        
        if (!user) {
            console.error('User not found in database with ID:', userId);
            // Check if any users exist in the database
            const anyUser = await User.findOne({});
            console.log('Any user in database:', anyUser ? 'Yes' : 'No');
            
            return res.status(404).json({
                success: false,
                message: 'User not found in database',
                userId: userId.toString(),
                userIdType: typeof userId,
                databaseHasUsers: !!anyUser
            });
        }

        // Get all certificates for the user
        const certificates = await Certificate.find({ user: userId })
            .populate('certScores.lecture', 'name description');
        
        if (!certificates || certificates.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No certificates found for this user'
            });
        }

        // Generate the total certificate PDF
        const pdfBuffer = await CertificateService.generateCertificatePDF({
            userName: user.name,
            userEmail: user.email,
            score: certificates[0].totalScore, // Assuming first certificate has the total score
            issueDate: new Date(),
            certificateId: certificates[0]._id.toString()
        });
        
        // Set headers for file download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=total-certificate-${user._id}.pdf`);
        
        // Send the PDF
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error generating total certificate:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate total certificate',
            error: error.message
        });
    }
});

module.exports = router;