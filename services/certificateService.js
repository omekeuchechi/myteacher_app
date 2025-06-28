const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const Certificate = require('../models/certificate');
const User = require('../models/user');
const sendEmail = require('../lib/sendEmail');
const pusher = require('./pusherService');

class CertificateService {
    static calculateGrade(score) {
        if (score >= 90) return 'A+ (Distinction)';
        if (score >= 80) return 'A (Excellent)';
        if (score >= 70) return 'B+ (Very Good)';
        if (score >= 60) return 'B (Good)';
        if (score >= 50) return 'C (Satisfactory)';
        return 'D (Pass)';
    }
    
    static generateCertificateId(userId, lectureId) {
        // Create a simple unique ID based on user ID, lecture ID, and timestamp
        const timestamp = Date.now().toString(36);
        return `${userId.toString().slice(-4)}-${lectureId.toString().slice(-4)}-${timestamp}`.toUpperCase();
    }

    static async generateCertificate(user, lecture, score) {
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([800, 600]);
        const { width, height } = page.getSize();
        
        // Load fonts
        const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const textFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        
        // Helper function to draw centered text
        const drawCenteredText = (text, y, size, isBold = false) => {
            const font = isBold ? titleFont : textFont;
            const textWidth = font.widthOfTextAtSize(text, size);
            page.drawText(text, {
                x: (width - textWidth) / 2,
                y,
                size,
                font,
                color: rgb(0, 0, 0),
            });
        };
        
        // Add certificate border
        const borderPadding = 40;
        page.drawRectangle({
            x: borderPadding,
            y: borderPadding,
            width: width - (2 * borderPadding),
            height: height - (2 * borderPadding),
            borderColor: rgb(0.1, 0.1, 0.1),
            borderWidth: 2,
        });
        
        // Add header
        drawCenteredText('CERTIFICATE OF ACHIEVEMENT', height - 100, 28, true);
        
        // Add main content
        drawCenteredText('This is to certify that', height - 180, 16);
        drawCenteredText(user.name.toUpperCase(), height - 220, 24, true);
        drawCenteredText('has successfully completed the course', height - 260, 16);
        drawCenteredText(`"${lecture.name}"`, height - 290, 18, true);
        
        // Add score and grade
        const grade = this.calculateGrade(score);
        drawCenteredText(`With an overall score of: ${score}% (${grade})`, height - 350, 16);
        
        // Add completion date
        const date = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        drawCenteredText(`Awarded on: ${date}`, height - 400, 14);
        
        // Add verification line
        drawCenteredText('Certificate ID: ' + this.generateCertificateId(user._id, lecture._id), 80, 12);
        
        return await pdfDoc.save();
    }
    
