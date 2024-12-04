const { default: mongoose } = require("mongoose");

const assementSchema = mongoose.Schema({
    projectName: String,
    projectOwner: {type: mongoose.Types.Object, ref: 'User'},
    projectAssignedBy: {type: mongoose.Types.Object, ref: 'User'},
    projectComments: [{type: mongoose.Types.Object, ref: 'Comment'}],
    createdAt: {type: Date, default: Date.now()},
})

const Assement = mongoose.model('Assement', assementSchema);

module.exports = Assement;