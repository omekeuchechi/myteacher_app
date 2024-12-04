const mongoose = require("mongoose");

const courseSchema = mongoose.Schema({
    course : String,
    courseDescription : [{type: mongoose.Types.ObjectId, ref: 'Faculty'}],
    courseFee: String,
    userFaculty : {type: mongoose.Types.ObjectId, ref: 'Faculty'},
    // facultyStaff : [{type: mongoose.Types.ObjectId, ref: 'User'}],
    // facultyUser : {type: mongoose.Types.ObjectId, ref: 'User'},
    // facultyUsers : [{type: mongoose.Types.ObjectId, ref: 'User'}]
})

const Faculty = mongoose.model("Faculty", courseSchema);

module.exports = Faculty;