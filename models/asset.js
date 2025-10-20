const mongoose = require('mongoose');

const assetSchema = new mongoose.Schema({
  name: String,
  mimeType: String,
  driveFileId: String,
  webViewLink: String,
  webContentLink: String,
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lectureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Asset || mongoose.model('Asset', assetSchema);