const mongoose = require("mongoose");

const mailerSchema = new mongoose.Schema({
    from: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        default: `${process.env.COMPANYNAME} <ADMIN>`
    },
    to: {
        type: [String],
        required: true,
        trim: true,
        lowercase: true
    },
    subject: {
        type: String,
        required: true,
        trim: true
    },
    text: {
        type: String,
        trim: true
    },
    html: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['pending', 'sent', 'failed', 'delivered', 'opened'],
        default: 'pending'
    },
    sentAt: {
        type: Date,
        default: null
    },
    error: {
        type: String,
        default: null
    },
    metadata: {
        type: Object,
        default: {}
    }
}, {
    timestamps: true
});

// Index for faster querying
mailerSchema.index({ status: 1, createdAt: -1 });
mailerSchema.index({ to: 1, status: 1 });

const Mailer = mongoose.model("Mailer", mailerSchema);
module.exports = Mailer;