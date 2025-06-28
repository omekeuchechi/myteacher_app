const mongoose = require('mongoose');

// This schema will store the score for a specific lecture batch
const lectureScoreSchema = new mongoose.Schema({
    lecture: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lecture', // Assuming the lecture batch model is named 'Lecture'
        required: true
    },
    score: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    assignmentsGraded: {
        type: Number,
        default: 0,
        max: 4
    },
    certificateIssued: {
        type: Boolean,
        default: false
    }
}, { _id: false });

const certificateSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true // Each user has only one certificate document
    },
    certScores: [lectureScoreSchema] // Array of scores for each lecture batch
}, { timestamps: true });

// Method to add or update a score for a lecture
certificateSchema.statics.updateScore = async function(userId, lectureId, assignmentScore) {
    let certificate = await this.findOne({ user: userId });

    if (!certificate) {
        // This case should ideally be handled by enrollment logic
        // Creating a new certificate when a score is first added.
        certificate = new this({ user: userId, certScores: [] });
    }

    let lectureScore = certificate.certScores.find(
        (cs) => cs.lecture.equals(lectureId)
    );

    if (lectureScore) {
        // If the lecture score already exists, update it, ensuring not to exceed 4 assignments
        if (lectureScore.assignmentsGraded < 4) {
            // Calculate new score ensuring it doesn't exceed 100
            const newScore = lectureScore.score + assignmentScore;
            lectureScore.score = Math.min(newScore, 100);
            lectureScore.assignmentsGraded += 1;
        } else {
            // Handle case where more than 4 assignments are submitted
            console.log(`User ${userId} has already submitted 4 assignments for lecture ${lectureId}`);
        }
    } else {
        // If the lecture score doesn't exist, add it. This happens on the first assignment submission for a lecture.
        // Ensure the initial score doesn't exceed 100
        const initialScore = Math.min(assignmentScore, 100);
        certificate.certScores.push({ 
            lecture: lectureId, 
            score: initialScore, 
            assignmentsGraded: 1 
        });
    }

    return certificate.save();
};

// Static method to handle enrollment in a new lecture batch
certificateSchema.statics.enrollInLecture = async function(userId, lectureId) {
    let certificate = await this.findOne({ user: userId });

    if (!certificate) {
        // If no certificate doc exists for the user, create one.
        certificate = new this({ user: userId, certScores: [] });
    }

    const isEnrolled = certificate.certScores.some(cs => cs.lecture.equals(lectureId));

    if (!isEnrolled) {
        // Add the new lecture to the user's certificate with an initial score of 0.
        certificate.certScores.push({ lecture: lectureId, score: 0, assignmentsGraded: 0 });
    }

    return certificate.save();
};


// Method to check if user has been graded for at least 3 assignments in a lecture
certificateSchema.methods.hasMinimumGradedAssignments = function(lectureId, minAssignments = 3) {
    const lectureScore = this.certScores.find(cs => cs.lecture.equals(lectureId));
    return lectureScore && lectureScore.assignmentsGraded >= minAssignments;
};

// Method to get the number of graded assignments for a lecture
certificateSchema.methods.getGradedAssignmentsCount = function(lectureId) {
    const lectureScore = this.certScores.find(cs => cs.lecture.equals(lectureId));
    return lectureScore ? lectureScore.assignmentsGraded : 0;
};

const Certificate = mongoose.model('Certificate', certificateSchema);

module.exports = Certificate;



// create me a task schdular for generating pdf certificate after when the user have being graded for like 3 assignment been submitted according to the lecture batch get the user details and fill it in the pdf file which will be generated if time to observe this project the pdf let it be a npm package it will not it should not save in my project it will generate and send as an email message and also send to the user 

