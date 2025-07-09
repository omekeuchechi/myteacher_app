const express = require('express');
const router = express.Router();
const Mailer = require('../models/mailer');
const User = require('../models/user');
const authJs = require('../middlewares/auth');
const nodemailer = require('nodemailer');


// Configure nodemailer based on environment
let transporter;

const initTransporter = async () => {
    if (process.env.STAG === 'PRODUCTION') {
        // Production configuration (Mailtrap)
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT),
            secure: process.env.EMAIL_SECURE === 'true',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        console.log('Using Mailtrap for email in production environment');
    } else {
        // Development configuration (Ethereal) - Using STAG=development
        try {
            const testAccount = await nodemailer.createTestAccount();
            transporter = nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false,
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass
                }
            });
            console.log('Ethereal test account created:', testAccount.user);
        } catch (error) {
            console.error('Error creating Ethereal test account:', error);
            throw error;
        }
    }
};

// Initialize the transporter
initTransporter().catch(console.error);

// Send email to all users (Admin only)
router.post('/send-to-all', authJs, async (req, res) => {
    try {
        const { subject, text, html } = req.body;

        const isAdmin = req.decoded && req.decoded.isAdmin;

        if (!isAdmin) {
          return res.status(403).json({ message: "Unauthorized, admin only" });
        }

        if (!subject || !text || !html) {
            return res.status(400).json({ message: 'Subject, text, and HTML are required' });
        }
        
        // Get all active users
        const users = await User.find({ isVerified: true }, 'email');
        const emails = users.map(user => user.email);
        
        // Create mailer record
        const mail = new Mailer({
            to: emails,
            subject,
            text: text || '',
            html: html || '',
            metadata: {
                sentBy: req.user._id,
                type: 'bulk',
                totalRecipients: emails.length
            }
        });
        
        // Send email
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || `"${process.env.COMPANYNAME || 'MyTeacher App'}" <${process.env.EMAIL_FROM || 'noreply@myteacherapp.com'}>`,
            to: emails.join(','),
            subject,
            text: text || '',
            html: html || ''
        });

        if (process.env.STAG !== 'PRODUCTION') {
            console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
        }
        
        // Update mailer record
        mail.status = 'sent';
        mail.sentAt = new Date();
        await mail.save();
        
        res.status(200).json({ message: 'Email sent to all users successfully', mail });
    } catch (error) {
        console.error('Error sending email to all users:', error);
        res.status(500).json({ message: 'Failed to send email', error: error.message });
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
        
        // Create mailer record
        const mail = new Mailer({
            to: [user.email],
            subject,
            text: text || '',
            html: html || '',
            metadata: {
                sentBy: req.user._id,
                type: 'single',
                recipient: userId
            }
        });
        
        // Send email
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || mail.from,
            to: user.email,
            subject,
            text: text || '',
            html: html || ''
        });

        if (process.env.STAG !== 'PRODUCTION') {
            console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
        }
        
        // Update mailer record
        mail.status = 'sent';
        mail.sentAt = new Date();
        await mail.save();
        
        res.status(200).json({ message: 'Email sent to user successfully', mail });
    } catch (error) {
        console.error('Error sending email to user:', error);
        res.status(500).json({ message: 'Failed to send email', error: error.message });
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
        
        // Create mailer record
        const mail = new Mailer({
            to: adminEmails,
            subject,
            text: text || '',
            html: html || '',
            metadata: {
                sentBy: req.user._id,
                type: 'admin-bulk',
                totalRecipients: adminEmails.length
            }
        });
        
        // Send email
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || mail.from,
            to: adminEmails.join(','),
            subject,
            text: text || '',
            html: html || ''
        });

        if (process.env.STAG !== 'PRODUCTION') {
            console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
        }
        
        // Update mailer record
        mail.status = 'sent';
        mail.sentAt = new Date();
        await mail.save();
        
        res.status(200).json({ message: 'Email sent to all admins successfully', mail });
    } catch (error) {
        console.error('Error sending email to admins:', error);
        res.status(500).json({ message: 'Failed to send email to admins', error: error.message });
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
        
        // Create mailer record
        const mail = new Mailer({
            to: [admin.email],
            subject,
            text: text || '',
            html: html || '',
            metadata: {
                sentBy: req.user._id,
                type: 'admin-single',
                recipient: adminId
            }
        });
        
        // Send email
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || mail.from,
            to: admin.email,
            subject,
            text: text || '',
            html: html || ''
        });

        if (process.env.STAG !== 'PRODUCTION') {
            console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
        }
        
        // Update mailer record
        mail.status = 'sent';
        mail.sentAt = new Date();
        await mail.save();
        
        res.status(200).json({ message: 'Email sent to admin successfully', mail });
    } catch (error) {
        console.error('Error sending email to admin:', error);
        res.status(500).json({ message: 'Failed to send email to admin', error: error.message });
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