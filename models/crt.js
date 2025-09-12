const mongoose = require('mongoose');

// this section is for multiple crt and it carries somany id of single crt
const multipleCrtSchema = new mongoose.Schema({
    username: {type: String, default: ''},
    userId: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
    crtId: {type: mongoose.Schema.Types.ObjectId, ref: 'SingleCrt'}
})

const MultipleCrt = mongoose.model('MultipleCrt', multipleCrtSchema);

// this section is for single crt
const singleCrtSchema = new mongoose.Schema({
    username: {type: String, default: ''},
    userId: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    lectureId: {type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', required: true},
    downloadurl: {type: String, required: true},
    paymentVerified: { type: Boolean, default: false },
    paymentDate: { type: Date }
}, {timestamps: true})

const SingleCrt = mongoose.model('SingleCrt', singleCrtSchema);

module.exports = {MultipleCrt, SingleCrt};
