const express = require('express');
const router = express.Router();
const RequestPrivateTutor = require('../models/reqPrivateTutor');
const sendEmail = require('../lib/sendEmail');
const authJs = require('../middlewares/auth');

// POST route to create a new private tutor request
router.post('/request', async (req, res) => {
    try {
        const { name, email, phone, subject, goals } = req.body;

        // Validation
        if (!name || !email || !phone || !subject || !goals) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        // Create new tutor request
        const tutorRequest = new RequestPrivateTutor({
            name,
            email,
            phone,
            subject,
            goals
        });

        // Save to database
        const savedRequest = await tutorRequest.save();

        // Send email notification
        const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Private Tutor Request</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    line-height: 1.6;
                    color: #333333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f9f9f9;
                }
                .container {
                    background-color: #ffffff;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                    overflow: hidden;
                }
                .header {
                    background-color: #4a6ee0;
                    padding: 30px 20px;
                    text-align: center;
                    color: white;
                }
                .header h1 {
                    margin: 0;
                    font-size: 24px;
                    font-weight: 600;
                }
                .content {
                    padding: 30px;
                }
                .request-details {
                    background-color: #f8f9fa;
                    padding: 20px;
                    border-radius: 6px;
                    margin: 20px 0;
                }
                .detail-row {
                    margin-bottom: 15px;
                    display: flex;
                    align-items: flex-start;
                }
                .detail-label {
                    font-weight: 600;
                    color: #2d3748;
                    min-width: 120px;
                    margin-right: 10px;
                }
                .detail-value {
                    color: #4a5568;
                    flex: 1;
                }
                .cta-button {
                    display: inline-block;
                    background-color: #4a6ee0;
                    color: white !important;
                    text-decoration: none;
                    padding: 12px 24px;
                    border-radius: 5px;
                    font-weight: 600;
                    margin: 15px 0;
                }
                .footer {
                    text-align: center;
                    padding: 20px;
                    font-size: 14px;
                    color: #718096;
                    border-top: 1px solid #e2e8f0;
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>New Private Tutor Request</h1>
                    <p>A student is interested in private tutoring</p>
                </div>
                
                <div class="content">
                    <p>You have received a new request for private online tutoring. Here are the details:</p>
                    
                    <div class="request-details">
                        <div class="detail-row">
                            <div class="detail-label">Name:</div>
                            <div class="detail-value">${name}</div>
                        </div>
                        <div class="detail-row">
                            <div class="detail-label">Email:</div>
                            <div class="detail-value">${email}</div>
                        </div>
                        <div class="detail-row">
                            <div class="detail-label">Phone:</div>
                            <div class="detail-value">${phone}</div>
                        </div>
                        <div class="detail-row">
                            <div class="detail-label">Subject:</div>
                            <div class="detail-value">${subject}</div>
                        </div>
                        <div class="detail-row">
                            <div class="detail-label">Goals:</div>
                            <div class="detail-value">${goals}</div>
                        </div>
                        <div class="detail-row">
                            <div class="detail-label">Request Date:</div>
                            <div class="detail-value">${new Date().toLocaleDateString()}</div>
                        </div>
                    </div>
                    
                    <p>Please contact the student as soon as possible to discuss their tutoring needs and schedule.</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="mailto:${email}" class="cta-button">Reply to Student</a>
                    </div>
                </div>
                
                <div class="footer">
                    <p>© ${new Date().getFullYear()} MyTeacher Institute. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        `;

        await sendEmail({
            to: 'myteacheronlineclass1@gmail.com',
            subject: `New Private Tutor Request - ${subject}`,
            html: emailHtml
        });

        // Send confirmation email to student
        const confirmationHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Private Tutor Request Received</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    line-height: 1.6;
                    color: #333333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    background-color: #f9f9f9;
                }
                .container {
                    background-color: #ffffff;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
                    overflow: hidden;
                }
                .header {
                    background-color: #4a6ee0;
                    padding: 30px 20px;
                    text-align: center;
                    color: white;
                }
                .header h1 {
                    margin: 0;
                    font-size: 24px;
                    font-weight: 600;
                }
                .content {
                    padding: 30px;
                }
                .success-message {
                    background-color: #d4edda;
                    color: #155724;
                    padding: 20px;
                    border-radius: 6px;
                    margin: 20px 0;
                    border: 1px solid #c3e6cb;
                }
                .next-steps {
                    background-color: #f8f9fa;
                    padding: 20px;
                    border-radius: 6px;
                    margin: 20px 0;
                }
                .next-steps h3 {
                    margin-top: 0;
                    color: #2d3748;
                }
                .next-steps ul {
                    margin-bottom: 0;
                }
                .footer {
                    text-align: center;
                    padding: 20px;
                    font-size: 14px;
                    color: #718096;
                    border-top: 1px solid #e2e8f0;
                    margin-top: 20px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Request Received!</h1>
                    <p>Thank you for your interest in private tutoring</p>
                </div>
                
                <div class="content">
                    <div class="success-message">
                        <h3 style="margin-top: 0;">Thank you, ${name}!</h3>
                        <p>We have successfully received your request for private tutoring in <strong>${subject}</strong>.</p>
                    </div>
                    
                    <p>Our team will review your request and contact you within 24 hours to discuss your learning goals and schedule.</p>
                    
                    <div class="next-steps">
                        <h3>What happens next?</h3>
                        <ul>
                            <li>Our team will review your learning goals and requirements</li>
                            <li>We'll match you with the best instructor for your needs</li>
                            <li>You'll receive a call or email to schedule your first session</li>
                            <li>Start your personalized learning journey!</li>
                        </ul>
                    </div>
                    
                    <p>If you have any questions or need to update your request, please feel free to contact us at <a href="mailto:myteacheronlineclass1@gmail.com" style="color: #4a6ee0;">myteacheronlineclass1@gmail.com</a>.</p>
                </div>
                
                <div class="footer">
                    <p>© ${new Date().getFullYear()} MyTeacher Institute. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
        `;

        await sendEmail({
            to: email,
            subject: 'Your Private Tutor Request Has Been Received',
            html: confirmationHtml
        });

        // Redirect to success page
        return res.redirect('/tutor-request-success');

    } catch (error) {
        console.error('Error creating tutor request:', error);
        return res.status(500).json({
            success: false,
            message: 'Error submitting tutor request',
            error: error.message
        });
    }
});

// DELETE route to remove a tutor request (admin only)
router.delete('/request/:id', authJs, async (req, res) => {
    try {
        const { id } = req.params;
        
        const deletedRequest = await RequestPrivateTutor.findByIdAndDelete(id);
        
        if (!deletedRequest) {
            return res.status(404).json({
                success: false,
                message: 'Tutor request not found'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Tutor request deleted successfully',
            deletedRequest
        });

    } catch (error) {
        console.error('Error deleting tutor request:', error);
        return res.status(500).json({
            success: false,
            message: 'Error deleting tutor request',
            error: error.message
        });
    }
});

// GET route to retrieve all tutor requests (admin only)
router.get('/requests', authJs, async (req, res) => {
    try {
        const requests = await RequestPrivateTutor.find().sort({ createdAt: -1 });
        
        return res.status(200).json({
            success: true,
            message: 'Tutor requests retrieved successfully',
            requests
        });

    } catch (error) {
        console.error('Error retrieving tutor requests:', error);
        return res.status(500).json({
            success: false,
            message: 'Error retrieving tutor requests',
            error: error.message
        });
    }
});

module.exports = router;
