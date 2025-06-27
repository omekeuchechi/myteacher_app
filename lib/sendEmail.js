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

const sendEmail = async (to, subject, html) => {
    if (!transporter) {
        await initTransporter();
    }

    const from = process.env.STAG === 'PRODUCTION' 
        ? `"Your App" <${process.env.EMAIL_USER}>`
        : 'noreply@ethereal.email';

    const info = await transporter.sendMail({
        from,
        to,
        subject,
        html
    });

    // In development, log the Ethereal preview URL
    if (process.env.STAG !== 'PRODUCTION') {
        console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }

    return info;
};

module.exports = sendEmail;