    static async checkAndIssueCertificates() {
        console.log('Checking for users eligible for certificates...');
        
        // Find all certificates with at least 3 graded assignments
        const certificates = await Certificate.aggregate([
            { $unwind: "$certScores" },
            { 
                $match: { 
                    'certScores.assignmentsGraded': { $gte: 3 },
                    'certScores.certificateIssued': { $ne: true }
                } 
            },
            // Get the full certificate document to use our instance methods
            {
                $group: {
                    _id: "$_id",
                    user: { $first: "$user" },
                    certScores: { $push: "$certScores" },
                    createdAt: { $first: "$createdAt" },
                    updatedAt: { $first: "$updatedAt" }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: "$user" },
            // Convert to proper document to use instance methods
            {
                $addFields: {
                    populatedCert: {
                        $mergeObjects: [
                            { _id: "$_id" },
                            { user: "$user" },
                            { certScores: "$certScores" },
                            { createdAt: "$createdAt" },
                            { updatedAt: "$updatedAt" }
                        ]
                    }
                }
            },
            { $replaceRoot: { newRoot: "$populatedCert" } }
        ]);

        // Process each certificate that might be eligible
        const eligibleCertificates = [];
        
        for (const cert of certificates) {
            const certificateDoc = new Certificate(cert);
            for (const score of cert.certScores) {
                if (certificateDoc.hasMinimumGradedAssignments(score.lecture)) {
                    eligibleCertificates.push({
                        certificate: cert,
                        lectureId: score.lecture,
                        score: score.score
                    });
                }
            }
        }
        
        // Now get the full lecture details for eligible certificates
        const result = await Certificate.populate(eligibleCertificates, [
            {
                path: 'certificate.user',
                model: 'User',
                select: 'name email'
            },
            {
                path: 'lectureId',
                model: 'Lecture',
                select: 'name description'
            }
        ]);
        
        // Process each eligible certificate
        for (const item of result) {
            try {
                const { certificate, lectureId: lecture, score } = item;
                const user = certificate?.user;
                
                if (!user || !lecture) {
                    console.error('Missing user or lecture data for certificate:', item);
                    continue;
                }
                
                // Generate certificate
                const pdfBytes = await this.generateCertificate(user, lecture, score);
                
                // Generate certificate filename
                const certFileName = `Certificate_${(lecture?.name || 'Course').toString().replace(/[^\w\s]/gi, '').replace(/\s+/g, '_')}.pdf`;
                const certificateUrl = `${`${process.env.CLIENT_URL}/certificates/${certificate._id}`}`;
                
                // Validate email address
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                const isValidEmail = user?.email && emailRegex.test(user.email);
                
                if (!isValidEmail) {
                    console.error(`❌ Invalid or missing email for user ${user._id}: ${user.email}`);
                    throw new Error(`Invalid or missing email address for user ${user._id}`);
                }
                
                console.log(`📧 Preparing to send certificate email to: ${user.email}`);
                console.log(`📄 Certificate filename: ${certFileName}`);
                console.log(`🔗 Certificate URL: ${certificateUrl}`);
                
                // Prepare email content
                const emailSubject = `🎉 Certificate of Completion - ${lecture?.name || 'Your Course'}`;
                const emailHtml = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background-color: #4a6cf7; padding: 20px; text-align: center; color: white;">
                            <h1>🎉 Certificate of Achievement</h1>
                        </div>
                        <div style="padding: 20px; background-color: #f9f9f9;">
                            <p>Dear ${user.name},</p>
                            <p>Congratulations on successfully completing <strong>${lecture.name}</strong> with a score of <strong>${score}%</strong>!</p>
                            <p>Your certificate is attached to this email. You can also view and download it by clicking the button below:</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${certificateUrl}" 
                                   style="background-color: #4CAF50; 
                                          color: white; 
                                          padding: 12px 24px; 
                                          text-decoration: none; 
                                          border-radius: 4px; 
                                          font-weight: bold;">
                                    View Your Certificate
                                </a>
                            </div>
                            <p>If the button doesn't work, copy and paste this link into your browser:</p>
                            <p style="word-break: break-all; color: #4a6cf7;">${certificateUrl}</p>
                            <p>Best regards,<br>The Learning Platform Team</p>
                        </div>
                        <div style="background-color: #f0f0f0; padding: 15px; text-align: center; font-size: 12px; color: #666;">
                            <p>This is an automated message. Please do not reply to this email.</p>
                        </div>
                    </div>
                `;

                // Send email
                try {
                    await sendEmail(user.email, emailSubject, emailHtml, [{
                        filename: certFileName,
                        content: pdfBytes,
                        contentType: 'application/pdf'
                    }]);
                    console.log(`✅ Certificate email sent to ${user.email}`);
                } catch (emailError) {
                    console.error(`❌ Failed to send email to ${user.email}:`, emailError.message);
                    throw emailError; // Re-throw to be caught by the outer try-catch
                }
                
                // Send real-time notification via Pusher
                try {
                    await pusher.trigger(
                        `user-${user._id}`,
                        'certificate-issued',
                        {
                            userId: user._id,
                            lectureId: lecture._id,
                            lectureName: lecture.name,
                            score,
                            certificateUrl,
                            issuedAt: new Date().toISOString()
                        }
                    );
                    console.log(`📡 Pusher notification sent to user-${user._id}`);
                } catch (pusherError) {
                    console.error('Error sending Pusher notification:', pusherError);
                }
                
                // Find the specific cert score to update
                const certScoreIndex = certificate.certScores.findIndex(
                    cs => cs.lecture?.toString() === lecture?._id?.toString()
                );
                
                if (certScoreIndex !== -1) {
                    // Create a dynamic update path using the index
                    const updatePath = `certScores.${certScoreIndex}.certificateIssued`;
                    
                    // Mark certificate as issued
                    await Certificate.findByIdAndUpdate(
                        certificate._id,
                        { $set: { [updatePath]: true } }
                    );
                    
                    console.log(`✅ Certificate issued and sent to ${user.email} for ${lecture?.name || 'the course'}`);
                } else {
                    console.error(`❌ Could not find matching cert score for user ${user?._id || 'unknown'} and lecture ${lecture?._id || 'unknown'}`);
                }
            } catch (error) {
                console.error(`Error processing certificate for user ${item.certificate.user?._id}:`, error);
            }
        }
    }
}

module.exports = CertificateService;
