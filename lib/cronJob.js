const cron = require('node-cron');
const Assignment = require('../models/assignment');
const Correction = require('../models/correction');
const { getAIScoreAndCorrection } = require('../utils/aiService');

// Schedule the job to run every hour
const scheduleAIGrading = () => {
    cron.schedule('0 * * * *', async () => {
        console.log('Running hourly check for unscored assignments...');

        try {
            // Find assignments with ungraded submissions
            const assignmentsToGrade = await Assignment.find({ 'submissions.graded': false });

            for (const assignment of assignmentsToGrade) {
                for (const submission of assignment.submissions) {
                    if (!submission.graded) {
                        console.log(`AI is scoring submission ${submission._id} for student ${submission.student}...`);

                        // Get AI score and correction
                        const { score, correction } = await getAIScoreAndCorrection(submission.submission);

                        // Save the correction
                        await Correction.create({
                            assignment: assignment._id,
                            student: submission.student,
                            submissionId: submission._id,
                            score,
                            correction,
                            correctedBy: 'ai'
                        });

                        // Update the submission in the assignment document
                        submission.score = score;
                        submission.graded = true;

                        console.log(`Submission ${submission._id} scored by AI with a score of ${score}.`);
                    }
                }
                // Save the changes to the assignment
                await assignment.save();
            }
        } catch (error) {
            console.error('Error during AI grading cron job:', error);
        }
    });
};

module.exports = { scheduleAIGrading };
