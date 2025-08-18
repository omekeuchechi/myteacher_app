const mongoose = require("mongoose");

const assetSchema = new mongoose.Schema({
    name : String,
    mimeType : String,
    driveFileId : String,
    webViewLink : String,
    webContentLink : String,
    uploadedBy : {type: mongoose.Schema.Types.ObjectId, ref: "User"},
    courseId : {type: mongoose.Schema.Types.ObjectId, ref: "Course"},
    courseName : String,
    createdAt : {type: Date, default: Date.now}
});

const OnsiteAsset = mongoose.model("OnsiteAsset", assetSchema);

module.exports = OnsiteAsset;
