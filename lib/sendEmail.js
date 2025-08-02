const nodemailer = require('nodemailer');
require('dotenv').config();

// Configure nodemailer based on environment
let transporter;
let isInitializing = false;
const initTransporter = async () => {
    // If already initialized, return the existing transporter
    if (transporter) {
        console.log('Using existing transporter');
        return transporter;
    }
    
    // Prevent multiple initializations
    if (isInitializing) {
        console.log('Transporter initialization already in progress, waiting...');
        // Wait for the initialization to complete
        await new Promise(resolve => {
            const checkInitialized = setInterval(() => {
                if (transporter) {
                    clearInterval(checkInitialized);
                    resolve();
                }
            }, 100);
        });
        return;
    }
    
    isInitializing = true;

    try {
        if (process.env.STAG === 'PRODUCTION') {
            console.log('Initializing Gmail SMTP...');
            if (!process.env.GMAIL_APP_EMAIL || !process.env.GMAIL_APP_PASSWORD) {
                throw new Error('Gmail credentials not found in environment variables');
            }
            
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
            console.log('Initializing Ethereal test SMTP...');
            try {
                const testAccount = await nodemailer.createTestAccount();
                
                transporter = nodemailer.createTransport({
                    host: 'smtp.ethereal.email',
                    port: 587,
                    secure: false, // true for 465, false for other ports
                    auth: {
                        user: testAccount.user,
                        pass: testAccount.pass
                    },
                    debug: true,
                    logger: true
                });
                
                console.log('✅ Ethereal test account created:', testAccount.user);
                console.log('📧 View sent emails at: https://ethereal.email/login');
                console.log('🔑 Login with these credentials:');
                console.log(`   Email: ${testAccount.user}`);
                console.log(`   Password: ${testAccount.pass}`);
                
            } catch (error) {
                console.error('❌ Error creating Ethereal test account:', error);
                throw error;
            }
        }
    } catch (error) {
        console.error('❌ Failed to initialize email transporter:', error);
        throw error;
    } finally {
        isInitializing = false;
    }
};

// Initialize the transporter on startup
if (process.env.STAG !== 'PRODUCTION') {
    initTransporter().catch(error => {
        console.error('❌ Failed to initialize email transporter:', error);
        // Don't crash the app if email fails to initialize
    });
}

const sendEmail = async (options) => {
    const { to, subject, html, attachments = [] } = options;
    const emailId = Math.random().toString(36).substring(2, 8);
    console.log(`[${emailId}] Preparing to send email to:`, to);
    
    if (!to) {
        const error = new Error('No recipient email address provided');
        console.error(`[${emailId}] Email error:`, error.message);
        throw error;
    }

    // Ensure transporter is properly initialized
    if (!transporter) {
        console.log(`[${emailId}] Initializing email transporter...`);
        try {
            await initTransporter();
            if (!transporter) {
                throw new Error('Transporter not initialized after initTransporter()');
            }
            console.log(`[${emailId}] Transporter initialized successfully`);
        } catch (error) {
            console.error(`[${emailId}] Failed to initialize transporter:`, error);
            throw new Error(`Failed to initialize email transporter: ${error.message}`);
        }
    }

    // Set the 'From' address based on the environment
    let from;
    if (process.env.STAG === 'PRODUCTION') {
        // For production, use the Gmail app email
        const emailUser = process.env.GMAIL_APP_EMAIL;
        const appName = process.env.APP_NAME || 'MyTeacher App';
        
        if (!emailUser || !emailUser.includes('@')) {
            throw new Error('Invalid or missing GMAIL_APP_EMAIL environment variable');
        }
        
        // Format: "Display Name <email@example.com>"
        from = `"${appName}" <${emailUser}>`;
    } else {
        // For development, use Ethereal
        const testAccount = await nodemailer.createTestAccount();
        const appName = process.env.APP_NAME || 'Test Sender';
        // Format: "Display Name <email@example.com>"
        from = `"${appName}" <${testAccount.user}>`;
        
        // Update the transporter with the new test account
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
    }

    try {
        console.log(`[${emailId}] Creating email with subject:`, subject);
        const mailOptions = {
            from,
            to,
            subject: `[${emailId}] ${subject}`, // Add ID to subject for tracking
            html,
            headers: {
                'X-Email-ID': emailId,
                'X-App-Name': process.env.APP_NAME || 'Learning-Platform'
            },
            attachments: attachments.map(attachment => ({
                filename: attachment.filename,
                content: attachment.content,
                contentType: attachment.contentType || 'application/octet-stream'
            }))
        };

        console.log(`[${emailId}] Email prepared:`, {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject,
            hasAttachments: mailOptions.attachments.length > 0,
            environment: process.env.STAG || 'development'
        });

        console.log(`[${emailId}] Sending email...`);
        const startTime = Date.now();
        
        const info = await transporter.sendMail(mailOptions);
        
        const endTime = Date.now();
        console.log(`[${emailId}] Email sent in ${endTime - startTime}ms`);
        console.log(`[${emailId}] SMTP Response:`, info.response);

        if (process.env.STAG !== 'PRODUCTION') {
            const previewUrl = nodemailer.getTestMessageUrl(info);
            if (previewUrl) {
                console.log(`[${emailId}] ✅ Email sent successfully!`);
                console.log(`[${emailId}] 📧 Preview URL:`, previewUrl);
                console.log(`[${emailId}] 💡 Note: Ethereal emails are temporary. Save this URL to view the email.`);
            } else {
                console.warn(`[${emailId}] ⚠️ Email sent, but could not generate preview URL`);
                console.log(`[${emailId}] Full response:`, JSON.stringify(info, null, 2));
            }
        } else {
            console.log(`[${emailId}] ✅ Email sent successfully to: ${to}`);
            console.log(`[${emailId}] Message ID:`, info.messageId);
        }

        return {
            ...info,
            emailId,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error(`[${emailId}] ❌ Error sending email:`, error);
        console.error(`[${emailId}] Error details:`, {
            code: error.code,
            command: error.command,
            stack: error.stack
        });
        throw error;
    }
};

// Export the sendEmail function
module.exports = sendEmail;