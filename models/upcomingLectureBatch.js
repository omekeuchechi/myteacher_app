const mongoose = require('mongoose');

const upcomingLectureBatchSchema = new mongoose.Schema({
    courseId : {type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true},
    courseName : {type: String, required: true},
    courseDescription : {type: String, required: true},
    courseImage : {type: String, default: ""},
    courseIntructor : {type: String, default: "MyteacherAdmin"},
    startTime : {type: Date, required: true},
    platform : {type: String, enum : ['Zoom', 'Jitsi', 'Other'], default: 'Zoom'},
    booked : [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    reminderSent: { type: Boolean, default: false },
    nextDayReminderSent: { type: Boolean, default: false }
}, {timestamps: true})

module.exports = mongoose.model('UpcomingLectureBatch', upcomingLectureBatchSchema);
