const mongoose = require("mongoose");

const courseSchema = mongoose.Schema({
    course : String,
    courseDescription : String,
    price: Number,
    durationWeeks: Number,
    courseIntructor : String,
    createdAt: {type: Date, default: Date.now()}
})

const Course = mongoose.model("Course", courseSchema);

module.exports = Course;