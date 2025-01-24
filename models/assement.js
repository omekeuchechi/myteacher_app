const { default: mongoose } = require("mongoose");

const assementSchema = mongoose.Schema({
    projectName: String,
    gradeField: {type: mongoose.Types.ObjectId, ref: 'Grade'},
    projectOwner: {type: mongoose.Types.ObjectId, ref: 'User'},
    projectAssignedBy: {type: mongoose.Types.ObjectId, ref: 'User'},
    projectComments: [{type: mongoose.Types.ObjectId, ref: 'Comment'}],
    coursePaidFor: {type: mongoose.Types.ObjectId, ref: 'Course'},
    createdAt: {type: Date, default: Date.now()},
})

const Assement = mongoose.model('Assement', assementSchema);

module.exports = Assement;