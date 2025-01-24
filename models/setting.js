const mongoose = require("mongoose");

const settingSchema = mongoose.Schema({
    logo : String,
    appIcon : String,
    appName : String,
    contact : String,
    Gurus : String,
    GuruAvater : String,
    createdAt: {type: Date, default: Date.now()}
})