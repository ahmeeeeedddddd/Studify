// /config/passport.js
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { Strategy as LinkedInStrategy } from 'passport-linkedin-oauth2';
import bcrypt from "bcrypt";
import db from "./db.js";
import env from "dotenv";
env.config();

// LOCAL STRATEGY
passport.use("local",
  new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
  }, async function verify(email, password, cb) {
    console.log('🔐 Passport verify called with:', { email, password: password ? `***${password.length} chars` : 'NULL/UNDEFINED' });
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
      console.log('📊 Database query result:', result.rows.length > 0 ? 'User found' : 'User not found');
      
      if (result.rows.length === 0) {
        console.log('❌ No user found with email:', email);
        return cb(null, false);
      }
      
      const user = result.rows[0];
      console.log('👤 Found user:', { id: user.id, email: user.email, name: user.name });
      console.log('🔑 User password_hash from DB:', user.password_hash ? `Hash exists (${user.password_hash.length} chars)` : 'NULL/UNDEFINED');
      console.log('📝 Input password:', password ? `Exists (${password.length} chars)` : 'NULL/UNDEFINED');
      
      // Check if both password and hash exist
      if (!password || !user.password_hash) {
        console.log('🚫 Missing password or hash:', { 
          inputPassword: !!password, 
          storedHash: !!user.password_hash 
        });
        return cb(null, false);
      }
      
      bcrypt.compare(password, user.password_hash, (err, valid) => {
        if (err) {
          console.log('🔥 Bcrypt error:', err);
          return cb(err);
        }
        console.log('🔑 Password validation result:', valid);
        return valid ? cb(null, user) : cb(null, false);
      });
    } catch (err) {
      console.log('💥 Database error:', err);
      return cb(err);
    }
  })
);


// GOOGLE STRATEGY

passport.use("google", new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "http://localhost:3000/auth/google/callback",
  userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
}, async (accessToken, refreshToken, profile, cb) => {
  try {
    const result = await db.query("SELECT * FROM users WHERE email=$1", [profile.email]);

    if (result.rows.length === 0) {
      const newUser = await db.query(
        "INSERT INTO users (name, email, password_hash) VALUES($1, $2, $3) RETURNING *",
        [profile.displayName, profile.email, "google"]
      );
      cb(null, newUser.rows[0]);
    } else {
      cb(null, result.rows[0]);
    }
  } catch (err) {
    cb(err);
  }
}));

//Facebook strategy

passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: "http://localhost:3000/auth/facebook/callback",
      profileFields: ["id", "displayName", "emails", "photos"], 
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log("---- FACEBOOK PROFILE ----");
        console.log(JSON.stringify(profile, null, 2));

        // Extract email if available, otherwise fallback
        const email =
          profile.emails && profile.emails.length > 0
            ? profile.emails[0].value
            : `${profile.id}@facebook.com`; // fallback synthetic email

        const name = profile.displayName || "Facebook User";

        // Check if user exists
        const userResult = await db.query(
          "SELECT * FROM users WHERE email = $1",
          [email]
        );

        let user;
        if (userResult.rows.length > 0) {
          user = userResult.rows[0];
        } else {
          // Insert new user
          const insertResult = await db.query(
            "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *",
            [email, name, "facebook"]
          );
          user = insertResult.rows[0];
        }

        return done(null, user);
      } catch (err) {
        console.error("Facebook strategy error:", err);
        return done(err, null);
      }
    }
  )
);


passport.use("linkedin", new LinkedInStrategy(
  {
    clientID: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/linkedin/callback",
    scope: ['email', 'profile', 'openid'],
    state: true, // Important: LinkedIn requires state parameter
    
    // Add these profile fields to get more data
    profileFields: ['id', 'first-name', 'last-name', 'email-address', 'headline', 'summary', 'industry', 'picture-url', 'picture-urls::(original)', 'positions', 'public-profile-url'],
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      console.log("LinkedIn Profile Data:", JSON.stringify(profile, null, 2));
      
      // Extract email - try multiple methods
      let email = null;
      if (profile.email) {
        email = profile.email;
      } else if (profile._json && profile._json.email) {
        email = profile._json.email;
      } else if (profile.emails && profile.emails[0]) {
        email = profile.emails[0].value;
      }
      
      // Extract name
      let name = profile.displayName || 'LinkedIn User';
      if (!name && profile._json) {
        name = `${profile._json.firstName || ''} ${profile._json.lastName || ''}`.trim();
      }
      
      console.log("Extracted data - Email:", email, "Name:", name);
      
      if (!email) {
        return done(new Error("No email found in LinkedIn profile"), null);
      }

      const result = await db.query("SELECT * FROM users WHERE email=$1", [email]);
      
      if (result.rows.length === 0) {
        const newUser = await db.query(
          "INSERT INTO users (name, email, password_hash) VALUES($1, $2, $3) RETURNING *",
          [name, email, "linkedin"]
        );
        return done(null, newUser.rows[0]);
      } else {
        return done(null, result.rows[0]);
      }
    } catch (err) {
      console.error("LinkedIn Auth Error:", err);
      return done(err, null);
    }
  }
));

passport.serializeUser((user, cb) => cb(null, user));
passport.deserializeUser((user, cb) => cb(null, user));

//Could add:
//GitHub / LinkedIn strategies
//-JWT strategy for APIs

