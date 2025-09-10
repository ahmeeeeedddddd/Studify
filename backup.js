import express from "express";
import bodyParser from "body-parser";
import pg, { Client } from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";

const app = express();
const port = 3000;
const saltRounds = 10;//for encryption
env.config();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    rolling: true, //5 minutes reset each time the user interacts with th website
    cookie: {
      maxAge: 5 * 60 * 1000//user stays logged in after 5 minutes
    }
  })
);

app.use(bodyParser.urlencoded({extended:true}));
app.use(express.static("public"));

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

db.connect();

app.get("/",(req,res)=>{
  res.render("home.ejs");
});

app.get("/course",(req,res)=>{
  res.render("course.ejs");
});

app.get("/register",(req,res)=>{
  res.render("register.ejs");
});

app.get("/signin",(req,res)=>{
  res.render("signin.ejs");
});

//redirect after success login to dashboard or add course if the user has zero courses
//!!!!!!!!!!!!!!!!!!!!!!!     DONT FORGET TO ADD THAT LOGIC !!!!!!!!!!!!!!!!!!!!!!!!!!!!
app.get("/dashboard", (req, res) => {
  console.log(req.user);
  if (req.isAuthenticated()) {
    res.render("dashboard.ejs");
  } else {
    res.redirect("/signin");
  }
});

app.get("/auth/google",passport.authenticate("google",{
  scope:["profile","email"],
}));

app.get("/auth/google/dashboard",passport.authenticate("google",{
  successRedirect:"/dashboard",
  failureRedirect:"/signin"
}));


//!!!!!!!!!!!!!!!!!!!Add the remember me box to the html
app.post("/signin", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.redirect("/signin"); // invalid login

    req.logIn(user, (err) => {
      if (err) return next(err);

      //Assuming there is a remeber me checked box in the html 

      // If "Remember me" is checked, extend session lifespan
      if (req.body.rememberMe) {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      } else {
        req.session.cookie.maxAge = 5 * 60 * 1000; // 5 minutes
      }

      return res.redirect("/dashboard");
    });
  })(req, res, next);
});


//write the post route for the resgister and log in keeping in mind to log the name


app.post("/register", async (req, res) => {

  //make sure to include these in the html
  const name = req.body.name;
  const email = req.body.email;
  const password = req.body.password;

  try {
    // Check if username or email already exists
    const checkResult = await db.query(
      "SELECT * FROM users WHERE email = $1 OR name = $2",
      [email, name]
    );

    if (checkResult.rows.length > 0) {
      // Optional: tell the user if it's the name or email that's taken
      const existingUser = checkResult.rows[0];
      if (existingUser.email === email) {
        console.log("Email already registered.");
      } else if (existingUser.name === name) {
        console.log("Username already taken.");
      }
      return res.redirect("/signin");
    }

    // Hash the password
    bcrypt.hash(password, saltRounds, async (err, hash) => {
      if (err) {
        console.error("Error hashing password:", err);
      } else {
        const result = await db.query(
          "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *",
          [name, email, hash]
        );
        const user = result.rows[0];
        req.login(user, (err) => {
          if (err) {
            console.error(err);
            return res.redirect("/signin");
          }
          console.log("Registration success");
          res.redirect("/dashboard");
        });
      }
    });

  } catch (err) {
    console.log(err);
  }
});



passport.use("local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1 ", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              //Passed password check
              return cb(null, user);
            } else {
              //Did not pass password check
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

//!!!!!!!!!!!!!!!!!!!!!!!!!! Create the google token and set the correct call back url
passport.use("google",new GoogleStrategy({
  clientID:process.env.GOOGLE_CLIENT_ID,
  clientSecret:process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:"http://localhost:3000/auth/google/course",
  userProfileURL:"https://www.googleapis.com/oauth2/v3/userinfo",
},async(accessToken, refreshToken, profile, cb)=>{
  console.log(profile);
  try{
    const result=await db.query("SELECT * FROM users WHERE email=$1",[profile.email]);
    if(result.rows.length===0){
      const newUser=await db.query("INSERT INTO users (email,password) VALUES($1,$2) ",[profile.email,"google"]);
      cb(null,newUser.rows[0]);
    }
    else{
      cb(null,result.rows[0]);
    }
  }
  catch(err){
    cb(err);
  }
}));

passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, ()=>{
    console.log(`server running on port ${port}`);
});