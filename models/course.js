const mongoose = require("mongoose");

const courseSchema = mongoose.Schema({
    course : String,
    courseDescription : String,
    courseFee: String,
    courseDuration : String,
    registerUsers : [{type: mongoose.Types.ObjectId, ref: 'User'}],
    courseIntructor : [{type: mongoose.Types.ObjectId, ref: 'User'}],
    createdAt: {type: Date, default: Date.now()}
    // facultyStaff : [{type: mongoose.Types.ObjectId, ref: 'User'}],
    // facultyUser : {type: mongoose.Types.ObjectId, ref: 'User'},
    // facultyUsers : [{type: mongoose.Types.ObjectId, ref: 'User'}]
})

const Course = mongoose.model("Course", courseSchema);

module.exports = Course;