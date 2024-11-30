const mongoose = require("mongoose");

const paymentSchema = mongoose.Schema.create({
    amount : String,
    facultyApliedBy : {type: mongoose.Types.ObjectId, ref: 'Faculty'},
    allPayments : [{type: mongoose.Types.ObjectId, ref: 'Payment'}],
    paymentDetail : String,
    paymentDetailsCreatedBy : {type: mongoose.Types.ObjectId, ref: 'User'}
})

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;