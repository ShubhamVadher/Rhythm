const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    account_id: {
        type: String,
        required: true,
        unique: true,
    },
    refresh_token: {
        type: String,
        required: true,
    },
    fav_artists: {
        type: Array,
        default: []
    },
    fav_genres: {
        type: Array,
        default: []
    }
});

module.exports = mongoose.model("user", userSchema);
