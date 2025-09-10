import express from "express";
import bcrypt from "bcrypt";
import passport from "passport";
import db from "../config/db.js";

const router = express.Router();
const saltRounds = 10;

// REGISTER
router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  console.log('📝 Registration attempt:', { 
    name, 
    email, 
    password: password ? `***${password.length} chars` : 'NULL/UNDEFINED' 
  });

  try {
    // Check if user already exists
    const checkResult = await db.query(
      "SELECT * FROM users WHERE email = $1 OR name = $2",
      [email, name]
    );

    if (checkResult.rows.length > 0) {
      const existingUser = checkResult.rows[0];
      if (existingUser.email === email) console.log("❌ Email already registered.");
      else if (existingUser.name === name) console.log("❌ Username already taken.");
      return res.redirect("/signin");
    }

    console.log('🔐 Hashing password...');
    const hash = await bcrypt.hash(password, saltRounds);

    console.log('✅ Password hashed successfully');
    console.log('💾 Inserting user into database...');

    const result = await db.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *",
      [name, email, hash]
    );

    const newUser = result.rows[0];

    console.log('👤 User created:', {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      password_hash: newUser.password_hash ? 'Hash stored' : 'NULL IN DB'
    });

    req.login(newUser, err => {
      if (err) {
        console.log('🔥 Login error after registration:', err);
        return res.redirect("/signin");
      }
      console.log("🎉 Registration success");
      res.redirect("/course");
    });

  } catch (err) {
    console.log('💥 Registration error:', err);
    res.redirect("/signin");
  }
});


// LOGIN
router.post("/signin", (req, res, next) => {
  console.log('🚀 Sign-in route hit');
  console.log('📝 Request body:', req.body);
  console.log('🍪 Session before:', req.session);
  
  passport.authenticate("local", (err, user, info) => {
    console.log('🎯 Passport authenticate callback:', { 
      error: err, 
      user: user ? { id: user.id, email: user.email } : null, 
      info 
    });
    
    if (err) {
      console.log('❌ Authentication error:', err);
      return next(err);
    }
    
    if (!user) {
      console.log('🚫 Authentication failed - redirecting to /signin');
      return res.redirect("/signin");
    }

    console.log('✅ User authenticated, logging in...');
    req.logIn(user, err => {
      if (err) {
        console.log('💥 Login error:', err);
        return next(err);
      }
      
      console.log('🔐 User logged in successfully');
      console.log('📋 Remember me checkbox:', req.body.rememberMe);
      
      if (req.body.rememberMe) {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
        console.log('⏰ Session set to 7 days');
      } else {
        req.session.cookie.maxAge = 5 * 60 * 1000; // 5 minutes
        console.log('⏰ Session set to 5 minutes');
      }
      
      console.log('🍪 Session after login:', req.session);
      console.log('🎯 Redirecting to /dashboard');
      res.redirect("/dashboard");
    });
  })(req, res, next);
});



// GOOGLE LOGIN
router.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get("/auth/google/callback", 
  passport.authenticate("google", { 
    successRedirect: "/dashboard", 
    failureRedirect: "/signin" 
  })
);


router.get(
  "/auth/facebook",
  passport.authenticate("facebook", { scope: ["email"] })
);

router.get(
  "/auth/facebook/callback",
  passport.authenticate("facebook", {
    successRedirect: "/dashboard",
    failureRedirect: "/signin",
  })
);


router.get("/auth/linkedin", 
  passport.authenticate("linkedin", { 
    scope: ['email', 'profile', 'openid']
  })
);


// Callback URL after LinkedIn login
router.get("/auth/linkedin/callback",
  passport.authenticate("linkedin", {
    failureRedirect: "/signin",
    successRedirect: "/dashboard", 
  })
);

// LOGOUT
router.get("/logout", (req, res) => {
  req.logout(() => res.redirect("/"));
});

export default router;

/*
could add later:
- Password reset routes
- Email verification before login
- 2FA (Two-factor authentication)
*/
