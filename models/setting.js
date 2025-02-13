const mongoose = require("mongoose");

const settingSchema = mongoose.Schema({
    logo : {type: String, default: "logo"},
    appIcon : {type: String, default: "appicon"},
    appName : {type: String, required: true},
    contact : {type: String, default: "09031592480"},
    owner : {type: String, required: true},
    ownerAvater : {type: String, default: "person"},
    createdAt: {type: Date, default: Date.now()}
})

const Setting = mongoose.model('Setting', settingSchema);

module.exports = Setting;