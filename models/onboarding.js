const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const onboardingSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  countryCode: {
    type: String,
    required: [true, 'Country code is required'],
    enum: {
      values: ['+234', '+44', '+1', '+233', '+27'],
      message: 'Please select a valid country code'
    }
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    validate: {
      validator: function(v) {
        // Basic phone number validation (allows numbers, spaces, hyphens, and parentheses)
        return /^[0-9\s\-()]+$/.test(v);
      },
      message: 'Please enter a valid phone number'
    }
  },
  // Store the full phone number with country code for easier querying
  fullPhoneNumber: {
    type: String,
    select: false // Don't include this field by default in queries
  },
  // Additional fields that might be useful
  status: {
    type: String,
    enum: ['pending', 'contacted', 'registered', 'rejected'],
    default: 'pending'
  },
  source: {
    type: String,
    default: 'website'
  },
  metadata: {
    ipAddress: String,
    userAgent: String
  }
}, {
  timestamps: true
});

// Add pagination plugin
onboardingSchema.plugin(mongoosePaginate);

// Pre-save hook to update the fullPhoneNumber field
onboardingSchema.pre('save', function(next) {
  if (this.isModified('phone') || this.isModified('countryCode')) {
    this.fullPhoneNumber = `${this.countryCode}${this.phone.replace(/[^0-9]/g, '')}`;
  }
  next();
});

// Create a compound index for email and fullPhoneNumber to ensure uniqueness
onboardingSchema.index({ email: 1 }, { unique: true });
onboardingSchema.index({ fullPhoneNumber: 1 }, { unique: true });

// Add a static method to find by email or phone
onboardingSchema.statics.findByEmailOrPhone = async function(email, phone) {
  return this.findOne({
    $or: [
      { email: email.toLowerCase() },
      { fullPhoneNumber: phone }
    ]
  });
};

const Onboarding = mongoose.model('Onboarding', onboardingSchema);

module.exports = Onboarding;