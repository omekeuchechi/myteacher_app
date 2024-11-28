const mongoose = require("mongoose");

const facultySchema = mongoose.Schema({
    faculty : String,
    faculties : [{type: mongoose.Types.ObjectId, ref: 'Faculty'}],
    userFaculty : {type: mongoose.Types.ObjectId, ref: 'Faculty'},
    facultyStaff : [{type: mongoose.Types.ObjectId, ref: 'User'}],
    facultyUser : {type: mongoose.Types.ObjectId, ref: 'User'},
    facultyUsers : [{type: mongoose.Types.ObjectId, ref: 'User'}]
})

const Faculty = mongoose.model("Faculty", facultySchema);

module.exports = Faculty;