const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  userId: String,
  courseId: String,
  amount: Number,
  currency: String,
  paymentReference: String,
  status: String,
  paymentMethod: String,
  createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;