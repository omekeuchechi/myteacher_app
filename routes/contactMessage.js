const express = require('express');
const router = express.Router();
const ContactMessage = require('../models/contactMessage');
const authJs = require('../middlewares/auth');
const isSuperAdmin = require('../middlewares/isSuperAdmin');
const sendEmail = require('../lib/sendEmail');
const User = require('../models/user');

// create a contact message
router.post('/create', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        
        // Validate input
        if (!name || !email || !message) {
            return res.status(400).json({ 
                success: false,
                message: "Name, email and message are required"
            });
        }
        
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false,
                message: "Please provide a valid email address"
            });
        }
        
        // Check if email exists in our system
        const userExists = await User.findOne({ email });
        const actionLink = userExists 
            ? `${process.env.CLIENT_URL}/`
            : `${process.env.CLIENT_URL}/auth`;
        const actionText = userExists ? 'Go to Home' : 'Create Account';
        
        // Save contact message
        const contactMessage = new ContactMessage({ name, email, message });
        await contactMessage.save();
        
        // Send thank you email
        const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Thank You for Contacting Us</h2>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
                <p style="font-size: 16px;">Hello ${name},</p>
                <p>Thank you for sharing your thoughts with us. We appreciate your feedback and will get back to you soon.</p>
                
                <div style="margin: 20px 0; text-align: center;">
                    <a href="${actionLink}" 
                       style="background-color: #3498db; color: white; padding: 10px 20px; 
                              text-decoration: none; border-radius: 5px; display: inline-block;">
                        ${actionText}
                    </a>
                </div>
            </div>
            
            <p style="text-align: center; color: #7f8c8d;">
                If you have any further questions, please don't hesitate to contact us again.
            </p>
        </div>
        `;
        
        try {
            await sendEmail({
                to: email,
                subject: 'Thank You for Contacting Us',
                html: emailHtml
            });
        } catch (emailError) {
            console.error('Failed to send thank you email:', emailError);
        }
        
        res.json({ 
            success: true,
            message: "Contact message created",
            isRegistered: !!userExists
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false,
            message: "Error creating contact message", 
            error: error.message 
        });
    }
});

// list all the contact messages
router.get('/list', authJs, isSuperAdmin, async (req, res) => {
    try {
        const contactMessages = await ContactMessage.find();
        res.json({ contactMessages });
    } catch (error) {
        res.status(500).json({ message: "Error fetching contact messages", error: error.message });
    }
});

// delete a contact message
router.delete('/delete/:contactMessageId', authJs, isSuperAdmin, async (req, res) => {
    try {
        const { contactMessageId } = req.params;
        const contactMessage = await ContactMessage.findByIdAndDelete(contactMessageId);
        if (!contactMessage) {
            return res.status(404).json({ message: "Contact message not found" });
        }
        res.json({ message: "Contact message deleted" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting contact message", error: error.message });
    }
});

module.exports = router;
