const { default: mongoose } = require("mongoose");

const gradeSchema = mongoose.Schema({
    grade: {type: String, enum: ['stillWork', 'pass', 'failed', 'veryGood'], default: 'stillWork'},
    projectRating: [{type: mongoose.Types.ObjectId, ref: 'Comment'}],
    createdAt: {type: Date, default: Date.now()}
})

const Grade = mongoose.model('Grade', gradeSchema);

module.exports = Grade;