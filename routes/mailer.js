const express = require('express');
const router = express.Router();
const Mailer = require('../models/mailer');
const User = require('../models/user');
const authJs = require('../middlewares/auth');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Configure nodemailer based on environment
let transporter;

const initTransporter = async () => {
    if (process.env.STAG === 'PRODUCTION') {
        // Production configuration (Gmail SMTP)
        transporter = nodemailer.createTransport({
            service: 'gmail',
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
                user: process.env.GMAIL_APP_EMAIL,
                pass: process.env.GMAIL_APP_PASSWORD
            },
            debug: true,
            logger: true
        });
        console.log('✅ Gmail SMTP transporter ready');
    } else {
        // Development configuration (Ethereal)
        try {
            const testAccount = await nodemailer.createTestAccount();
            transporter = nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false,
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass
                },
                debug: true,
                logger: true
            });
            console.log('✅ Ethereal test account created:', testAccount.user);
            console.log('🔑 Password:', testAccount.pass);
            console.log('📧 View sent emails at: https://ethereal.email/login');
        } catch (error) {
            console.error('❌ Error creating Ethereal test account:', error);
            throw error;
        }
    }
};

// Initialize the transporter
initTransporter().catch(console.error);

// Generate email HTML template
const generateEmailTemplate = (content, title = 'MyTeacher App Notification') => {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <div style="background-color: #4a6fdc; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: white; margin: 0;">${title}</h1>
            </div>
            <div style="padding: 20px;">
                ${content}
                <p style="margin-top: 30px;">
                    <strong>Time:</strong> ${new Date().toLocaleString()}<br>
                    <strong>Environment:</strong> ${process.env.STAG || 'development'}
                </p>
            </div>
            <div style="text-align: center; padding: 20px; color: #666; font-size: 14px; border-top: 1px solid #e0e0e0;">
                <p>This is an automated message from MyTeacher App. Please do not reply to this email.</p>
                <p>© ${new Date().getFullYear()} MyTeacher App. All rights reserved.</p>
            </div>
        </div>
    `;
};

// Send email to all users (Admin only)
router.post('/send-to-all', authJs, async (req, res) => {
    try {
        const { subject, text, html } = req.body;

        const isAdmin = req.decoded && req.decoded.isAdmin;
        if (!isAdmin) {
            return res.status(403).json({ message: "Unauthorized, admin only" });
        }

        if (!subject || !text) {
            return res.status(400).json({ message: 'Subject and text content are required' });
        }
        
        // Get all active users
        const users = await User.find({ isVerified: true }, 'email');
        const emails = users.map(user => user.email);
        
        // Generate HTML content if not provided
        const emailHtml = html || generateEmailTemplate(text.replace(/\n/g, '<br>'), subject);
        
        // Create mailer record
        const mail = new Mailer({
            to: emails,
            subject,
            text: text || '',
            html: emailHtml,
            metadata: {
                sentBy: req.user._id,
                type: 'bulk',
                totalRecipients: emails.length
            }
        });
        
        // Send email
        const info = await transporter.sendMail({
            from: `"${process.env.APP_NAME || 'MyTeacher App'}" <${process.env.GMAIL_APP_EMAIL}>`,
            to: emails.join(','),
            subject,
            text: text || '',
            html: emailHtml
        });

        if (process.env.STAG !== 'PRODUCTION') {
            console.log('📧 Email sent! Preview URL: %s', nodemailer.getTestMessageUrl(info));
        } else {
            console.log('📧 Email sent to %d recipients', emails.length);
        }
        
        // Update mailer record
        mail.status = 'sent';
        mail.sentAt = new Date();
        await mail.save();
        
        res.status(200).json({ 
            message: `Email sent to ${emails.length} users successfully`,
            mailId: mail._id,
            previewUrl: process.env.STAG !== 'PRODUCTION' ? nodemailer.getTestMessageUrl(info) : null
        });
    } catch (error) {
        console.error('❌ Error sending email to all users:', error);
        res.status(500).json({ 
            message: 'Failed to send email', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Send email to a specific user (Admin only)
router.post('/send-to-user/:userId', authJs, async (req, res) => {
    try {   
        const { subject, text, html } = req.body;
        const { userId } = req.params;

        const isAdmin = req.decoded && req.decoded.isAdmin;
        if (!isAdmin) {
          return res.status(403).json({ message: "Unauthorized, admin only" });
        }
        
        // Find the user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        // Generate HTML content if not provided
        const emailHtml = html || generateEmailTemplate(text.replace(/\n/g, '<br>'), subject);
        
        // Create mailer record
        const mail = new Mailer({
            to: [user.email],
            subject,
            text: text || '',
            html: emailHtml,
            metadata: {
                sentBy: req.user._id,
                type: 'single',
                recipient: userId
            }
        });
        
        // Send email
        const info = await transporter.sendMail({
            from: `"${process.env.APP_NAME || 'MyTeacher App'}" <${process.env.GMAIL_APP_EMAIL}>`,
            to: user.email,
            subject,
            text: text || '',
            html: emailHtml
        });

        if (process.env.STAG !== 'PRODUCTION') {
            console.log('📧 Email sent! Preview URL: %s', nodemailer.getTestMessageUrl(info));
        } else {
            console.log('📧 Email sent to user');
        }
        
        // Update mailer record
        mail.status = 'sent';
        mail.sentAt = new Date();
        await mail.save();
        
        res.status(200).json({ 
            message: 'Email sent to user successfully',
            mailId: mail._id,
            previewUrl: process.env.STAG !== 'PRODUCTION' ? nodemailer.getTestMessageUrl(info) : null
        });
    } catch (error) {
        console.error('❌ Error sending email to user:', error);
        res.status(500).json({ 
            message: 'Failed to send email', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Send email to all admins (Super Admin only)
router.post('/send-to-admins', authJs, async (req, res) => {
    try {
        const { subject, text, html } = req.body;

        const isAdmin = req.decoded && req.decoded.isAdmin;
        if (!isAdmin) {
          return res.status(403).json({ message: "Unauthorized, admin only" });
        }
        
        // Get all admins and super admins
        const admins = await User.find({
            $or: [{ isAdmin: true }, { isSuperAdmin: true }],
            isSuspended: false
        }, 'email');
        
        const adminEmails = admins.map(admin => admin.email);
        
        // Generate HTML content if not provided
        const emailHtml = html || generateEmailTemplate(text.replace(/\n/g, '<br>'), subject);
        
        // Create mailer record
        const mail = new Mailer({
            to: adminEmails,
            subject,
            text: text || '',
            html: emailHtml,
            metadata: {
                sentBy: req.user._id,
                type: 'admin-bulk',
                totalRecipients: adminEmails.length
            }
        });
        
        // Send email
        const info = await transporter.sendMail({
            from: `"${process.env.APP_NAME || 'MyTeacher App'}" <${process.env.GMAIL_APP_EMAIL}>`,
            to: adminEmails.join(','),
            subject,
            text: text || '',
            html: emailHtml
        });

        if (process.env.STAG !== 'PRODUCTION') {
            console.log('📧 Email sent! Preview URL: %s', nodemailer.getTestMessageUrl(info));
        } else {
            console.log('📧 Email sent to %d admins', adminEmails.length);
        }
        
        // Update mailer record
        mail.status = 'sent';
        mail.sentAt = new Date();
        await mail.save();
        
        res.status(200).json({ 
            message: `Email sent to ${adminEmails.length} admins successfully`,
            mailId: mail._id,
            previewUrl: process.env.STAG !== 'PRODUCTION' ? nodemailer.getTestMessageUrl(info) : null
        });
    } catch (error) {
        console.error('❌ Error sending email to admins:', error);
        res.status(500).json({ 
            message: 'Failed to send email to admins', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Send email to a specific admin (Super Admin only)
router.post('/send-to-admin/:adminId', authJs, async (req, res) => {
    try {
        const { subject, text, html } = req.body;
        const { adminId } = req.params;
        
        // Find the admin
        const admin = await User.findOne({
            _id: adminId,
            $or: [{ isAdmin: true }, { isSuperAdmin: true }]
        });
        
        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }
        
        // Generate HTML content if not provided
        const emailHtml = html || generateEmailTemplate(text.replace(/\n/g, '<br>'), subject);
        
        // Create mailer record
        const mail = new Mailer({
            to: [admin.email],
            subject,
            text: text || '',
            html: emailHtml,
            metadata: {
                sentBy: req.user._id,
                type: 'admin-single',
                recipient: adminId
            }
        });
        
        // Send email
        const info = await transporter.sendMail({
            from: `"${process.env.APP_NAME || 'MyTeacher App'}" <${process.env.GMAIL_APP_EMAIL}>`,
            to: admin.email,
            subject,
            text: text || '',
            html: emailHtml
        });

        if (process.env.STAG !== 'PRODUCTION') {
            console.log('📧 Email sent! Preview URL: %s', nodemailer.getTestMessageUrl(info));
        } else {
            console.log('📧 Email sent to admin');
        }
        
        // Update mailer record
        mail.status = 'sent';
        mail.sentAt = new Date();
        await mail.save();
        
        res.status(200).json({ 
            message: 'Email sent to admin successfully',
            mailId: mail._id,
            previewUrl: process.env.STAG !== 'PRODUCTION' ? nodemailer.getTestMessageUrl(info) : null
        });
    } catch (error) {
        console.error('❌ Error sending email to admin:', error);
        res.status(500).json({ 
            message: 'Failed to send email to admin', 
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Get all sent emails (Admin only)
router.get('/history', authJs, async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const mails = await Mailer.find()
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();
            
        const count = await Mailer.countDocuments();
        
        res.status(200).json({
            mails,
            totalPages: Math.ceil(count / limit),
            currentPage: page
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching email history', error: error.message });
    }
});

module.exports = router;