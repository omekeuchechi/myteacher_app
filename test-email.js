const sendEmail = require('./lib/sendEmail');
require('dotenv').config();

async function testEmail() {
    try {
        console.log('Starting email test...');
        
        const testEmail = process.env.TEST_EMAIL || 'omekejoseph97@gmail.com';
        const subject = '🚀 MyTeacher App - Test Email';
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #2c3e50;">Test Email</h1>
                <p>This is a test email from MyTeacher App.</p>
                <p>If you're seeing this, your email setup is working correctly! 🎉</p>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Environment:</strong> ${process.env.STAG || 'development'}</p>
            </div>
        `;

        console.log(`Sending test email to: ${testEmail}`);
        const result = await sendEmail(testEmail, subject, html);
        
        console.log('✅ Email sent successfully!');
        console.log('Message ID:', result.messageId);
        
        if (process.env.STAG !== 'PRODUCTION') {
            console.log('📧 Preview URL:', nodemailer.getTestMessageUrl(result));
        }
        
        return result;
    } catch (error) {
        console.error('❌ Error sending test email:');
        console.error(error);
        throw error;
    }
}

// Run the test
testEmail()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
