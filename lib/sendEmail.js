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
            console.log('View emails at: https://ethereal.email/');
        } catch (error) {
            console.error('Error creating Ethereal test account:', error);
            throw error;
        }
    }
};

// Initialize the transporter
initTransporter().catch(console.error);

const sendEmail = async (to, subject, html, attachments = []) => {
    console.log('Preparing to send email to:', to);
    if (!to) {
        const error = new Error('No recipient email address provided');
        console.error('Email error:', error.message);
        throw error;
    }

    if (!transporter) {
        console.log('Initializing email transporter...');
        await initTransporter();
    }

    const from = process.env.STAG === 'PRODUCTION' 
        ? `"${process.env.APP_NAME || 'Learning Platform'}" <${process.env.EMAIL_USER}>`
        : 'noreply@ethereal.email';

    try {
        console.log('Creating email with subject:', subject);
        const mailOptions = {
            from,
            to,
            subject,
            html,
            attachments: attachments.map(attachment => ({
                filename: attachment.filename,
                content: attachment.content,
                contentType: attachment.contentType || 'application/octet-stream'
            }))
        };
        console.log('Email options prepared, sending...');

        console.log('Sending email with options:', {
            to,
            subject,
            hasAttachments: attachments.length > 0
        });

        console.log('Sending email through transporter...');
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent, response received:', info.response);

        // In development, log the Ethereal preview URL
        if (process.env.STAG !== 'PRODUCTION') {
            const previewUrl = nodemailer.getTestMessageUrl(info);
            if (previewUrl) {
                console.log('✅ Email sent successfully!');
                console.log('📧 Preview URL:', previewUrl);
                console.log('💡 Note: Ethereal emails are temporary. Save this URL to view the email.');
            } else {
                console.warn('⚠️ Email sent, but could not generate preview URL');
                console.log('Full response:', JSON.stringify(info, null, 2));
            }
        } else {
            console.log(`✅ Email sent successfully to: ${to}`);
        }

        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};