const Lecture = require('../models/lecture');
const { scheduleJob } = require('node-schedule');

// Function to update past lectures to future dates
const updatePastLectures = async () => {
  try {
    const now = new Date();
    const pastLectures = await Lecture.find({ 
      startTime: { $lt: now } 
    });

    const updatePromises = pastLectures.map(lecture => {
      // Set new start time to tomorrow at same hour
      const newStartTime = new Date(now);
      newStartTime.setDate(newStartTime.getDate() + 1);
      newStartTime.setHours(lecture.startTime.getHours());
      newStartTime.setMinutes(lecture.startTime.getMinutes());
      
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
  console.log('Lecture date scheduler initialized - running every 5 minutes for testing');
};

module.exports = {
  updatePastLectures,
  scheduleLectureUpdates
};
