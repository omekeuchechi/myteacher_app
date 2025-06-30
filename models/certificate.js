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
    totalScore: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    certScores: [lectureScoreSchema] // Array of scores for each lecture batch
}, { timestamps: true });

// Method to add or update a score for a lecture
certificateSchema.statics.updateScore = async function(userId, lectureId, assignmentScore) {
    let certificate = await this.findOne({ user: userId });

    if (!certificate) {
        certificate = new this({ 
            user: userId, 
            certScores: [],
            totalScore: 0
        });
    }

    let lectureScore = certificate.certScores.find(
        (cs) => cs.lecture.equals(lectureId)
    );
    
    // If this is a new score for the lecture, initialize it
    if (!lectureScore) {
        lectureScore = {
            lecture: lectureId,
            score: 0,
            assignmentsGraded: 0,
            certificateIssued: false
        };
        certificate.certScores.push(lectureScore);
    }
    
    // Check if already has 4 graded assignments
    if (lectureScore.assignmentsGraded >= 4) {
        return { 
            certificate,
            certificateIssued: lectureScore.certificateIssued,
            score: lectureScore.score
        };
    }
    
    // Update the score and increment graded assignments
    const newAssignmentsGraded = lectureScore.assignmentsGraded + 1;
    lectureScore.score = ((lectureScore.score * lectureScore.assignmentsGraded) + assignmentScore) / newAssignmentsGraded;
    lectureScore.assignmentsGraded = newAssignmentsGraded;
    
    let certificateIssued = false;
    
    // Check if all 4 assignments are graded and certificate not yet issued
    if (lectureScore.assignmentsGraded >= 4 && !lectureScore.certificateIssued) {
        lectureScore.certificateIssued = true;
        certificate.totalScore = lectureScore.score; // Update total score
        certificateIssued = true;
        
        // Get user details for email
        const user = await mongoose.model('User').findById(userId);
        const lecture = await mongoose.model('Lecture').findById(lectureId);
        
        if (user && lecture) {
            // Send email notification
            const emailContent = `
                <h1>Congratulations, ${user.name}!</h1>
                <p>You have successfully completed all assignments for the lecture: ${lecture.name}.</p>
                <p>Your final score is: ${lectureScore.score.toFixed(2)}%</p>
                <p>You can now download your certificate from your dashboard.</p>
            `;
            
            try {
                await require('../lib/sendEmail')({
                    to: user.email,
                    subject: `Certificate of Completion - ${lecture.name}`,
                    html: emailContent
                });
            } catch (emailError) {
                console.error('Failed to send certificate email:', emailError);
                // Don't fail the operation if email fails
            }
        }
    }

    // Save the updated certificate
    await certificate.save();
    
    return { 
        certificate,
        certificateIssued,
        score: lectureScore.score
    };
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

