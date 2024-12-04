const mongoose = require("mongoose");

const paymentSchema = mongoose.Schema({
    amount : {type: Number, required: true},
    // currency : String,
    paymentCarriedBy : {type: mongoose.Types.ObjectId, ref: 'User'},
    paymentRecievedBy : {type: mongoose.Types.ObjectId, ref: 'User'},
    status : {type: String, enum: ['pending', 'completed', 'failed'], default: 'pending'},
    coursePaidFor : {type: mongoose.Types.ObjectId, ref: 'Course'},
    paymentDetail : String,
    createdAt : {type: Date, default: Date.now()}
})

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;