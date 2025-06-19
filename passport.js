require('dotenv').config();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('./models/user');
const bcrypt = require('bcrypt');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await User.findOne({ email: profile.emails[0].value });
      if (!user) {
        // Use the Google email as the password (hashed), or any default string
        const hashedPassword = await bcrypt.hash(profile.emails[0].value, 12);
        user = await User.create({
          name: profile.displayName,
          email: profile.emails[0].value,
          isVerified: true,
          avatar: profile.photos[0].value,
          password: hashedPassword,
          userCourse: 'Not set' // or any default value
        });
      }
      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});