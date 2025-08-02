const Lecture = require('../models/lecture');
const { scheduleJob } = require('node-schedule');
const sendEmail = require('./sendEmail');

// Function to update past lectures to future dates
const updatePastLectures = async () => {
  try {
    const now = new Date();
    const pastLectures = await Lecture.find({ 
      startTime: { $lt: now } 
    }).populate('studentsEnrolled lecturesListed');

    const updatePromises = pastLectures.map(lecture => {
      // Set new start time to tomorrow at same hour
      const newStartTime = new Date(now);
      newStartTime.setDate(newStartTime.getDate() + 1);
      newStartTime.setHours(lecture.startTime.getHours());
      newStartTime.setMinutes(lecture.startTime.getMinutes());
      
      // Notify users about rescheduling
      const recipients = [
        ...lecture.lecturesListed.map(a => a.email),
        ...lecture.studentsEnrolled.map(s => s.email)
      ];
      
      sendEmail({
        to: recipients,
        subject: 'Lecture Rescheduled',
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Lecture Rescheduled</h2>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
                <p style="font-size: 16px;">Hello,</p>
                <p>Your lecture has been automatically rescheduled:</p>
                
                <h3 style="color: #3498db; margin: 15px 0;">${lecture.title}</h3>
                
                <div style="margin: 20px 0;">
                    <p><strong>New Start Time:</strong> ${newStartTime.toLocaleString()}</p>
                    <p><strong>Platform:</strong> ${lecture.platform}</p>
                    ${lecture.zoomLink ? `<p><strong>Join Link:</strong> <a href="${lecture.zoomLink}">Click here to join</a></p>` : ''}
                </div>
            </div>
            
            <p style="text-align: center; color: #7f8c8d;">
                <a href="${process.env.CLIENT_URL}" style="color: #3498db; text-decoration: none;">View in MyTeacher</a>
            </p>
        </div>
        `
      });

      return Lecture.findByIdAndUpdate(
        lecture._id,
        { startTime: newStartTime },
        { new: true }
      );
    });

    const updatedLectures = await Promise.all(updatePromises);
    console.log(`Updated ${updatedLectures.length} past lectures to future dates`);
    return updatedLectures;
  } catch (error) {
    console.error('Error updating past lectures:', error);
    throw error;
  }
};

// Schedule to run every day at midnight
const scheduleLectureUpdates = () => {
  // For testing, run every 5 minutes
  const testSchedule = '*/5 * * * *';
  
  // For production, run daily at midnight
  const prodSchedule = '0 0 * * *';
  
  scheduleJob(testSchedule, updatePastLectures);
  console.log('Lecture date scheduler initialized');
};

module.exports = {
  updatePastLectures,
  scheduleLectureUpdates
};