const schedule = require('node-schedule');
const UpcomingLectureBatch = require('../models/upcomingLectureBatch');
const User = require('../models/user');
const sendEmail = require('./sendEmail'); // Using the existing email service

const scheduleLectureReminders = () => {
  // Run every minute to check for upcoming lectures
  schedule.scheduleJob('* * * * *', async () => {
    console.log('Running scheduled job to send lecture reminders...');
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    try {
      // Find batches that are starting now and haven't had a reminder sent
      const upcomingBatches = await UpcomingLectureBatch.find({
        startTime: { $lte: now },
        reminderSent: false,
        booked: { $exists: true, $ne: [] } // Ensure there are booked users
      }).populate('booked', 'email name');

      for (const batch of upcomingBatches) {
        const userEmails = batch.booked.map(user => user.email);

        if (userEmails.length > 0) {
          const emailSubject = `Reminder: Your Lecture "${batch.courseName}" is starting now!`;
          const emailText = `Hello,\n\nThis is a reminder that your lecture, "${batch.courseName}", is scheduled to start now.\n\nPlatform: ${batch.platform}\n\nWe hope you have a great session!\n\nBest regards,\nMyTeacher Team`;
          const emailHtml = `
            <div style="font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
              <div style="background-color: #4a6fdc; padding: 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Lecture Reminder</h1>
              </div>
              <img src="${batch.courseImage || 'https://myteacher.institute/assets/Untitled-1-DN2sZebx.png'}" alt="Course Image" style="width: 100%; height: auto; display: block;">
              <div style="padding: 20px 30px;">
                <h2 style="color: #333333; font-size: 20px;">Hello!</h2>
                <p style="color: #555555; font-size: 16px; line-height: 1.6;">
                  This is a friendly reminder that your lecture, "<strong>${batch.courseName}</strong>", is scheduled to start now.
                </p>
                <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; text-align: center; margin: 20px 0;">
                  <p style="color: #555555; font-size: 16px; margin: 0;">
                    <strong>Platform:</strong> ${batch.platform}
                  </p>
                </div>
                <p style="color: #555555; font-size: 16px; line-height: 1.6;">
                  We hope you have a great and productive session!
                </p>
                <p style="color: #555555; font-size: 16px; line-height: 1.6; margin-top: 30px;">
                  Best regards,<br><strong>The MyTeacher Team</strong>
                </p>
              </div>
              <div style="text-align: center; padding: 20px; color: #999999; font-size: 12px; background-color: #f1f1f1; border-top: 1px solid #e0e0e0;">
                <p style="margin: 0;">This is an automated message. Please do not reply.</p>
                <p style="margin: 5px 0 0;">${new Date().getFullYear()} MyTeacher App. All rights reserved.</p>
              </div>
            </div>
          `;
          
          await sendEmail({
            to: userEmails,
            subject: emailSubject,
            text: emailText,
            html: emailHtml
          });

          console.log(`Sent start-time reminder for batch: ${batch.courseName}`);
        }

        // Mark the reminder as sent
        batch.reminderSent = true;
        await batch.save();
      }

      // Find batches that started 24 hours ago and haven't had a follow-up reminder sent
      const followUpBatches = await UpcomingLectureBatch.find({
        startTime: { $lte: twentyFourHoursAgo },
        reminderSent: true, // Ensure the first reminder was sent
        nextDayReminderSent: false,
        booked: { $exists: true, $ne: [] }
      }).populate('booked', 'email name');

      for (const batch of followUpBatches) {
        const userEmails = batch.booked.map(user => user.email);

        if (userEmails.length > 0) {
          const emailSubject = `Follow-up: How was your lecture "${batch.courseName}"?`;
          const emailText = `Hello,\n\nWe hope you enjoyed your lecture, "${batch.courseName}", which took place yesterday.\n\nWe would love to hear your feedback. If you have any questions or comments, please don't hesitate to reach out.\n\nBest regards,\nMyTeacher Team`;
          const emailHtml = `
            <div style="font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif; max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
              <div style="background-color: #4a6fdc; padding: 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">We Value Your Feedback!</h1>
              </div>
              <img src="${batch.courseImage || 'https://myteacher.institute/assets/Untitled-1-DN2sZebx.png'}" alt="Course Image" style="width: 100%; height: auto; display: block;">
              <div style="padding: 20px 30px;">
                <h2 style="color: #333333; font-size: 20px;">Hello!</h2>
                <p style="color: #555555; font-size: 16px; line-height: 1.6;">
                  We hope you enjoyed your lecture, "<strong>${batch.courseName}</strong>", which took place yesterday.
                </p>
                <p style="color: #555555; font-size: 16px; line-height: 1.6;">
                  Your feedback is important to us! If you have any questions or comments, please don't hesitate to reach out.
                </p>
                <p style="color: #555555; font-size: 16px; line-height: 1.6; margin-top: 30px;">
                  Best regards,<br><strong>The MyTeacher Team</strong>
                </p>
              </div>
              <div style="text-align: center; padding: 20px; color: #999999; font-size: 12px; background-color: #f1f1f1; border-top: 1px solid #e0e0e0;">
                <p style="margin: 0;">This is an automated message. Please do not reply.</p>
                <p style="margin: 5px 0 0;">${new Date().getFullYear()} MyTeacher App. All rights reserved.</p>
              </div>
            </div>
          `;

          await sendEmail({
            to: userEmails,
            subject: emailSubject,
            text: emailText,
            html: emailHtml
          });
          
          console.log(`Sent next-day follow-up for batch: ${batch.courseName}`);
        }
        
        // Mark the next-day reminder as sent
        batch.nextDayReminderSent = true;
        await batch.save();
      }

    } catch (error) {
      console.error('Error in scheduled job for sending lecture reminders:', error);
    }
  });
};

module.exports = { scheduleLectureReminders };