const sendEmail = require('./lib/sendEmail');
require('dotenv').config();

async function testEmail() {
    try {
        console.log('Starting email test...');
        
        const testEmail = process.env.TEST_EMAIL || 'omekejoseph97@gmail.com';
        const subject = '🚀 MyTeacher App - Test Email';
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
                <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Test Email</h2>
                <p>This is a test email sent from MyTeacher App.</p>
                <p>If you're seeing this, email sending is working correctly!</p>
                <p style="margin-top: 30px; color: #7f8c8d; font-size: 12px;">This is an automated message. Please do not reply.</p>
            </div>
        `;

        console.log(`Sending test email to: ${testEmail}`);
        const result = await sendEmail({
            to: testEmail,
            subject: subject,
            html: html
        });
        
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
