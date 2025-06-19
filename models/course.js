const mongoose = require("mongoose");

const courseSchema = mongoose.Schema({
    course : {type: String, required: true},
    courseDescription : String,
    price:  {type: Number, required: true},
    durationWeeks:  {type: Number, required: true},
    courseIntructor :  {type: String, default: "Admin"},
    courseImage : String,
    createdAt: {type: Date, default: Date.now()}
})

const Course = mongoose.model("Course", courseSchema);

module.exports = Course;